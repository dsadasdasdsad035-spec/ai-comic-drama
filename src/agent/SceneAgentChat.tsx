import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  MessagePrimitive,
  makeAssistantToolUI,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { AppSettings } from '../api'
import type { StagePick } from '../ModelSelect'
import { resolveStageModel } from '../ModelSelect'
import { resolveToolProtocol } from './toolCapabilities'
import type { SceneCodeCheck } from '../sceneCodeSanitize'
import type { PreparedCodeContext } from '../sceneCodePrepare'
import { runSceneAgent, resolveSceneAgentEngine } from './sceneAgentGraph'
import { manifestSummary, manifestText, type ContextManifest } from '../contextManifest'
import { AgentBlenderSession } from './agentSandbox'
import { applyAgentEvent } from './agentMessageReducer'
import { reviewFramesWithVision } from './agentReview'
import { agentVideoSummary, runVideoAcceptance, type AgentVideoAcceptanceResult } from './agentVideoAcceptance'
import {
  DUEL_REQUIREMENTS,
  type AgentEvent,
  type AgentFrame,
  type AgentMessage,
  type AgentMessagePart,
  type AgentReview,
  type AgentToolPart,
  type AgentVideoAcceptedInput,
  type AgentVideoPart,
  type AgentVideoReviewPart,
  type SceneAgentDeps,
} from './sceneAgentTypes'
import { ChatContextTray } from '@/chat-ui/ChatContextTray'
import { ChatContextInspector } from '@/chat-ui/ChatContextInspector'
import { ChatContextPart } from '@/chat-ui/ChatContextPart'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { DraftPart, DraftTool } from '@/chat-ui/tools/DraftTools'
import { sceneDraftClient } from '../sceneDraft'
import { ChatThreadBody, ChatThreadShell } from './ChatThreadShell'
import { loadChatThread, saveChatThread } from './threads'
import { getSkill } from '../skills/registry'
import { buildSkillPrompt } from '../skills/render'
import type { Skill } from '../skills/types'
import {
  CodeTool,
  ContextTool,
  FinishTool,
  FramesTool,
  ReviewTool,
  SandboxTool,
  VideoPart,
  VideoReviewPart,
  VideoUiContext,
} from '@/chat-ui/tools'
import '@/chat-ui/chat.css'

const AgentUiContext = createContext<{ openCode: () => void }>({ openCode: () => {} })

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

function contextTextOf(manifest: ContextManifest, prepared: PreparedCodeContext): string {
  const briefs: Record<string, string> = {}
  for (const item of prepared.mediaBrief.items ?? []) {
    if (item.key && item.description) briefs[item.key] = item.description
  }
  const assetMeta: Record<string, { width?: number; height?: number }> = {}
  for (const a of prepared.assets) {
    assetMeta[a.ref.key] = {
      ...(a.payload.width ? { width: a.payload.width } : {}),
      ...(a.payload.height ? { height: a.payload.height } : {}),
    }
  }
  const text = manifestText(manifest, briefs, 12000, assetMeta)
  const notes = [
    ...prepared.missing.map((m) => `${m.label}（${m.reason}）`),
    ...prepared.warnings,
  ]
  return notes.length ? `${text}\n【注意】${notes.join('；')}` : text
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

type VideoSession = {
  videoId: string
  messageId: string
  code: string
  codeHash: string
  prepared: PreparedCodeContext
  requirements: string[]
  result?: AgentVideoAcceptanceResult
}

const DRAFT_TOOL_NAMES = new Set([
  'begin_scene_draft',
  'append_scene_draft',
  'read_scene_draft',
  'patch_scene_draft',
  'commit_scene_draft',
  'discard_scene_draft',
])

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
    } else if (part.type === 'context') {
      content.push({ type: 'data', name: 'agent-context', data: part })
    } else if (part.type === 'draft') {
      content.push({ type: 'data', name: 'agent-draft', data: part })
    } else if (part.type === 'tool-call') {
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        // 草稿分片是代码正文，不放进聊天运行时/线程文件。
        ...(part.args && !DRAFT_TOOL_NAMES.has(part.toolName) ? { args: part.args as never } : {}),
        ...(part.result !== undefined ? { result: part.result } : {}),
        ...(part.isError ? { isError: true } : {}),
      })
    } else if (part.type === 'video') {
      content.push({ type: 'data', name: 'agent-video', data: part })
    } else if (part.type === 'video-review') {
      content.push({ type: 'data', name: 'agent-video-review', data: part })
    }
    // 代码/帧/清单由对应工具卡的 result 渲染，不在聊天里复制一份。
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

