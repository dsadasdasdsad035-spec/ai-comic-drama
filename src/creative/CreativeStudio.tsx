import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessagePrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { generateImage, generateVoice, saveSettings, startVideo, waitVideo, type AppSettings } from '../api'
import { stageModelKey, type StagePick } from '../ModelSelect'
import { buildSkillPrompt } from '../skills/render'
import { loadSkills } from '../skills/registry'
import type { Skill } from '../skills/types'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatStep } from '@/chat-ui/ChatStep'
import { ChatThreadBody, ChatThreadShell } from '../agent/ChatThreadShell'
import { CreativeToolUis } from './CreativeToolUis'
import { useAgentMessages } from '../agent/useAgentMessages'
import { runStageAgent } from '../agent/stageAgentGraph'
import { threadTranscript } from '../agent/threads'
import type { AgentMessage } from '../agent/sceneAgentTypes'
import { CreativeSessionList } from './CreativeSessionList'
import { CreativeHeader } from './CreativeHeader'
import { CapabilityTray } from './CapabilityTray'
import { CreativeComposerBar } from './CreativeComposerBar'
import { CreativeEmpty } from './CreativeEmpty'
import type { CostPrompt } from './CreativeMessageParts'
import { CreativeArtifacts } from './CreativeArtifacts'
import { CostConfirmDialog } from './CostConfirmDialog'
import { PromoteDialog } from './PromoteDialog'
import { bindCreativeTools, createCreativeToolSet, creativeModelFor, type CostRequest, type CreativeSnapshot } from './tools'
import {
  autoTitle,
  createCreativeSession,
  deleteCreativeSession,
  getCreativeSession,
  listCreativeSessions,
  loadCreativeThread,
  patchCreativeSession,
  saveCreativeThread,
  type CreativeArtifact,
  type CreativeMode,
  type CreativeSession,
  type CreativeSessionSummary,
} from './sessionStore'
import { downloadCreativeExport, ingestCreative, loadCreativeSession, splitCreativeSource, extractFrames } from './mediaApi'
import { normalizeCreativeSettings } from './settings'
import { CreativeChatContext } from './CreativeChatContext'

const STEP_LINE = /^第 (\d+) 轮 · ([\s\S]*)$/

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
      if (part.text) content.push({ type: 'text', text: part.text })
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

