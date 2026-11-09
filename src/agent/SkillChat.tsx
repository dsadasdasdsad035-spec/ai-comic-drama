import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessagePrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { AppSettings } from '../api'
import { stageDefaultLabel, stageModelKey, type StagePick } from '../ModelSelect'
import { modelHasCap } from '../modelCaps'
import { buildWorkbenchAgentSystem } from './workbenchChat'
import { imageAttachments, type ChatAttachment } from './chatAttachments'
import { classifyChatImage, imageContextLines, MAX_CHAT_IMAGE_BYTES } from '../../server/chat-image-payload.mjs'
import { loadSkills } from '../skills/registry'
import type { Skill } from '../skills/types'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatStep } from '@/chat-ui/ChatStep'
import { WorkbenchEmpty } from '@/chat-ui/WorkbenchEmpty'
import { WorkbenchHeader, type WorkbenchContextStats } from '@/chat-ui/WorkbenchHeader'
import { WorkbenchInspector } from '@/chat-ui/WorkbenchInspector'
import { ChatErrorNote, ChatStoppedNote } from '@/chat-ui/WorkbenchNotes'
import { ChatThreadBody, ChatThreadShell } from './ChatThreadShell'
import { StageToolUis } from './stageToolUis'
import { useAgentMessages } from './useAgentMessages'
import { bindSkillTools, createStageToolSet } from './stageTools'
import { runStageAgent } from './pi/stageRunner'
import { clearChatThread, loadChatThread, saveChatThread, threadTranscript, type ActiveSkill, type ChatThreadKey } from './threads'
import type { AgentBuiltinPart, AgentMessage } from './sceneAgentTypes'
import {
  WORKBENCH_PROFILES,
  builtinAvailability,
  builtinFailure,
  builtinLabel,
  type BuiltinAction,
  type WorkbenchChatAdapter,
  type WorkbenchTaskView,
} from './workbenchChat'
import { WorkbenchChatContext } from './workbenchChatContext'

type Props = {
  adapter: WorkbenchChatAdapter
  settings: AppSettings | null
  stagePick?: StagePick
  onToast?: (message: string) => void
  onRunningChange?: (running: boolean) => void
  onClose?: () => void
  /** 宿主草稿是否未保存；显式保存的工作台传入，用于同步写回执。 */
  dirty?: boolean
  /** 回执里的「用它生成三视图」确认动作；不传则不渲染该按钮。 */
  onRenderTurnaround?: (charNames: string[]) => Promise<void> | void
  /** 生成三视图的估算费用，显示在按钮上 */
  turnaroundCost?: number
}

const SKILL_BANNER = /^技能 [a-z0-9-]+ · (?:builtin|override|local) · v\d+/i
const STEP_LINE = /^第 (\d+) 轮 · ([\s\S]*)$/