const RunSandboxUI = makeAssistantToolUI({
  toolName: 'run_render',
  render: ({ status, result }) => <SandboxTool running={status.type === 'running'} result={result} />,
})

const SetSceneCodeUI = makeAssistantToolUI({
  toolName: 'set_scene_code',
  render: ({ status, result }) => {
    const { openCode } = useContext(AgentUiContext)
    return <CodeTool running={status.type === 'running'} result={result} onOpenCode={openCode} />
  },
})

const CaptureFramesUI = makeAssistantToolUI({
  toolName: 'capture_frames',
  render: ({ status, result }) => <FramesTool running={status.type === 'running'} result={result} />,
})

const ReviewFramesUI = makeAssistantToolUI({
  toolName: 'review_frames',
  render: ({ status, result }) => <ReviewTool running={status.type === 'running'} result={result} />,
})

const GetContextUI = makeAssistantToolUI({
  toolName: 'get_shot_context',
  render: ({ status }) => <ContextTool running={status.type === 'running'} />,
})

function draftToolUi(toolName: string) {
  return makeAssistantToolUI({
    toolName,
    render: ({ status, result }) => (
      <DraftTool tool={toolName} running={status.type === 'running'} result={result} />
    ),
  })
}

const DraftBeginUI = draftToolUi('begin_scene_draft')
const DraftAppendUI = draftToolUi('append_scene_draft')
const DraftReadUI = draftToolUi('read_scene_draft')
const DraftPatchUI = draftToolUi('patch_scene_draft')
const DraftCommitUI = draftToolUi('commit_scene_draft')
const DraftDiscardUI = draftToolUi('discard_scene_draft')

const FinishUI = makeAssistantToolUI({
  toolName: 'finish',
  render: ({ status, result }) => <FinishTool running={status.type === 'running'} result={result} />,
})

function UserMessage() {
  return (
    <ChatMessage role="user">
      <MessagePrimitive.Parts components={{ Text: ChatText }} />
    </ChatMessage>
  )
}

function AssistantMessage() {
  return (
    <ChatMessage role="assistant">
      <MessagePrimitive.Parts
        components={{
          Text: ChatText,
          data: {
            by_name: {
              'agent-video': VideoPart,
              'agent-video-review': VideoReviewPart,
              'agent-context': ChatContextPart,
              'agent-draft': DraftPart,
            },
          },
        }}
        unstable_showEmptyOnNonTextEnd={false}
      />
    </ChatMessage>
  )
}

type Props = {
  settings: AppSettings | null
  stagePick?: StagePick
  manifest: ContextManifest
  /** 3D 线程键：项目 + 镜头；关闭工作台后可恢复 */
  threadKey: { project: string; surface: 'scene3d'; shotId: string }
  onRemoveAttachment: (key: string) => void
  onToggleBrief?: (key: string) => void
  onClearAttachments?: () => void
  prepareAgent: () => Promise<PreparedCodeContext>
  onDraftCode: (code: string, check: SceneCodeCheck, prepared: PreparedCodeContext) => Promise<void> | void
  onVideoAccepted: (input: AgentVideoAcceptedInput) => Promise<void>
  onOpenCode: () => void
  onToast?: (message: string) => void
  /** 工作台当前代码；作为本轮可运行基线 */
  currentCode?: string
  requirements?: string[]
  width: number
  height: number
  aspect: string
  duration: number
}

