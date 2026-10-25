import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ChatErrorNote, ChatStoppedNote } from '@/chat-ui/WorkbenchNotes'
import { WorkbenchHeader, type WorkbenchContextStats } from '@/chat-ui/WorkbenchHeader'
import { WorkbenchInspector } from '@/chat-ui/WorkbenchInspector'
import { ChatThreadBody, ChatThreadShell } from '../agent/ChatThreadShell'
import { useAgentMessages } from '../agent/useAgentMessages'
import { runStageAgent } from '../agent/stageAgentGraph'
import { loadChatThread, saveChatThread, threadTranscript, type ActiveSkill, type ChatThreadKey } from '../agent/threads'
import type { AgentMessage } from '../agent/sceneAgentTypes'
import type { WorkbenchProfile, WorkbenchTaskView } from '../agent/workbenchChat'
import { WorkbenchChatContext } from '../agent/workbenchChatContext'
import { computeReadiness, readinessSummary, type PublishChatAdapter } from './publishChat'
import { createPublishToolSet } from './publishTools'
import { PublishToolUis } from './publishReceipts'
import ReadinessBar from './ReadinessBar'

const SKILL_BANNER = /^技能 [a-z0-9-]+ · (?:builtin|override|local) · v\d+/i
const STEP_LINE = /^第 (\d+) 轮 · ([\s\S]*)$/