function builtinId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `builtin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function textOfMessage(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function appendText(message: AppendMessage): string {
  const content = message.content as unknown
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text || '')
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function convertMessage(message: AgentMessage): ThreadMessageLike {
  type Part = Exclude<ThreadMessageLike['content'], string>[number]
  const content: Part[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      // 旧线程可能带着“技能 script · builtin · v1”横幅；新 UI 不再展示，也不再传给模型。
      if (part.text && !SKILL_BANNER.test(part.text)) content.push({ type: 'text', text: part.text })
    } else if (part.type === 'image-context') {
      const lines = imageContextLines(part.items)
      if (lines.length) content.push({ type: 'text', text: `【图片处置】\n${lines.join('\n')}` })
    } else if (part.type === 'step') {
      const chars = Number(part.chars) || 0
      const progress = chars > 0 ? `已生成 ${chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : chars} 字符` : '模型调用中…'
      const text =
        part.phase === 'start'
          ? `第 ${part.turn} 轮 · ${progress}`
          : part.phase === 'error'
            ? `第 ${part.turn} 轮 · 模型调用失败${part.text ? `：${part.text}` : ''}`
            : `第 ${part.turn} 轮 · ${part.text ? `模型说明：${part.text}` : '模型调用完成'}`
      content.push({ type: 'text', text })
    } else if (part.type === 'tool-call') {
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        ...(part.args ? { args: part.args as never } : {}),
        ...(part.result !== undefined ? { result: part.result } : {}),
        ...(part.isError ? { isError: true } : {}),
      })
    } else if (part.type === 'builtin') {
      // 内置动作回执复用 tool-call 渲染通道；线程里仍保留独立 builtin part。
      content.push({
        type: 'tool-call',
        toolCallId: part.id,
        toolName: 'builtin_action',
        args: {
          actionKey: part.actionKey,
          label: part.label,
          ...(part.scope ? { scope: part.scope } : {}),
        } as never,
        ...(part.result
          ? { result: part.result }
          : part.status === 'cancelled'
            ? {
                result: {
                  ok: false,
                  action: part.actionKey,
                  label: part.label,
                  ...(part.scope ? { scope: part.scope } : {}),
                  summary: '已取消',
                  cancelled: true,
                },
              }
            : {}),
        ...(part.status === 'error' ? { isError: true } : {}),
      })
    }
  }
  return {
    id: message.id,
    role: message.role,
    content,
    ...(message.role === 'assistant'
      ? {
          status:
            message.status === 'running'
              ? { type: 'running' as const }
              : message.status === 'complete'
                ? { type: 'complete' as const, reason: 'stop' as const }
                : { type: 'incomplete' as const, reason: 'other' as const },
        }
      : {}),
  }
}

/** 把 step part 渲染成轮次头；模型说明作为正文，失败/停止给可恢复说明。 */
function AssistantText({ text }: { text: string }) {
  if (text === '已取消') return <ChatStoppedNote />
  if (text.startsWith('失败：')) return <ChatErrorNote message={text.slice('失败：'.length)} />
  const match = STEP_LINE.exec(text)
  if (!match) return <ChatText text={text} />
  const turn = Number(match[1]) || 1
  const detail = match[2]
  if (detail.startsWith('模型说明：')) {
    const note = detail.slice('模型说明：'.length)
    return (
      <>
        <ChatStep turn={turn} phase="end">完成</ChatStep>
        {note ? <ChatText text={note} /> : null}
      </>
    )
  }
  if (detail.includes('失败')) return <ChatStep turn={turn} phase="error">{detail}</ChatStep>
  if (detail.includes('调用完成')) return <ChatStep turn={turn} phase="end">完成</ChatStep>
  if (detail === '模型调用中…' || detail.startsWith('已生成')) {
    return <ChatStep turn={turn} phase="start">{detail}</ChatStep>
  }
  return <ChatStep turn={turn} phase="end">{detail}</ChatStep>
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    out += alphabet[(triple >> 18) & 63]
    out += alphabet[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '='
  }
  return out
}

/** 读取附件字节。超限时不编码，避免把大图放进请求。 */
async function readChatImage(att: ChatAttachment): Promise<{ label: string; mimeType: string; data: string; bytes: number }> {
  const label = att.label
  const fromUrl = /\.jpe?g($|\?)/i.test(att.url || '')
    ? 'image/jpeg'
    : /\.webp($|\?)/i.test(att.url || '')
      ? 'image/webp'
      : /\.png($|\?)/i.test(att.url || '')
        ? 'image/png'
        : ''
  try {
    const res = await fetch(att.url || '', { credentials: 'same-origin' })
    if (!res.ok) return { label, mimeType: '', data: '', bytes: Number.NaN }
    const raw = new Uint8Array(await res.arrayBuffer())
    const header = (res.headers.get('content-type') || '').split(';')[0].trim()
    const mimeType = /^image\/(png|jpe?g|webp)$/.test(header) ? header : fromUrl
    if (raw.byteLength > MAX_CHAT_IMAGE_BYTES) return { label, mimeType, data: '', bytes: raw.byteLength }
    return { label, mimeType, bytes: raw.byteLength, data: bytesToBase64(raw) }
  } catch {
    return { label, mimeType: '', data: '', bytes: Number.NaN }
  }
}

function UserText({ text }: { text: string }) {
  if (!text.startsWith('【图片处置】\n')) return <ChatText text={text} />
  const lines = text.slice('【图片处置】\n'.length).split('\n').filter(Boolean)
  return (
    <details data-chat-image-context className="mb-1 rounded-md border border-dashed border-border px-2 py-1 text-[10px] text-muted-foreground">
      <summary className="cursor-pointer select-none">本轮图片 · {lines.length} 张</summary>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )
}

function UserMessage() {
  return (
    <ChatMessage role="user" variant="workbench">
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </ChatMessage>
  )
}

function AssistantMessage() {
  return (
    <ChatMessage role="assistant" variant="workbench">
      <MessagePrimitive.Parts components={{ Text: AssistantText }} unstable_showEmptyOnNonTextEnd={false} />
    </ChatMessage>
  )
}

/**
 * 工作台内嵌聊天：宿主技能可写，其他技能只读；写工具只产生草稿。
 * 线程按 adapter.threadKey 持久化，重新打开工作台可恢复。
 */
export default function SkillChat({
  adapter,
  settings,
  stagePick,
  onToast,
  onRunningChange,
  onClose,
  dirty,
  onRenderTurnaround,
  turnaroundCost,
}: Props) {
  const {
    messages,
    setMessages,
    running,
    setRunning,
    abortRef,
    messageRef,
    begin,
    updateEvent,
    patchAssistant,
    reset,
  } = useAgentMessages()

  const profile = WORKBENCH_PROFILES[adapter.surface]
  const modelLabel = stageDefaultLabel(settings, adapter.stage, stagePick)
  const modelReady = Boolean(stageModelKey(settings, adapter.stage, stagePick))
  const scope = useMemo(() => {
    try {
      return adapter.scope?.() || '当前项目'
    } catch {
      return '当前项目'
    }
  }, [adapter])

  const [hostSkill, setHostSkill] = useState<Skill | null>(null)
  const [available, setAvailable] = useState<Skill[]>([])
  const [readonly, setReadonly] = useState<Skill[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadNonce, setLoadNonce] = useState(0)
  const [inspectOpen, setInspectOpen] = useState(false)
  const [taskView, setTaskView] = useState<WorkbenchTaskView | null>(null)
  const [actionError, setActionError] = useState('')
  /** 本轮图片附件；只有 adapter 声明了 attachments 的工作台才会非空 */
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  /**
   * 附件来源换了（例如角色聊天切到另一个角色）就清空已选：
   * 否则会把上一个角色的图带进这个角色的上下文。
   */
  // 会话键里能区分「谁的附件」：角色聊天是 charId，其他工作台没有
  // 附件属于当前会话：切项目或切集时清空（由下面的 key 变化统一处理），
  // 切换选中的卡片不再影响附件——附件是过程输入，不绑定某个角色。
  const sessionSig = `${adapter.threadKey.project}|${adapter.threadKey.episode || 0}`
  const lastSessionRef = useRef(sessionSig)
  useEffect(() => {
    if (lastSessionRef.current === sessionSig) return
    lastSessionRef.current = sessionSig
    setAttachments([])
  }, [sessionSig])
  const [builtinRun, setBuiltinRun] = useState<{
    key: string
    label: string
    controller: AbortController
  } | null>(null)
  const builtinRunRef = useRef<typeof builtinRun>(null)
  builtinRunRef.current = builtinRun
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const userStartedRef = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const lastKeyRef = useRef<{ key: string; threadKey: ChatThreadKey } | null>(null)
  const clearGenRef = useRef(0)
  const clearingRef = useRef(false)
  const [clearing, setClearing] = useState(false)

  const threadKey = adapter.threadKey
  const key = [
    threadKey.project,
    threadKey.surface,
    threadKey.episode || 0,
    threadKey.shotId || (threadKey.charId ? `char:${threadKey.charId}` : ''),
  ].join('|')

  const activeSkillsNow: ActiveSkill[] = [
    ...(hostSkill
      ? [{ id: hostSkill.id, mode: 'host' as const, version: hostSkill.manifest.version, source: hostSkill.source }]
      : []),
    ...readonly.map((s) => ({
      id: s.id,
      mode: 'readonly' as const,
      version: s.manifest.version,
      source: s.source,
    })),
  ]
  const activeRef = useRef<ActiveSkill[]>(activeSkillsNow)
  activeRef.current = activeSkillsNow

  useEffect(() => {
    const prev = lastKeyRef.current
    const changed = Boolean(prev && prev.key !== key)
    if (changed && prev) {
      // 切集/切镜头前先保存旧线程；随后清空，避免旧消息串到新线程。
      void saveChatThread(prev.threadKey, messagesRef.current, activeRef.current).catch(() => {})
      abortRef.current?.abort()
      abortRef.current = null
      builtinRunRef.current?.controller.abort()
      setBuiltinRun(null)
      setRunning(false)
      setMessages([])
      setReadonly([])
      setTaskView(null)
      setHostSkill(null)
      setActionError('')
      setInspectOpen(false)
    }
    lastKeyRef.current = { key, threadKey }
    userStartedRef.current = false
    let alive = true
    setLoaded(false)
    setLoadError('')
    ;(async () => {
      try {
        const { skills, issues } = await loadSkills()
        const host = skills.get(adapter.skillId)
        if (!host) {
          throw new Error(issues.find((x) => x.id === adapter.skillId)?.message || `技能「${adapter.skillId}」不可用`)
        }
        if (!alive) return
        setHostSkill(host)
        setAvailable(
          [...skills.values()].filter(
            (s) =>
              s.id !== host.id &&
              (s.manifest.runtime === 'tools') &&
              s.manifest.tools.some((t) => t.startsWith('read_') || t === 'get_shot_context'),
          ),
        )
        const thread = await loadChatThread(adapter.threadKey)
        if (!alive) return
        const restored = (thread?.messages || []).map((m) => ({
          ...m,
          status: m.status === 'running' ? ('cancelled' as const) : m.status,
          parts: m.parts.map((p) =>
            p.type === 'builtin' && p.status === 'running'
              ? { ...p, status: 'cancelled' as const }
              : p,
          ),
        }))
        const ro = (thread?.activeSkills || [])
          .filter((s) => s.mode === 'readonly')
          .map((s) => skills.get(s.id))
          .filter((s): s is Skill => Boolean(s))
        if (!userStartedRef.current) {
          setMessages(restored)
          setReadonly(ro)
        }
        setLoaded(true)
      } catch (e) {
        if (!alive) return
        setLoadError((e as Error).message || String(e))
        setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [key, loadNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded || running || !messages.length || clearingRef.current) return
    const timer = setTimeout(() => {
      if (clearingRef.current) return
      void saveChatThread(adapterRef.current.threadKey, messages, activeSkillsNow).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [messages, running, loaded, hostSkill, readonly]) // eslint-disable-line react-hooks/exhaustive-deps

  // 关闭工作台/切换视图时兜底保存，并停止仍在跑的本轮与内置动作。
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      builtinRunRef.current?.controller.abort()
      const prev = lastKeyRef.current
      if (prev && messagesRef.current.length && !clearingRef.current) {
        void saveChatThread(prev.threadKey, messagesRef.current, activeRef.current).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    onRunningChange?.(running || Boolean(builtinRun))
  }, [onRunningChange, running, builtinRun])

  useEffect(() => {
    return () => onRunningChange?.(false)
  }, [onRunningChange])

  /** 附件来源；未声明时整块 UI 不出现 */
  const attachSource = adapter.attachments
  const [uploadingRef, setUploadingRef] = useState(false)
  const refFileRef = useRef<HTMLInputElement | null>(null)

  const addAttachment = (item: { key: string; label: string; url: string; kind?: ChatAttachment['kind'] }) => {
    if (!attachSource) return
    setAttachments((prev) => {
      if (prev.length >= attachSource.limit) return prev
      if (prev.some((a) => a.key === item.key)) return prev
      return [
        ...prev,
        { key: item.key, kind: item.kind || 'image', label: item.label, url: item.url },
      ]
    })
  }
  const removeAttachment = (key: string) => {
    setAttachments((prev) => prev.filter((a) => a.key !== key))
  }

  /**
   * 从聊天里上传参考图：落成项目媒体文件，经 adapter 写回宿主数据，
   * 然后自动加入本轮附件（用户上传就是为了用它）。
   */
  const [pickingProject, setPickingProject] = useState(false)
  /** 从项目里挑一张图：由 adapter 提供，返回 null 表示取消 */
  const pickFromProject = async () => {
    if (!attachSource?.pick) return
    setPickingProject(true)
    try {
      const item = await attachSource.pick()
      if (item) addAttachment(item)
    } catch (e) {
      onToast?.((e as Error).message || '选择图片失败')
    } finally {
      setPickingProject(false)
    }
  }

  const uploadAttachment = async (file: File) => {
    if (!attachSource?.upload) return
    setUploadingRef(true)
    try {
      // upload 负责落盘与写回宿主数据，并返回可直接加入本轮附件的新条目
      const item = await attachSource.upload(file)
      addAttachment(item)
    } catch (e) {
      onToast?.((e as Error).message || '上传参考图失败')
    } finally {
      setUploadingRef(false)
    }
  }

  /**
   * 送给技能的输入 = adapter 的输入 + 参考图要点。
   * referenceDigest 始终存在（甚至为空串）：技能的 {{input:referenceDigest}}
   * 只有在键缺失时才被算作「缺输入」，空串是合法的「没有图」。
   */
  const bootstrapSystem = (host: Skill) => buildWorkbenchAgentSystem(host, adapter, readonly)

  /**
   * 本轮附件的文本标签。放进 userForModel 而不是技能模板输入，
   * 这样五个技能都能知道「这张图叫什么」，且不需要改 SKILL.md。
   */
  const attachmentBlock = (): string => {
    if (!attachments.length) return ''
    const lines: string[] = ['【本轮附件】']
    for (const a of attachments) {
      if (a.kind === 'image') {
        lines.push(`- 图片「${a.label}」`)
        continue
      }
      const body = String(a.text || '').trim()
      lines.push(`- ${a.kind === 'video' ? '视频' : a.kind === 'doc' ? '文档' : '文本'}「${a.label}」${body ? `：${body}` : '（无可用正文）'}`)
    }
    return `${lines.join('\n')}\n\n`
  }

  const contextStats = useMemo<WorkbenchContextStats | null>(() => {
    if (!loaded || !hostSkill) return null
    try {
      const system = bootstrapSystem(hostSkill)
      return {
        entries: [{ key: 'agent', label: 'Pi 引导', chars: system.length, mode: 'inline' as const }],
        total: system.length,
        referenceCount: 0,
      }
    } catch {
      return null
    }
    // 附件标签变化要刷新「将发送」里的输入统计
  }, [adapter, hostSkill, loaded, profile, messages.length, running, attachments])

  const loadReadonly = (id: string) => {
    if (!id) return
    if (readonly.length >= 1) {
      onToast?.('线程最多同时加载宿主 + 1 个只读技能，先卸载一个')
      return
    }
    const skill = available.find((s) => s.id === id)
    if (skill) setReadonly((prev) => [...prev, skill])
  }

  const removeReadonly = (id: string) => {
    setReadonly((prev) => prev.filter((s) => s.id !== id))
  }

  const makeTaskView = (host: Skill, system: string): WorkbenchTaskView => ({
    system,
    task: '',
    inputs: {},
    references: [],
    missing: [],
    modelLabel,
    skillId: host.id,
    skillTitle: profile.title,
    skillSource: host.source,
    skillVersion: host.manifest.version,
    readonly: readonly.map((s) => ({ id: s.id, version: s.manifest.version })),
    readTools: [...new Set([...host.manifest.tools.filter((t) => t.startsWith('read_')), 'read_skill'])],
    saveMode: profile.saveMode,
  })

  const preview = async () => {
    if (!hostSkill) return
    try {
      const system = bootstrapSystem(hostSkill)
      setTaskView(makeTaskView(hostSkill, system))
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  const applyIfCurrent = (gen: number, fn: () => void) => {
    if (clearGenRef.current !== gen) return
    fn()
  }

  const clearConversation = async () => {
    if (!messages.length || clearingRef.current) return
    if (!window.confirm('清空当前对话？只删除聊天记录，不清左侧草稿，且不可恢复。')) return
    clearingRef.current = true
    setClearing(true)
    clearGenRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    builtinRunRef.current?.controller.abort()
    setBuiltinRun(null)
    messageRef.current = null
    try {
      await clearChatThread(adapterRef.current.threadKey)
    } catch (e) {
      clearingRef.current = false
      setClearing(false)
      setRunning(false)
      onToast?.((e as Error).message || '清空对话失败')
      return
    }
    messagesRef.current = []
    reset()
    setReadonly([])
    setAttachments([])
    setTaskView(null)
    setActionError('')
    setInspectOpen(false)
    setRunning(false)
    clearingRef.current = false
    setClearing(false)
  }

  const run = async (text: string) => {
    if (running || builtinRunRef.current || clearingRef.current) return
    setActionError('')
    const host = hostSkill
    if (!host) {
      setActionError('技能尚未加载')
      onToast?.('技能尚未加载')
      return
    }
    const modelKey = stageModelKey(settings, adapter.stage, stagePick)
    if (!modelKey) {
      setActionError('没有可用的文本模型，请到设置页绑定该环节')
      onToast?.('没有可用的文本模型，请到设置页绑定该环节')
      return
    }
    const entry = settings?.models.find((m) => m.key === modelKey)
    const providerKind = settings?.providers.find((p) => p.id === entry?.provider)?.kind || ''
    const vision = entry ? modelHasCap(entry, 'vision') : false
    const loadedImages = await Promise.all(imageAttachments(attachments).map((att) => readChatImage(att)))
    const decisions = loadedImages.map((image) => ({
      image,
      decision: classifyChatImage(image, { providerKind, vision }),
    }))
    const images = decisions
      .filter((item) => item.decision.sent && item.image.data)
      .map((item) => ({
        type: 'image' as const,
        data: item.image.data,
        mimeType: item.decision.mimeType || item.image.mimeType,
      }))
    const placeholders = decisions
      .filter((item) => !item.decision.sent)
      .map((item) => `图片「${item.decision.label}」未送入模型：${item.decision.reason}`)
    const system = bootstrapSystem(host)
    const attachText = [attachmentBlock(), placeholders.length ? `${placeholders.join('\n')}\n\n` : ''].filter(Boolean).join('')
    const userForModel = attachText ? `${attachText}${text}` : text
    const tools = bindSkillTools(createStageToolSet(adapter), [
      { skill: host, mode: 'host' },
      ...readonly.map((s) => ({ skill: s, mode: 'readonly' as const })),
    ])
    const history = threadTranscript(messages)
    setTaskView(makeTaskView(host, system))

    const gen = clearGenRef.current
    userStartedRef.current = true
    begin(
      text,
      decisions.length
        ? [{
            type: 'image-context',
            items: decisions.map((item) => ({
              label: item.decision.label,
              sent: item.decision.sent,
              ...(item.decision.reason ? { reason: item.decision.reason } : {}),
            })),
          }]
        : [],
    )
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    try {
      const result = await runStageAgent({
        userText: userForModel,
        images,
        system,
        tools,
        history,
        modelKey,
        stage: adapter.stage,
        signal: controller.signal,
        onEvent: (event) => applyIfCurrent(gen, () => updateEvent(event)),
      })
      if (result.cancelled) {
        applyIfCurrent(gen, () => patchAssistant((m) => (m.status === 'cancelled' ? m : { ...m, status: 'cancelled' })))
      } else if (result.error) {
        applyIfCurrent(gen, () => {
          patchAssistant((m) =>
            m.status === 'error'
              ? m
              : { ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${result.error}` }] },
          )
          onToast?.(result.error || '失败')
        })
      } else {
        applyIfCurrent(gen, () => patchAssistant((m) => ({ ...m, status: 'complete' })))
      }
    } catch (e) {
      const message = (e as Error).message || String(e)
      applyIfCurrent(gen, () => {
        patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${message}` }] }))
        onToast?.(message)
      })
    } finally {
      applyIfCurrent(gen, () => {
        abortRef.current = null
        setRunning(false)
      })
    }
  }

  /** 显式内置动作：用户点击触发，走宿主函数；不进入模型工具循环。 */
  const runBuiltinAction = async (action: BuiltinAction) => {
    if (running || builtinRunRef.current || clearingRef.current) return
    const availability = builtinAvailability(action)
    if (availability.disabled) {
      onToast?.(availability.reason || '当前不可运行')
      return
    }
    const label = builtinLabel(action)
    const controller = new AbortController()
    const msgId = `builtin-msg-${builtinId()}`
    const part: AgentBuiltinPart = {
      type: 'builtin',
      id: `builtin-${builtinId()}`,
      actionKey: action.key,
      label,
      ...(action.scope ? { scope: action.scope } : {}),
      status: 'running',
      startedAt: Date.now(),
    }
    const gen = clearGenRef.current
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', parts: [part], status: 'running' },
    ])
    setBuiltinRun({ key: action.key, label, controller })
    try {
      const result = await action.run(controller.signal)
      const partStatus: AgentBuiltinPart['status'] = result.ok
        ? 'done'
        : result.cancelled
          ? 'cancelled'
          : 'error'
      applyIfCurrent(gen, () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  status: result.ok
                    ? ('complete' as const)
                    : result.cancelled
                      ? ('cancelled' as const)
                      : ('error' as const),
                  parts: m.parts.map((p) =>
                    p.type === 'builtin'
                      ? { ...p, status: partStatus, result, endedAt: Date.now() }
                      : p,
                  ),
                }
              : m,
          ),
        )
        if (!result.ok) onToast?.(result.error || result.summary)
      })
    } catch (e) {
      const message = (e as Error).message || '内置动作失败'
      const result = builtinFailure(action.key, message, {
        label,
        scope: action.scope,
        saveMode: profile.saveMode,
      })
      applyIfCurrent(gen, () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  status: 'error' as const,
                  parts: m.parts.map((p) =>
                    p.type === 'builtin'
                      ? { ...p, status: 'error' as const, result, endedAt: Date.now() }
                      : p,
                  ),
                }
              : m,
          ),
        )
        onToast?.(message)
      })
    } finally {
      applyIfCurrent(gen, () => setBuiltinRun(null))
    }
  }

  /** 只带附件、不打字也能发送：补一句占位说明，让历史与重试有可读内容。 */
  const ATTACHMENT_ONLY_PLACEHOLDER = '（见附件）'

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const typed = appendText(message)
      if (!typed && !attachments.length) return
      await run(typed || ATTACHMENT_ONLY_PLACEHOLDER)
    },
    onCancel: async () => {
      abortRef.current?.abort()
      setRunning(false)
    },
  })

  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return textOfMessage(messages[i])
    }
    return ''
  }, [messages])

  const retryLast = () => {
    if (!running && lastUserText) void run(lastUserText)
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const busy = running || Boolean(builtinRun)
  const status: 'ready' | 'running' | 'error' =
    busy ? 'running' : lastAssistant?.status === 'error' ? 'error' : 'ready'

  const contextValue = {
    surface: adapter.surface,
    saveMode: profile.saveMode,
    onSave: adapter.saveDraft,
    onRetry: lastUserText ? retryLast : undefined,
    running: busy,
    dirty,
    onRenderTurnaround,
    turnaroundCost,
  }

  return (
    <div className="skill-chat chat-ui" data-skill-chat={adapter.surface}>
      <WorkbenchHeader
        title={adapter.chatTitle?.() ?? profile.title}
        scope={scope}
        hostSkillId={hostSkill?.id || adapter.skillId}
        modelLabel={modelLabel}
        modelReady={modelReady}
        running={busy}
        busyLabel={builtinRun ? `正在运行${builtinRun.label}…` : running ? '正在改…' : undefined}
        status={status}
        stats={contextStats}
        readonly={readonly}
        available={available}
        onLoadReadonly={loadReadonly}
        onRemoveReadonly={removeReadonly}
        actions={loaded && hostSkill ? adapter.builtins ?? [] : []}
        onRunAction={(action) => void runBuiltinAction(action)}
        actionRunning={builtinRun ? { key: builtinRun.key, label: builtinRun.label } : null}
        onCancelAction={() => builtinRun?.controller.abort()}
        actionsDisabled={!loaded || !hostSkill || running || Boolean(builtinRun)}
        inspectOpen={inspectOpen}
        canInspect={Boolean(hostSkill) && !loadError}
        onToggleInspect={() => {
          if (!inspectOpen) preview()
          setInspectOpen((v) => !v)
        }}
        onClose={onClose}
        onClear={() => void clearConversation()}
        canClear={messages.length > 0 && !clearing}
        clearing={clearing}
      />

      {loadError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[12px] leading-relaxed text-destructive">{loadError}</p>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted"
            onClick={() => setLoadNonce((v) => v + 1)}
          >
            重新加载技能
          </button>
        </div>
      ) : (
        <>
          {actionError && (
            <div
              data-chat-action-error
              className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive"
            >
              {actionError}
            </div>
          )}
          {inspectOpen && taskView ? (
            <WorkbenchInspector
              view={taskView}
              profile={profile}
              onClose={() => setInspectOpen(false)}
              onToast={onToast}
            />
          ) : (
            <WorkbenchChatContext.Provider value={contextValue}>
              <ChatThreadShell runtime={runtime} running={running} scope={adapter.surface} toolUis={<StageToolUis />}>
                {attachSource?.upload ? (
                  <input
                    ref={refFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void uploadAttachment(f)
                      e.target.value = ''
                    }}
                  />
                ) : null}
                <ChatThreadBody
                  UserMessage={UserMessage}
                  AssistantMessage={AssistantMessage}
                  empty={
                    <WorkbenchEmpty
                      profile={profile}
                      loading={!loaded}
                      compact={adapter.surface === 'shots'}
                      actions={
                        adapter.surface === 'shots'
                          ? []
                          : loaded && hostSkill
                            ? adapter.builtins ?? []
                            : []
                      }
                      onRunAction={(action) => void runBuiltinAction(action)}
                      running={busy}
                    />
                  }
                  emptyAlign="bottom"
                  placeholder={adapter.chatPlaceholder?.() || profile.placeholder || '输入消息…'}
                  inputLabel={`${adapter.surface} 技能聊天输入`}
                  suggestions={loaded && messages.length === 0 ? profile.suggestions : undefined}
                  disabled={!loaded || !hostSkill || busy}
                  hint="Enter 发送 · Shift+Enter 换行"
                  cancelLabel="停止"
                  {...(attachSource
                    ? {
                        attachments: {
                          items: attachments,
                          limit: attachSource.limit,
                          available: attachSource.available(),
                          hint: attachSource.hint,
                          onAdd: addAttachment,
                          onRemove: removeAttachment,
                          onClear: () => setAttachments([]),
                          ...(attachSource.upload
                            ? { onUpload: () => refFileRef.current?.click(), uploadBusy: uploadingRef }
                            : {}),
                          ...(attachSource.pick
                            ? { onPick: () => void pickFromProject(), picking: pickingProject }
                            : {}),
                          // 空输入时库不允许发送，只带附件的路径由宿主自己发起
                          onSendAttachmentsOnly: () => void run(ATTACHMENT_ONLY_PLACEHOLDER),
                        },
                      }
                    : {})}
                />
              </ChatThreadShell>
            </WorkbenchChatContext.Provider>
          )}
        </>
      )}
    </div>
  )
}