export default function SceneAgentChat({
  settings,
  stagePick,
  manifest,
  threadKey,
  onRemoveAttachment,
  onToggleBrief,
  onClearAttachments,
  prepareAgent,
  onDraftCode,
  onVideoAccepted,
  onOpenCode,
  onToast,
  currentCode,
  requirements,
  width,
  height,
  aspect,
  duration,
}: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [preparedSnapshot, setPreparedSnapshot] = useState<PreparedCodeContext | null>(null)
  const [running, setRunning] = useState(false)
  const [currentCodeHash, setCurrentCodeHash] = useState<string | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<AgentBlenderSession | null>(null)
  const preparedRef = useRef<PreparedCodeContext | null>(null)
  const messageRef = useRef<AgentMessage | null>(null)
  const videoSessionsRef = useRef<Map<string, VideoSession>>(new Map())
  const draftIdRef = useRef<string | null>(null)
  const requirementsList = requirements?.length ? requirements : undefined
  // 当前环节模型与协议：只做展示，实际选择在 runSceneAgent 里用同一套能力表
  const protocol = (() => {
    const entry = resolveStageModel(settings, 'sceneCode', stagePick).entry
    const provider = entry ? settings?.providers.find((p) => p.id === entry.provider) : undefined
    return resolveToolProtocol(settings?.agentToolProtocol, provider?.id, entry?.model)
  })()
  const protocolLabel = protocol.error
    ? '原生（当前模型不支持，运行会报错）'
    : protocol.protocol === 'native'
      ? '原生 tool calls'
      : protocol.reason === 'auto-json'
        ? 'JSON action（模型未声明支持，自动回退）'
        : 'JSON action'
  // 引擎只做展示；实际选择在 runSceneAgent 里用同一套判断。
  const engineLabel = (() => {
    try {
      const pick = resolveSceneAgentEngine({ settings, stagePick })
      return pick.fallbackReason ? `${pick.engine}（已回退）` : pick.engine
    } catch {
      return 'langgraph（配置不可用）'
    }
  })()
  const [threadLoaded, setThreadLoaded] = useState(false)
  const [sceneSkillMeta, setSceneSkillMeta] = useState<{
    id: string
    version: number
    source: 'builtin' | 'override'
  } | null>(null)
  const [sceneSkill, setSceneSkill] = useState<Skill | null>(null)
  const messagesRef = useRef<AgentMessage[]>([])
  messagesRef.current = messages
  const metaRef = useRef(sceneSkillMeta)
  metaRef.current = sceneSkillMeta
  const userStartedRef = useRef(false)

  // 打开工作台时恢复该镜头的线程；运行中的旧消息标记取消，不自动重跑。
  useEffect(() => {
    let alive = true
    setThreadLoaded(false)
    getSkill('scene3d')
      .then((s) => {
        if (alive) {
          setSceneSkillMeta({ id: s.id, version: s.manifest.version, source: s.source })
          setSceneSkill(s)
        }
      })
      .catch(() => {})
    loadChatThread(threadKey)
      .then((thread) => {
        if (!alive) return
        if (thread?.messages?.length && !userStartedRef.current) {
          setMessages(
            thread.messages.map((m) =>
              m.status === 'running' ? { ...m, status: 'cancelled' as const } : m,
            ),
          )
        }
        setThreadLoaded(true)
      })
      .catch(() => {
        if (alive) setThreadLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [threadKey.project, threadKey.surface, threadKey.shotId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 完成一轮后落盘；只存文本、工具摘要和产物引用。
  useEffect(() => {
    if (!threadLoaded || running || !messages.length) return
    const active = sceneSkillMeta
      ? [{ id: sceneSkillMeta.id, mode: 'host' as const, version: sceneSkillMeta.version, source: sceneSkillMeta.source }]
      : []
    const timer = setTimeout(() => {
      void saveChatThread(threadKey, messages, active).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [messages, running, threadLoaded, sceneSkillMeta]) // eslint-disable-line react-hooks/exhaustive-deps

  // 关闭工作台时把运行中的本轮标记取消并保留已确认内容。
  useEffect(() => {
    return () => {
      const msgs = messagesRef.current
      if (!msgs.length) return
      const marked = msgs.map((m) =>
        m.status === 'running' ? { ...m, status: 'cancelled' as const } : m,
      )
      const meta = metaRef.current
      const active = meta
        ? [{ id: meta.id, mode: 'host' as const, version: meta.version, source: meta.source }]
        : []
      void saveChatThread(threadKey, marked, active).catch(() => {})
    }
  }, [threadKey.project, threadKey.surface, threadKey.shotId]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchAssistant = (fn: (message: AgentMessage) => AgentMessage) => {
    setMessages((prev) => {
      const target = messageRef.current
      if (!target) return prev
      return prev.map((m) => (m.id === target.id ? fn(m) : m))
    })
  }

  const patchMessage = (messageId: string, fn: (message: AgentMessage) => AgentMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? fn(m) : m)))
  }

  const patchVideoPart = (videoId: string, patch: Partial<AgentVideoPart>, messageId?: string) => {
    const apply = (m: AgentMessage): AgentMessage => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === 'video' && p.videoId === videoId ? { ...p, ...patch } : p,
      ),
    })
    if (messageId) patchMessage(messageId, apply)
    else patchAssistant(apply)
  }

  const patchVideoReviewPart = (videoId: string, patch: Partial<AgentVideoReviewPart>, messageId?: string) => {
    const apply = (m: AgentMessage): AgentMessage => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === 'video-review' && p.videoId === videoId ? { ...p, ...patch } : p,
      ),
    })
    if (messageId) patchMessage(messageId, apply)
    else patchAssistant(apply)
  }

  const updateEvent = (event: AgentEvent) => {
    if (event.type === 'code') {
      setCurrentCodeHash(event.codeHash)
      return
    }
    if (event.type === 'draft_started') draftIdRef.current = event.draftId
    if (event.type === 'draft_discarded' && draftIdRef.current === event.draftId) {
      draftIdRef.current = null
    }
    patchAssistant((m) => applyAgentEvent(m, event))
  }

  const runVideoPhase = async (args: {
    messageId: string
    code: string
    codeHash: string
    prepared: PreparedCodeContext
    requirements: string[]
    signal: AbortSignal
    videoId?: string
  }): Promise<AgentVideoAcceptanceResult> => {
    const videoId = args.videoId || makeId()
    const videoRequirements = args.requirements.length
      ? args.requirements
      : requirementsList?.length
        ? requirementsList
        : DUEL_REQUIREMENTS
    patchMessage(args.messageId, (m) => ({
      ...m,
      parts: [
        ...m.parts,
        {
          type: 'video',
          videoId,
          codeHash: args.codeHash,
          status: 'running',
          phase: 'rendering',
          progress: 0,
          duration,
          aspect,
          frames: [],
        },
      ],
    }))
    try {
      const result = await runVideoAcceptance(
        {
          videoId,
          code: args.code,
          codeHash: args.codeHash,
          assets: args.prepared.assets,
          duration,
          aspect,
          requirements: videoRequirements,
          settings,
          stagePick,
          signal: args.signal,
          onProgress: (progress) =>
            patchVideoPart(
              videoId,
              {
                status: 'running',
                phase: progress.phase,
                ...(progress.value !== undefined ? { progress: progress.value } : {}),
              },
              args.messageId,
            ),
        },
        {
          persist: async (persisted) => {
            await onVideoAccepted({
              code: persisted.code,
              codeHash: persisted.codeHash,
              context: args.prepared.context,
              prepared: args.prepared,
              video: persisted.videoUrl,
              duration,
              aspect,
              frames: persisted.frames,
              review: persisted.review,
            })
          },
        },
      )
      videoSessionsRef.current.set(videoId, {
        videoId,
        messageId: args.messageId,
        code: args.code,
        codeHash: args.codeHash,
        prepared: args.prepared,
        requirements: videoRequirements,
        result,
      })
      patchVideoPart(
        videoId,
        {
          status: result.status,
          ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
          frames: result.frames,
          saved: result.saved,
          ...(result.error ? { error: result.error } : {}),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        },
        args.messageId,
      )
      if (result.review) {
        patchMessage(args.messageId, (m) => ({
          ...m,
          parts: [
            ...m.parts,
            {
              type: 'video-review',
              videoId,
              codeHash: args.codeHash,
              ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
              passed: result.review!.passed,
              ...(result.review!.needsHumanReview ? { needsHumanReview: true } : {}),
              ...(result.review!.modelKey ? { modelKey: result.review!.modelKey } : {}),
              items: result.review!.items,
              ...(result.review!.summary ? { summary: result.review!.summary } : {}),
              saved: result.saved,
              ...(result.error ? { error: result.error } : {}),
              ...(result.errorCode ? { errorCode: result.errorCode } : {}),
            } satisfies AgentVideoReviewPart,
          ],
        }))
      }
      if (result.status !== 'cancelled') {
        patchMessage(args.messageId, (m) => ({
          ...m,
          parts: [...m.parts, { type: 'text', text: agentVideoSummary(result) }],
        }))
      }
      setCurrentCodeHash(args.codeHash)
      return result
    } catch (e) {
      const msg = (e as Error)?.name === 'AbortError' ? '已取消' : (e as Error)?.message || String(e)
      const failed: AgentVideoAcceptanceResult = {
        videoId,
        codeHash: args.codeHash,
        status: (e as Error)?.name === 'AbortError' ? 'cancelled' : 'failed',
        duration,
        aspect,
        frames: [],
        saved: false,
        error: msg,
        errorCode: (e as Error)?.name === 'AbortError' ? 'cancelled' : 'render_failed',
      }
      patchVideoPart(
        videoId,
        {
          status: failed.status,
          frames: [],
          saved: false,
          error: msg,
          errorCode: failed.errorCode,
        },
        args.messageId,
      )
      if (failed.status !== 'cancelled') {
        patchMessage(args.messageId, (m) => ({
          ...m,
          parts: [...m.parts, { type: 'text', text: agentVideoSummary(failed) }],
        }))
      }
      return failed
    }
  }

  const run = async (text: string) => {
    if (running) return
    if (!sceneSkill) {
      onToast?.('scene3d 技能不可用，无法启动聊天')
      return
    }
    userStartedRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    const user: AgentMessage = { id: makeId(), role: 'user', parts: [{ type: 'text', text }], status: 'complete' }
    const assistant: AgentMessage = { id: makeId(), role: 'assistant', parts: [], status: 'running' }
    messageRef.current = assistant
    setMessages((m) => [...m, user, assistant])
    try {
      const prepared = await prepareAgent()
      preparedRef.current = prepared
      setPreparedSnapshot(prepared)
      const contextText = contextTextOf(manifest, prepared)
      const assets = prepared.assets
      let sessionCode = ''
      const deps: SceneAgentDeps = {
        getShotContext: () => contextText,
        runTrial: async (code) => {
          if (sessionRef.current && sessionCode !== code) {
            sessionRef.current.dispose()
            sessionRef.current = null
          }
          if (!sessionRef.current) {
            sessionRef.current = new AgentBlenderSession({
              code,
              assets,
              aspect,
              duration,
            })
            sessionCode = code
          }
          return sessionRef.current.start()
        },
        captureFrames: async (code, times) => {
          if (!sessionRef.current || sessionCode !== code) throw new Error('渲染会话已失效，请重新运行 run_render')
          return sessionRef.current.capture(times, controller.signal)
        },
        reviewFrames: async (frames, reqs) =>
          reviewFramesWithVision({ frames, requirements: reqs, settings, stagePick, signal: controller.signal }),
        onDraftCode: (code, check) => {
          const preparedNow = preparedRef.current
          if (preparedNow) void onDraftCode(code, check, preparedNow)
        },
        onEvent: updateEvent,
        draftScope: { project: threadKey.project, shotId: threadKey.shotId },
        signal: controller.signal,
      }
      const requirementsText = requirementsList?.length
        ? `\n验收要求：\n${requirementsList.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
        : ''
      const prompt = buildSkillPrompt(sceneSkill, { requirements: requirementsText }, 'inline')
      const skillSystem = `${prompt.system}\n${prompt.task}`.trim()
      const result = await runSceneAgent({
        prompt: text,
        deps,
        settings,
        stagePick,
        initialCode: currentCode,
        requirements: requirementsList,
        system: skillSystem,
        manifestSummary: manifestSummary(manifest),
        signal: controller.signal,
      })
      if (result.cancelled) {
        patchAssistant((m) => ({ ...m, status: 'cancelled' }))
      } else if (result.error) {
        patchAssistant((m) => ({ ...m, status: 'error' }))
        onToast?.(result.summary)
      } else if (result.finished) {
        const finalCode = result.code || currentCode || ''
        const finalHash = result.codeHash || ''
        if (!finalCode || !finalHash) {
          patchAssistant((m) => ({
            ...m,
            status: 'error',
            parts: [...m.parts, { type: 'text', text: '代码阶段完成，但没有可验收的代码或代码哈希' }],
          }))
          onToast?.('代码阶段完成，但没有可验收的代码')
        } else {
          setCurrentCodeHash(finalHash)
          const video = await runVideoPhase({
            messageId: assistant.id,
            code: finalCode,
            codeHash: finalHash,
            prepared,
            requirements: (result.review?.items || []).map((item) => item.label).filter(Boolean),
            signal: controller.signal,
          })
          if (controller.signal.aborted || video.status === 'cancelled') {
            patchAssistant((m) => ({ ...m, status: 'cancelled' }))
            onToast?.('已取消')
          } else {
            patchAssistant((m) => ({ ...m, status: 'complete' }))
            onToast?.(
              video.status === 'passed'
                ? '视频验收通过，已保存'
                : video.status === 'needs_human'
                  ? '视频已生成，需人工验收'
                  : video.status === 'rejected'
                    ? '视频验收未通过'
                    : video.error || '视频验收未完成',
            )
          }
        }
      } else {
        patchAssistant((m) => ({ ...m, status: 'complete' }))
        onToast?.(result.summary || '场景已生成')
      }
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '已取消' : (e as Error).message || 'agent 失败'
      patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: msg }] }))
      onToast?.(msg)
    } finally {
      sessionRef.current?.dispose()
      sessionRef.current = null
      abortRef.current = null
      setRunning(false)
    }
  }

  const adoptVideo = async (video: AgentVideoPart) => {
    const session = videoSessionsRef.current.get(video.videoId)
    const result = session?.result
    if (!session || !result?.videoUrl) return
    try {
      await onVideoAccepted({
        code: session.code,
        codeHash: session.codeHash,
        context: session.prepared.context,
        prepared: session.prepared,
        video: result.videoUrl,
        duration: result.duration,
        aspect: result.aspect,
        frames: result.frames,
        review: result.review,
      })
      const adoptedStatus: AgentVideoAcceptanceResult['status'] = result.review?.passed ? 'passed' : 'needs_human'
      const adopted: AgentVideoAcceptanceResult = {
        ...result,
        status: adoptedStatus,
        saved: true,
        ...(adoptedStatus === 'passed' ? { error: '', errorCode: undefined } : {}),
      }
      session.result = adopted
      patchVideoPart(
        video.videoId,
        {
          status: adopted.status,
          saved: true,
          error: adopted.error || '',
        },
        session.messageId,
      )
      patchVideoReviewPart(video.videoId, { saved: true, error: '' }, session.messageId)
      patchMessage(session.messageId, (m) => ({
        ...m,
        parts: [...m.parts, { type: 'text', text: agentVideoSummary(adopted) }],
      }))
      onToast?.('视频已采用并保存')
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      patchVideoPart(
        video.videoId,
        { status: 'failed', errorCode: 'save_failed', error: msg, saved: false },
        session.messageId,
      )
      onToast?.(msg)
    }
  }

  const retryVideo = async (video: AgentVideoPart) => {
    if (running) return
    const session = videoSessionsRef.current.get(video.videoId)
    if (!session) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    patchMessage(session.messageId, (m) => ({ ...m, status: 'running' }))
    patchVideoPart(video.videoId, { superseded: true }, session.messageId)
    patchVideoReviewPart(video.videoId, { superseded: true }, session.messageId)
    try {
      const result = await runVideoPhase({
        messageId: session.messageId,
        code: session.code,
        codeHash: session.codeHash,
        prepared: session.prepared,
        requirements: session.requirements,
        signal: controller.signal,
      })
      if (controller.signal.aborted || result.status === 'cancelled') {
        patchMessage(session.messageId, (m) => ({ ...m, status: 'cancelled' }))
        onToast?.('已取消')
      } else {
        patchMessage(session.messageId, (m) => ({ ...m, status: 'complete' }))
        onToast?.(
          result.status === 'passed'
            ? '视频验收通过，已保存'
            : result.status === 'needs_human'
              ? '视频已生成，需人工验收'
              : result.status === 'rejected'
                ? '视频验收未通过'
                : result.error || '视频验收未完成',
        )
      }
    } catch (e) {
      patchMessage(session.messageId, (m) => ({ ...m, status: 'error' }))
      onToast?.((e as Error)?.message || String(e))
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const continueRepair = (review: AgentVideoReviewPart) => {
    if (running) return
    const failed = review.items.filter((item) => !item.ok)
    const lines = failed.length
      ? failed.map((item) => `- ${item.label}${item.reason ? `：${item.reason}` : ''}`).join('\n')
      : '- MP4 视频验收未通过，请重新检查并修复画面问题'
    void run(
      `视频验收未通过。请只修复以下问题，修复后重新运行渲染试运行、抓帧并 finish：\n${lines}\n不要修改与这些问题无关的内容。`,
    )
  }

  const cancel = () => {
    abortRef.current?.abort()
    sessionRef.current?.dispose()
    sessionRef.current = null
    // 取消即清理当前草稿；服务端启动时还会 sweep 残留。
    if (draftIdRef.current) {
      void sceneDraftClient.discard(draftIdRef.current).catch(() => {})
      draftIdRef.current = null
    }
    patchAssistant((m) =>
      m.status === 'cancelled'
        ? m
        : { ...m, status: 'cancelled', parts: [...m.parts, { type: 'text', text: '已取消' }] },
    )
    setRunning(false)
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      sessionRef.current?.dispose()
      if (draftIdRef.current) {
        void sceneDraftClient.discard(draftIdRef.current).catch(() => {})
        draftIdRef.current = null
      }
    }
  }, [])

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const text = appendText(message)
      if (!text) return
      await run(text)
    },
    onCancel: async () => cancel(),
  })

  return (
    <VideoUiContext.Provider
      value={{
        currentCodeHash,
        onAdopt: (video) => void adoptVideo(video),
        onRetry: (video) => void retryVideo(video),
        onContinueRepair: (review) => continueRepair(review),
      }}
    >
      <AgentUiContext.Provider value={{ openCode: onOpenCode }}>
        <ChatThreadShell
          runtime={runtime}
          running={running}
          toolUis={
            <>
              <RunSandboxUI />
              <SetSceneCodeUI />
              <CaptureFramesUI />
              <ReviewFramesUI />
              <GetContextUI />
              <DraftBeginUI />
              <DraftAppendUI />
              <DraftReadUI />
              <DraftPatchUI />
              <DraftCommitUI />
              <DraftDiscardUI />
              <FinishUI />
            </>
          }
        >
          {sceneSkillMeta && (
            <div className="scene-skill-chip" data-scene-skill>
              技能：{sceneSkillMeta.id} · {sceneSkillMeta.source} · v{sceneSkillMeta.version}
            </div>
          )}
          <div className="scene-skill-chip" data-tool-protocol>
            工具协议：{protocolLabel}
          </div>
          <div className="scene-skill-chip" data-agent-engine>
            引擎：{engineLabel}
          </div>
          <ChatContextTray
            manifest={manifest}
            onRemove={onRemoveAttachment}
            {...(onToggleBrief ? { onToggleBrief } : {})}
            {...(onClearAttachments ? { onClear: onClearAttachments } : {})}
            onInspect={() => setInspectorOpen((v) => !v)}
            inspecting={inspectorOpen}
          />
            {inspectorOpen && (
              <ChatContextInspector
                manifest={manifest}
                prepared={preparedSnapshot}
                systemPrompt={
                  sceneSkill ? buildSkillPrompt(sceneSkill, { requirements: '' }, 'inline').system : ''
                }
                onClose={() => setInspectorOpen(false)}
              />
            )}
          <ChatThreadBody
            UserMessage={UserMessage}
            AssistantMessage={AssistantMessage}
            placeholder="例如：生成山、男女双剑对打、环绕镜头…"
            inputLabel="3D agent 聊天输入"
            disabled={!sceneSkill}
          />
        </ChatThreadShell>
      </AgentUiContext.Provider>
    </VideoUiContext.Provider>
  )
}