function AssistantText({ text }: { text: string }) {
  if (text === '已取消') return <ChatText text="已取消本轮。" />
  if (text.startsWith('失败：')) return <ChatText text={text} />
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

function UserMessage() {
  return (
    <ChatMessage role="user" variant="workbench">
      <MessagePrimitive.Parts components={{ Text: ChatText }} />
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

const MODE_SKILL: Record<CreativeMode, string> = {
  plan: 'creative-plan',
  reverse: 'video-reverse',
  remake: 'video-reverse',
}

const MODE_HINT: Record<CreativeMode, string> = {
  plan: '把想法拆成方向与镜头草案；不会写项目',
  reverse: '粘链接或上传视频，逐镜反推成两段提示词',
  remake: '用已有提示词包生成复刻片段',
}

export type CreativeStudioProps = {
  settings: AppSettings | null
  stagePick?: StagePick
  onToast?: (message: string) => void
  onProjectDataChanged?: () => void
}

/**
 * 创意工作室：聊天是主界面。
 *
 * 与 SkillChat 的关键差别：没有宿主草稿、没有 submit_* 合并语义，
 * 工具集自带媒体摄取与付费闸门；会话可以没有项目。
 */
export default function CreativeStudio({ settings, stagePick, onToast, onProjectDataChanged }: CreativeStudioProps) {
  const { messages, setMessages, running, setRunning, abortRef, begin, updateEvent, patchAssistant } = useAgentMessages()

  const [sessions, setSessions] = useState<CreativeSession[]>([])
  const [session, setSession] = useState<CreativeSessionSummary | null>(null)
  const [mode, setMode] = useState<CreativeMode>('plan')
  const [loading, setLoading] = useState(true)
  const [listOpen, setListOpen] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [costPrompt, setCostPrompt] = useState<CostPrompt | null>(null)
  const [promoteArtifact, setPromoteArtifact] = useState<CreativeArtifact | null>(null)
  const [hostSkill, setHostSkill] = useState<Skill | null>(null)
  const [skillError, setSkillError] = useState('')
  const [creativeOverride, setCreativeOverride] = useState(() => normalizeCreativeSettings(settings?.creative))
  const creative = useMemo(() => normalizeCreativeSettings({ ...creativeOverride }), [creativeOverride])

  useEffect(() => {
    setCreativeOverride(normalizeCreativeSettings(settings?.creative))
  }, [settings?.creative])

  const sessionRef = useRef<CreativeSessionSummary | null>(null)
  sessionRef.current = session
  const modeRef = useRef(mode)
  modeRef.current = mode
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const saveTimer = useRef<number | null>(null)
  const paidCallsRef = useRef({ count: 0, max: creative.limits?.maxPaidCallsPerTurn ?? 8 })
  /** 本轮已分析的证据帧，避免重复付视觉费用 */
  const frameCache = useRef(new Map<string, Record<string, unknown>>())
  /** 本会话内用户勾过「不再询问」的能力；真实视频生成不受影响 */
  const skipConfirmRef = useRef(new Set<string>())

  const modelKey = stageModelKey(settings, 'creative', stagePick)

  // 首次进入：恢复最近一条会话，没有就新建
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await listCreativeSessions(50)
        if (!alive) return
        setSessions(list)
        const first = list[0] || (await createCreativeSession({ mode: 'plan' }))
        if (!alive) return
        if (!list.length) setSessions([first])
        await openSession(first.id)
      } catch (e) {
        if (!alive) return
        setLoadError((e as Error).message || String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 加载宿主技能（随模式变化）
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { skills, issues } = await loadSkills()
        if (!alive) return
        const id = MODE_SKILL[mode]
        const skill = skills.get(id)
        if (!skill) {
          setSkillError(issues.find((x) => x.id === id)?.message || `技能「${id}」不可用`)
          setHostSkill(null)
          return
        }
        setSkillError('')
        setHostSkill(skill)
      } catch (e) {
        if (!alive) return
        setSkillError((e as Error).message || String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [mode])

  // 卸载时立刻落盘：切项目/切视图会让组件卸载，防抖计时器没机会跑
  useEffect(() => {
    return () => {
      const id = sessionRef.current?.id
      const msgs = messagesRef.current
      if (!id || !msgs.length) return
      void saveCreativeThread(id, msgs, []).catch(() => {})
    }
  }, [])

  const openSession = useCallback(
    async (id: string) => {
      if (sessionRef.current?.id === id) return
      // 切换前先落盘当前线程
      if (sessionRef.current) {
        const prev = sessionRef.current.id
        try {
          await saveCreativeThread(prev, messagesRef.current, [])
        } catch {
          /* 保存失败不阻断切换 */
        }
      }
      abortRef.current?.abort()
      abortRef.current = null
      setRunning(false)
      setMessages([])
      setActionError('')
      setLoading(true)
      try {
        const [summary, thread] = await Promise.all([getCreativeSession(id), loadCreativeThread(id)])
        setSession(summary)
        setMode(summary.mode)
        setMessages(
          (thread.messages || []).map((m) => ({
            ...m,
            status: m.status === 'running' ? ('cancelled' as const) : m.status,
          })),
        )
        setListOpen(false)
      } catch (e) {
        setLoadError((e as Error).message || String(e))
      } finally {
        setLoading(false)
      }
    },
    [abortRef, setMessages, setRunning],
  )

  // 线程自动保存（防抖）
  useEffect(() => {
    if (!session || running || !messages.length) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveCreativeThread(session.id, messages, []).catch(() => {})
    }, 600)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, running, session?.id])

  const refreshSession = useCallback(async () => {
    const id = sessionRef.current?.id
    if (!id) return
    try {
      const summary = await getCreativeSession(id)
      setSession(summary)
    } catch {
      /* 刷新失败保留旧视图 */
    }
  }, [])

  const saveCapabilityModels = async (models: NonNullable<typeof creative.models>) => {
    const next = normalizeCreativeSettings({ ...creativeOverride, models })
    setCreativeOverride(next)
    try {
      await saveSettings({ creative: next })
      onToast?.('能力绑定已保存（只影响创意会话）')
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  const newSession = async () => {
    const created = await createCreativeSession({ mode })
    setSessions((prev) => [created, ...prev])
    setSession(null)
    await openSession(created.id)
  }

  const renameSession = async (id: string, title: string) => {
    const updated = await patchCreativeSession(id, { title })
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
    if (sessionRef.current?.id === id) setSession((cur) => (cur ? { ...cur, title: updated.title } : cur))
  }

  const removeSession = async (id: string) => {
    await deleteCreativeSession(id)
    const next = sessions.filter((s) => s.id !== id)
    setSessions(next)
    if (sessionRef.current?.id === id) {
      setSession(null)
      if (next[0]) await openSession(next[0].id)
      else {
        const created = await createCreativeSession({ mode: 'plan' })
        setSessions([created])
        await openSession(created.id)
      }
    }
  }

  const changeMode = async (next: CreativeMode) => {
    setMode(next)
    const id = sessionRef.current?.id
    if (!id) return
    try {
      const updated = await patchCreativeSession(id, { mode: next })
      setSession((cur) => (cur ? { ...cur, mode: updated.mode } : cur))
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, mode: updated.mode } : s)))
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  /**
   * 工具读的必须是服务端最新状态：抽帧/切分是异步写库，
   * 用 React state 会拿到上一轮快照，模型就会说「还没有证据帧」。
   */
  const snapshot = useCallback(async (): Promise<CreativeSnapshot> => {
    const cur = sessionRef.current
    if (!cur) throw new Error('还没有创意会话')
    const fresh = await getCreativeSession(cur.id)
    return {
      session: fresh,
      sources: fresh.sources,
      shots: fresh.shots || {},
      artifacts: fresh.artifacts,
    }
  }, [])

  /** 成本确认：把请求挂起，等用户点确认或取消 */
  const confirmCost = useCallback((req: CostRequest) => {
    // Seedance 2.0+ 之类的真实视频生成必须每次确认
    if (!req.alwaysConfirm && skipConfirmRef.current.has(req.capability)) {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      setCostPrompt({
        capability: req.capability,
        modelLabel: req.modelLabel,
        calls: req.calls,
        ...(req.note ? { note: req.note } : {}),
        ...(req.alwaysConfirm ? { alwaysConfirm: true } : {}),
        resolve: (ok: boolean, remember?: boolean) => {
          if (ok && remember && !req.alwaysConfirm) skipConfirmRef.current.add(req.capability)
          setCostPrompt(null)
          resolve(ok)
        },
      })
    })
  }, [])

  const run = async (text: string) => {
    if (running || !session) return
    if (!hostSkill) {
      setActionError(skillError || '技能尚未加载')
      return
    }
    if (!modelKey) {
      setActionError('没有可用的文本模型，请到设置页绑定「创意」环节')
      return
    }
    setActionError('')
    paidCallsRef.current = { count: 0, max: creative.limits?.maxPaidCallsPerTurn ?? 8 }
    frameCache.current = new Map()

    let prompt
    try {
      prompt = buildSkillPrompt(hostSkill, {
        mode: MODE_HINT[mode],
        sourceLabel: session.sources[0]?.title || session.sources[0]?.url || '（尚未提供源视频）',
        shotCount: String((session.sources[0] && (session.shots || {})[session.sources[0].id]?.length) || 0),
        aspect: String(settings?.models?.length ? '9:16' : '9:16'),
        topic: text,
        constraints: '',
      }, 'chat')
    } catch (e) {
      setActionError((e as Error).message || String(e))
      return
    }

    const set = createCreativeToolSet({
      sessionId: session.id,
      getSnapshot: snapshot,
      confirmCost,
      settings,
      creative,
      modelLabel: settings?.models?.find((m) => m.key === modelKey)?.label || modelKey,
      frameCache: frameCache.current,
      generateImage: async ({ prompt, modelKey }) => {
        const r = await generateImage({ prompt, ratio: '9:16', n: 1, modelKey })
        const url = r.urls?.[0] || (r as { url?: string }).url || ''
        return { kind: 'image', url }
      },
      generateVideo: async ({ prompt, image, modelKey }) => {
        const started = await startVideo({
          prompt,
          seconds: 5,
          ratio: '9:16',
          modelKey,
          ...(image ? { image } : {}),
        })
        const done = await waitVideo(started.id)
        return { kind: 'video', url: done.url }
      },
      generateVoice: async ({ text, modelKey }) => {
        const r = await generateVoice({ text, modelKey })
        return { kind: 'audio', url: (r as { url?: string }).url || '' }
      },
      signal: abortRef.current?.signal,
      paidCalls: paidCallsRef.current,
      onSourceChanged: () => void refreshSession(),
      onArtifactChanged: () => void refreshSession(),
    })
    const tools = bindCreativeTools(set, [{ skill: hostSkill, mode: 'host' }])
    const system = prompt.system
    const taskCard = prompt.task ? `【本轮技能任务】\n${prompt.task}` : ''
    const userForModel = taskCard ? `${taskCard}\n\n【用户要求】\n${text}` : text
    const history = threadTranscript(messages)

    begin(text)
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    try {
      const result = await runStageAgent({
        userText: userForModel,
        system,
        tools,
        history,
        modelKey,
        stage: 'creative',
        signal: controller.signal,
        onEvent: updateEvent,
      })
      if (result.cancelled) {
        patchAssistant((m) => (m.status === 'cancelled' ? m : { ...m, status: 'cancelled' }))
      } else if (result.error) {
        patchAssistant((m) =>
          m.status === 'error' ? m : { ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${result.error}` }] },
        )
        onToast?.(result.error)
      } else {
        patchAssistant((m) => ({ ...m, status: 'complete' }))
      }
    } catch (e) {
      const msg = (e as Error).message || String(e)
      patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${msg}` }] }))
      onToast?.(msg)
    } finally {
      abortRef.current = null
      setRunning(false)
      void refreshSession()
      // 一轮结束后立刻落盘：不依赖防抖，切视图也不会丢
      void saveCreativeThread(session.id, messagesRef.current, []).catch(() => {})
      // 首条消息后自动起标题
      if (!session.title) {
        const title = autoTitle(text)
        if (title) void renameSession(session.id, title)
      }
    }
  }

  /** 上传或粘链接：摄取源视频 */
  const ingest = async (input: { url?: string; data?: string; name?: string }) => {
    if (!session) return
    setBusyAction('ingest')
    setActionError('')
    try {
      const r = await ingestCreative({ sessionId: session.id, ...input })
      await refreshSession()
      onToast?.(
        `已摄取 ${r.source.platform || '视频'}${r.probeError ? `（技术信息读取失败：${r.probeError.slice(0, 60)}）` : ''}`,
      )
      if (r.probeError) setActionError(`源视频已保存，但无法读取媒体信息：${r.probeError}`)
      return r.source
    } catch (e) {
      const msg = (e as Error).message || String(e)
      setActionError(msg)
      onToast?.(msg)
      return null
    } finally {
      setBusyAction('')
    }
  }

  const runSplit = async (sourceId: string) => {
    setBusyAction('split')
    setActionError('')
    try {
      const r = await splitCreativeSource(sourceId)
      await refreshSession()
      onToast?.(`切出 ${r.shots.length} 个镜头`)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      setActionError(msg)
      onToast?.(msg)
    } finally {
      setBusyAction('')
    }
  }

  const runFrames = async (sourceId: string) => {
    setBusyAction('frames')
    setActionError('')
    try {
      const r = await extractFrames(sourceId, { framesPerShot: creative.analysis?.framesPerShot ?? 1 })
      await refreshSession()
      onToast?.(`抽帧完成：${r.shots.filter((s) => s.frames.length).length}/${r.shots.length} 镜`)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      setActionError(msg)
      onToast?.(msg)
    } finally {
      setBusyAction('')
    }
  }

  const copyPack = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast?.('已复制提示词')
    } catch {
      onToast?.('复制失败，请手动选择文本')
    }
  }

  const exportPack = async (artifact: CreativeArtifact) => {
    try {
      const r = await downloadCreativeExport(artifact.id)
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(r.title || 'reverse-pack').replace(/[\\/:*?"<>|]+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
      onToast?.('已导出 JSON')
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  /**
   * 生成结果卡片：从本次会话的工具结果里提取。
   * 只认带 url 的成功结果；失败的留在工具卡里，不上产物区。
   */
  const generatedCards = useMemo(() => {
    const out: Array<{ id: string; kind: 'image' | 'video' | 'audio'; url: string; modelLabel?: string }> = []
    for (const m of messages) {
      for (const part of m.parts) {
        if (part.type !== 'tool-call') continue
        if (!part.toolName.startsWith('generate_')) continue
        const r = (part.result && typeof part.result === 'object' ? part.result : {}) as Record<string, unknown>
        if (r.ok === false) continue
        const inner = (r.result && typeof r.result === 'object' ? r.result : {}) as Record<string, unknown>
        const url = String(inner.url || '')
        if (!url) continue
        const kind = part.toolName === 'generate_image' ? 'image' : part.toolName === 'generate_video' ? 'video' : 'audio'
        out.push({
          id: part.toolCallId,
          kind,
          url,
          ...(r.modelLabel ? { modelLabel: String(r.modelLabel) } : {}),
        })
      }
    }
    return out
  }, [messages])

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const text = appendText(message)
      if (!text) return
      await run(text)
    },
    onCancel: async () => {
      abortRef.current?.abort()
      setRunning(false)
    },
  })

  const canSend = Boolean(session && hostSkill && modelKey) && !running && !loading

  return (
    <CreativeChatContext.Provider value={{ creative, confirmCost, refreshSession }}>
      <div className="creative-studio" data-creative-studio data-mode={mode}>
        <CreativeSessionList
          sessions={sessions}
          activeId={session?.id || ''}
          open={listOpen}
          onToggle={() => setListOpen((v) => !v)}
          onSelect={(id) => void openSession(id)}
          onNew={() => void newSession()}
          onRename={(id, title) => void renameSession(id, title)}
          onDelete={(id) => void removeSession(id)}
        />
        <div className="creative-main">
          <CreativeHeader
            mode={mode}
            onModeChange={(m) => void changeMode(m)}
            sessionTitle={session?.title || ''}
            modelKey={modelKey}
            modelLabel={
              modelKey
                ? (() => {
                    const m = settings?.models?.find((x) => x.key === modelKey)
                    return m ? `${m.label} · ${m.model}` : modelKey
                  })()
                : '未绑定文本模型'
            }
            modelShort={
              modelKey
                ? settings?.models?.find((x) => x.key === modelKey)?.model || modelKey
                : '未绑定文本模型'
            }
            skillId={hostSkill?.id || MODE_SKILL[mode]}
            skillError={skillError}
            running={running}
            sources={session?.sources.length || 0}
            artifacts={session?.artifacts.length || 0}
            onOpenList={() => setListOpen(true)}
            onRefresh={() => void refreshSession()}
            capabilityTray={
              <CapabilityTray
                settings={settings}
                creative={creative}
                onChange={(models) => void saveCapabilityModels(models)}
              />
            }
          />

          {loadError ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="text-[12px] text-destructive">{loadError}</p>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-[11px]"
                onClick={() => {
                  setLoadError('')
                  setLoading(true)
                  void listCreativeSessions(50)
                    .then((list) => {
                      setSessions(list)
                      if (list[0]) return openSession(list[0].id)
                      return createCreativeSession({ mode }).then((s) => openSession(s.id))
                    })
                    .finally(() => setLoading(false))
                }}
              >
                重试
              </button>
            </div>
          ) : (
            <>
              {actionError ? (
                <div
                  data-creative-error
                  className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive"
                >
                  {actionError}
                </div>
              ) : null}
              <ChatThreadShell runtime={runtime} running={running} toolUis={<CreativeToolUis />}>
                <div className="creative-body">
                  <div className="creative-conversation">
                    <ChatThreadBody
                      UserMessage={UserMessage}
                      AssistantMessage={AssistantMessage}
                      empty={
                        <CreativeEmpty
                          mode={mode}
                          loading={loading}
                          hasSource={Boolean(session?.sources.length)}
                          onUpload={(data, name) => void ingest({ data, name })}
                        />
                      }
                      emptyAlign="bottom"
                      placeholder={
                        mode === 'plan'
                          ? '说说你想拍什么，例如：15 秒咖啡广告，前三秒要抓人…'
                          : '粘一个抖音/B 站/TikTok 链接，或上传视频后说「反推提示词」…'
                      }
                      inputLabel="创意聊天输入"
                      suggestions={
                        mode === 'plan'
                          ? ['给我三个 15 秒短剧方向', '把这个想法拆成 8 个镜头', '前三秒怎么更抓人']
                          : ['反推提示词', '逐镜分析', '只重写第 2、5 镜']
                      }
                      disabled={!canSend}
                      hint={
                        canSend
                          ? 'Enter 发送 · Shift+Enter 换行 · 付费调用会先确认'
                          : skillError || '正在准备会话…'
                      }
                      cancelLabel="停止"
                    />
                    {mode !== 'plan' ? (
                      <CreativeComposerBar
                        session={session}
                        busy={busyAction}
                        disabled={running || !session}
                        onUrl={(url) => void ingest({ url })}
                        onUpload={(data, name) => void ingest({ data, name })}
                        onSplit={() => session?.sources[0] && void runSplit(session.sources[0].id)}
                        onFrames={() => session?.sources[0] && void runFrames(session.sources[0].id)}
                      />
                    ) : null}
                  </div>
                  <CreativeArtifacts
                    session={session}
                    generated={generatedCards}
                    busy={Boolean(busyAction) || running}
                    busyAction={busyAction}
                    onSplit={(id) => void runSplit(id)}
                    onFrames={(id) => void runFrames(id)}
                    onCopy={(t) => void copyPack(t)}
                    onExport={(a) => exportPack(a)}
                    onPromote={(a) => setPromoteArtifact(a)}
                  />
                </div>
              </ChatThreadShell>

            </>
          )}
        </div>

        {costPrompt ? (
          <CostConfirmDialog prompt={costPrompt} onResolve={(ok, remember) => costPrompt.resolve(ok, remember)} />
        ) : null}
        {promoteArtifact ? (
          <PromoteDialog
            artifact={promoteArtifact}
            settings={settings}
            onClose={() => setPromoteArtifact(null)}
            onDone={(msg) => {
              setPromoteArtifact(null)
              onToast?.(msg)
              onProjectDataChanged?.()
            }}
          />
        ) : null}
      </div>
    </CreativeChatContext.Provider>
  )
}

export { MODE_HINT, MODE_SKILL }
export type { CreativeArtifact, CreativeSessionSummary }