/** 发布助手没有内置动作，也没有草稿保存语义；这四项只为复用工作台壳。 */
const PUBLISH_PROFILE: WorkbenchProfile = {
  title: '发布助手',
  emptyTitle: '把这条成片准备好',
  emptyBody:
    '我替你选平台、写分平台文案、备封面、查预检、连账号，然后把提交暂存成一张待你确认的卡。最终发布按钮永远由你点。',
  suggestions: [
    '这条发抖音和小红书，标题各写一版',
    '检查还差什么才能发',
    '连接小红书账号',
    '只存草稿，不要公开发布',
  ],
  placeholder: '例如：发抖音和小红书，标题压到 18 字以内…',
  saveMode: 'immediate',
  inputLabels: { deliverable: '成片', config: '发布配置', readySummary: '准备度' },
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

function textOfMessage(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function convertMessage(message: AgentMessage): ThreadMessageLike {
  type Part = Exclude<ThreadMessageLike['content'], string>[number]
  const content: Part[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
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

type Props = {
  adapter: PublishChatAdapter
  settings: AppSettings | null
  stagePick?: StagePick
  onToast?: (message: string) => void
  onRunningChange?: (running: boolean) => void
  onClose?: () => void
}

/**
 * 发布助手：复用工作台聊天壳，但宿主契约换成发布配置。
 * 线程按项目 + 集持久化；工具只改配置或暂存意图，不提交。
 */
export default function PublishChat({ adapter, settings, stagePick, onToast, onRunningChange, onClose }: Props) {
  const { messages, setMessages, running, setRunning, abortRef, begin, updateEvent, patchAssistant } =
    useAgentMessages()

  const modelLabel = stageDefaultLabel(settings, 'publish', stagePick)
  const modelReady = Boolean(stageModelKey(settings, 'publish', stagePick))

  const [hostSkill, setHostSkill] = useState<Skill | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadNonce, setLoadNonce] = useState(0)
  const [inspectOpen, setInspectOpen] = useState(false)
  const [taskView, setTaskView] = useState<WorkbenchTaskView | null>(null)
  const [actionError, setActionError] = useState('')
  const [readinessTick, setReadinessTick] = useState(0)

  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const lastKeyRef = useRef<{ key: string; threadKey: ChatThreadKey } | null>(null)

  const threadKey = adapter.threadKey
  const key = [threadKey.project, threadKey.surface, threadKey.episode || 0, threadKey.shotId || ''].join('|')

  const scope = useMemo(() => {
    try {
      return adapter.scope() || '当前项目'
    } catch {
      return '当前项目'
    }
  }, [adapter, readinessTick])

  useEffect(() => {
    const prev = lastKeyRef.current
    const changed = Boolean(prev && prev.key !== key)
    if (changed && prev) {
      void saveChatThread(prev.threadKey, messagesRef.current, []).catch(() => {})
    }
    lastKeyRef.current = { key, threadKey }
    let alive = true
    setLoaded(false)
    setLoadError('')
    ;(async () => {
      try {
        const { skills, issues } = await loadSkills()
        const host = skills.get('publish')
        if (!host) {
          throw new Error(issues.find((x) => x.id === 'publish')?.message || '技能「publish」不可用')
        }
        if (!alive) return
        setHostSkill(host)
        const thread = await loadChatThread(threadKey)
        if (!alive) return
        setMessages(
          (thread?.messages || []).map((m) => ({
            ...m,
            status: m.status === 'running' ? ('cancelled' as const) : m.status,
          })),
        )
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
      void saveChatThread(adapterRef.current.threadKey, messages, []).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [messages, running, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      const prev = lastKeyRef.current
      if (prev && messagesRef.current.length) {
        void saveChatThread(prev.threadKey, messagesRef.current, []).catch(() => {})
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onRunningChange?.(running)
  }, [onRunningChange, running])

  const readiness = useMemo(() => {
    const s = adapter.snapshot()
    return computeReadiness({
      config: s.config,
      platforms: s.platforms,
      accounts: s.accounts,
      preflight: s.preflight,
    })
    // adapter.snapshot 每次返回新对象，用 readinessTick 作为显式刷新信号
  }, [adapter, readinessTick, messages.length, running])

  /** 技能输入：只放成片标识、配置摘要与准备度文本，不内联整份配置 */
  const skillInputs = useCallback(() => {
    const s = adapter.snapshot()
    const d = s.deliverable
    return {
      deliverable: d
        ? `E${String(d.episode).padStart(2, '0')} · v${d.version} · ${d.width || '?'}×${d.height || '?'} · ${Math.round(d.duration || 0)}s`
        : '（未选中成片）',
      config: {
        master: s.config.master,
        selected: Object.entries(s.config.targets || {})
          .filter(([, t]) => t.selected)
          .map(([platform, t]) => ({ platform, mode: t.mode, accountId: t.accountId, override: t.override })),
        cover: Object.keys(s.config.cover || {}),
      },
      readySummary: readinessSummary(readiness),
    }
  }, [adapter, readiness])

  const contextStats = useMemo<WorkbenchContextStats | null>(() => {
    if (!loaded || !hostSkill) return null
    try {
      const inputs = skillInputs()
      const prompt = buildSkillPrompt(hostSkill, inputs, 'chat')
      const entries = Object.entries(inputs).map(([k, value]) => ({
        key: k,
        label: PUBLISH_PROFILE.inputLabels[k] || k,
        chars: textLength(value),
        mode: prompt.references.some((r) => r.key === k) ? ('tool' as const) : ('inline' as const),
      }))
      return {
        entries,
        total: prompt.system.length + prompt.task.length,
        referenceCount: prompt.references.length,
      }
    } catch {
      return null
    }
  }, [hostSkill, loaded, skillInputs, messages.length, running])

  const preview = () => {
    if (!hostSkill) return
    try {
      const inputs = skillInputs()
      const prompt = buildSkillPrompt(hostSkill, inputs, 'chat')
      setTaskView({
        system: prompt.system,
        task: prompt.task,
        inputs,
        references: prompt.references,
        missing: prompt.missing,
        modelLabel,
        skillId: hostSkill.id,
        skillTitle: PUBLISH_PROFILE.title,
        skillSource: hostSkill.source,
        skillVersion: hostSkill.manifest.version,
        readonly: [],
        readTools: hostSkill.manifest.tools.filter((t) => t.startsWith('read_')),
        saveMode: 'immediate',
      } as WorkbenchTaskView)
    } catch (e) {
      onToast?.((e as Error).message || String(e))
    }
  }

  const run = async (text: string) => {
    if (running) return
    setActionError('')
    const host = hostSkill
    if (!host) {
      setActionError('技能尚未加载')
      return
    }
    const modelKey = stageModelKey(settings, 'publish', stagePick)
    if (!modelKey) {
      setActionError('没有可用的文本模型，请到设置页绑定「发布」环节')
      onToast?.('没有可用的文本模型，请到设置页绑定「发布」环节')
      return
    }
    let hostPrompt
    try {
      hostPrompt = buildSkillPrompt(host, skillInputs(), 'chat')
      if (hostPrompt.missing.length) throw new Error(`技能输入缺失：${hostPrompt.missing.join('、')}`)
    } catch (e) {
      const message = (e as Error).message || String(e)
      setActionError(message)
      onToast?.(message)
      return
    }
    const system = hostPrompt.system
    const taskCard = hostPrompt.task ? `【本轮技能任务】\n${hostPrompt.task}` : ''
    const userForModel = taskCard ? `${taskCard}\n\n【用户要求】\n${text}` : text
    const tools = [...createPublishToolSet(adapter).values()]
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
        stage: 'publish',
        signal: controller.signal,
        onEvent: updateEvent,
      })
      setReadinessTick((v) => v + 1)
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

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const status: 'ready' | 'running' | 'error' =
    running ? 'running' : lastAssistant?.status === 'error' ? 'error' : 'ready'

  const contextValue = {
    // 发布台没有产物草稿；surface 只为让工具卡能读到运行态
    surface: 'script' as const,
    saveMode: 'immediate' as const,
    onRetry: lastUserText && !running ? () => void run(lastUserText) : undefined,
    running,
  }

  return (
    <div className="skill-chat chat-ui" data-skill-chat="publish" data-publish-chat="">
      <WorkbenchHeader
        title={PUBLISH_PROFILE.title}
        scope={scope}
        hostSkillId={hostSkill?.id || 'publish'}
        modelLabel={modelLabel}
        modelReady={modelReady}
        running={running}
        busyLabel={running ? '正在改…' : undefined}
        status={status}
        stats={contextStats}
        readonly={[]}
        available={[]}
        onLoadReadonly={() => {}}
        onRemoveReadonly={() => {}}
        inspectOpen={inspectOpen}
        canInspect={Boolean(hostSkill) && !loadError}
        onToggleInspect={() => {
          if (!inspectOpen) preview()
          setInspectOpen((v) => !v)
        }}
        onClose={onClose}
      />

      <div data-publish-boundary className="shrink-0 border-b border-border/60 bg-secondary/30 px-3 py-1 text-[10px] text-muted-foreground">
        可上传草稿与导出发布包 · 最终发布按钮只有你能点
      </div>

      <ReadinessBar
        readiness={readiness}
        disabled={running}
        onJump={(cell) => adapter.onReadinessJump?.(cell)}
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
              profile={PUBLISH_PROFILE}
              onClose={() => setInspectOpen(false)}
              onToast={onToast}
            />
          ) : (
            <WorkbenchChatContext.Provider value={contextValue}>
              <ChatThreadShell
                runtime={runtime}
                running={running}
                toolUis={<PublishToolUis adapter={adapter} onPickOption={(value) => void run(value)} />}
              >
                <ChatThreadBody
                  UserMessage={UserMessage}
                  AssistantMessage={AssistantMessage}
                  empty={
                    <div data-chat-empty className="px-3 py-4 text-[12px] leading-relaxed">
                      {!loaded ? (
                        <>
                          <div className="text-[13px] font-semibold text-foreground">正在加载助手…</div>
                          <p className="mt-1 text-muted-foreground">技能加载完成后就可以开始。</p>
                        </>
                      ) : !adapter.snapshot().deliverable ? (
                        <div data-chat-no-deliverable>
                          <div className="text-[13px] font-semibold text-foreground">这一集还没有成片</div>
                          <p className="mt-1 text-muted-foreground">
                            我可以帮你写文案、查平台规则、准备发布包，但要先有片子才能提交。
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {adapter.onImportDeliverable ? (
                              <button
                                type="button"
                                data-chat-import
                                className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                                onClick={adapter.onImportDeliverable}
                              >
                                导入 MP4
                              </button>
                            ) : null}
                            {adapter.onGoExport ? (
                              <button
                                type="button"
                                data-chat-go-export
                                className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                                onClick={adapter.onGoExport}
                              >
                                去预览导出成片
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-[13px] font-semibold text-foreground">{PUBLISH_PROFILE.emptyTitle}</div>
                          <p className="mt-1 text-muted-foreground">{PUBLISH_PROFILE.emptyBody}</p>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            点下面的示例只填入输入框，不会直接发送。
                          </p>
                        </>
                      )}
                    </div>
                  }
                  emptyAlign="bottom"
                  placeholder={PUBLISH_PROFILE.placeholder}
                  inputLabel="发布助手输入"
                  suggestions={
                    loaded && messages.length === 0 && adapter.snapshot().deliverable
                      ? PUBLISH_PROFILE.suggestions
                      : undefined
                  }
                  // 没有成片时不阻止输入：助手可以帮忙写文案与解释平台规则
                  disabled={!loaded || !hostSkill || running}
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

export { PUBLISH_PROFILE }
