import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessagePrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { AppSettings } from '../api'
import { stageDefaultLabel, stageModelKey, type StagePick } from '../ModelSelect'
import { buildSkillPrompt } from '../skills/render'
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
import { runStageAgent } from './stageAgentGraph'
import { loadChatThread, saveChatThread, threadTranscript, type ActiveSkill, type ChatThreadKey } from './threads'
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
}

const SKILL_BANNER = /^技能 [a-z0-9-]+ · (?:builtin|override|local) · v\d+/i
const STEP_LINE = /^第 (\d+) 轮 · ([\s\S]*)$/

function builtinId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `builtin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function textLength(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
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
}: Props) {
  const {
    messages,
    setMessages,
    running,
    setRunning,
    abortRef,
    begin,
    updateEvent,
    patchAssistant,
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

  const threadKey = adapter.threadKey
  const key = [threadKey.project, threadKey.surface, threadKey.episode || 0, threadKey.shotId || ''].join('|')

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
              s.manifest.runtime === 'json-tools' &&
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
    if (!loaded || running || !messages.length) return
    const timer = setTimeout(() => {
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
      if (prev && messagesRef.current.length) {
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

  const contextStats = useMemo<WorkbenchContextStats | null>(() => {
    if (!loaded || !hostSkill) return null
    try {
      const inputs = adapter.inputs()
      const prompt = buildSkillPrompt(hostSkill, inputs, 'chat')
      const entries = Object.entries(inputs).map(([key, value]) => ({
        key,
        label: profile.inputLabels[key] || key,
        chars: textLength(value),
        mode: prompt.references.some((r) => r.key === key) ? ('tool' as const) : ('inline' as const),
      }))
      return {
        entries,
        total: prompt.system.length + prompt.task.length,
        referenceCount: prompt.references.length,
      }
    } catch {
      return null
    }
  }, [adapter, hostSkill, loaded, profile, messages.length, running])

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

  const readonlySystemText = () =>
    readonly
      .map((s) => {
        try {
          return `【只读技能：${s.id}】\n${buildSkillPrompt(s, {}, 'chat').system}`
        } catch {
          return ''
        }
      })
      .filter(Boolean)

  const makeTaskView = (
    host: Skill,
    inputs: Record<string, unknown>,
    prompt: ReturnType<typeof buildSkillPrompt>,
    system: string,
  ): WorkbenchTaskView => ({
    system,
    task: prompt.task,
    inputs,
    references: prompt.references,
    missing: prompt.missing,
    modelLabel,
    skillId: host.id,
    skillTitle: profile.title,
    skillSource: host.source,
    skillVersion: host.manifest.version,
    readonly: readonly.map((s) => ({ id: s.id, version: s.manifest.version })),
    readTools: host.manifest.tools.filter((t) => t.startsWith('read_')),
    saveMode: profile.saveMode,
  })

  const preview = () => {
    if (!hostSkill) return
    try {
      const inputs = adapter.inputs()
      const prompt = buildSkillPrompt(hostSkill, inputs, 'chat')
      const system = [prompt.system, ...readonlySystemText()].join('\n\n')
      setTaskView(makeTaskView(hostSkill, inputs, prompt, system))
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  const run = async (text: string) => {
    if (running || builtinRunRef.current) return
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
    let hostPrompt
    try {
      hostPrompt = buildSkillPrompt(host, adapter.inputs(), 'chat')
      if (hostPrompt.missing.length) {
        throw new Error(`技能输入缺失：${hostPrompt.missing.join('、')}`)
      }
    } catch (e) {
      const message = (e as Error).message || String(e)
      setActionError(message)
      onToast?.(message)
      return
    }
    const readonlySystem = readonlySystemText()
    const system = [hostPrompt.system, ...readonlySystem].join('\n\n')
    const taskCard = hostPrompt.task ? `【本轮技能任务】\n${hostPrompt.task}` : ''
    const userForModel = taskCard ? `${taskCard}\n\n【用户要求】\n${text}` : text
    const tools = bindSkillTools(createStageToolSet(adapter), [
      { skill: host, mode: 'host' },
      ...readonly.map((s) => ({ skill: s, mode: 'readonly' as const })),
    ])
    const history = threadTranscript(messages)
    setTaskView(makeTaskView(host, adapter.inputs(), hostPrompt, system))

    userStartedRef.current = true
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
        stage: adapter.stage,
        signal: controller.signal,
        onEvent: updateEvent,
      })
      if (result.cancelled) {
        patchAssistant((m) => (m.status === 'cancelled' ? m : { ...m, status: 'cancelled' }))
      } else if (result.error) {
        patchAssistant((m) =>
          m.status === 'error'
            ? m
            : { ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${result.error}` }] },
        )
        onToast?.(result.error)
      } else {
        patchAssistant((m) => ({ ...m, status: 'complete' }))
      }
    } catch (e) {
      const message = (e as Error).message || String(e)
      patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${message}` }] }))
      onToast?.(message)
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  /** 显式内置动作：用户点击触发，走宿主函数；不进入模型工具循环。 */
  const runBuiltinAction = async (action: BuiltinAction) => {
    if (running || builtinRunRef.current) return
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
    } catch (e) {
      const message = (e as Error).message || '内置动作失败'
      const result = builtinFailure(action.key, message, {
        label,
        scope: action.scope,
        saveMode: profile.saveMode,
      })
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
    } finally {
      setBuiltinRun(null)
    }
  }

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
  }

  return (
    <div className="skill-chat chat-ui" data-skill-chat={adapter.surface}>
      <WorkbenchHeader
        title={profile.title}
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
              <ChatThreadShell runtime={runtime} running={running} toolUis={<StageToolUis />}>
                <ChatThreadBody
                  UserMessage={UserMessage}
                  AssistantMessage={AssistantMessage}
                  empty={
                    <WorkbenchEmpty
                      profile={profile}
                      loading={!loaded}
                      actions={loaded && hostSkill ? adapter.builtins ?? [] : []}
                      onRunAction={(action) => void runBuiltinAction(action)}
                      running={busy}
                    />
                  }
                  emptyAlign="bottom"
                  placeholder={profile.placeholder}
                  inputLabel={`${adapter.surface} 技能聊天输入`}
                  suggestions={loaded && messages.length === 0 ? profile.suggestions : undefined}
                  disabled={!loaded || !hostSkill || busy}
                  hint="Enter 发送 · Shift+Enter 换行"
                  cancelLabel="停止"
                />
              </ChatThreadShell>
            </WorkbenchChatContext.Provider>
          )}
        </>
      )}
    </div>
  )
}
