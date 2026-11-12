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
import type { SceneCodeCheck } from '../sceneCodeSanitize'
import type { PreparedCodeContext } from '../sceneCodePrepare'
import { runSceneAgent, sceneAgentCapability } from './sceneAgentGraph'
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
import { ChatContextInspector } from '@/chat-ui/ChatContextInspector'
import { ChatContextPart } from '@/chat-ui/ChatContextPart'
import { SCENE_CODE_LIMITS } from '../types'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { sceneDraftClient } from '../sceneDraft'
import { ChatThreadBody, ChatThreadShell } from './ChatThreadShell'
import type { ChatAttachment } from './chatAttachments'
import { clearChatThread, loadChatThread, saveChatThread } from './threads'
import { getSkill } from '../skills/registry'
import { buildSkillPrompt } from '../skills/render'
import type { Skill } from '../skills/types'
import { isFullHostMode } from './agentHostMode'
import {
  agentListDir,
  agentReadFile,
  agentRunBash,
  agentWriteFile,
  cancelAgentJob,
  ensureAgentJob,
} from '../agentHostClient'
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
import { DraftPart } from '@/chat-ui/tools/DraftTools'
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

const CODE_ARG_TOOLS = new Set(['set_scene_code', 'adopt_scene_from_job'])

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
        ...(part.args && !CODE_ARG_TOOLS.has(part.toolName) ? { args: part.args as never } : {}),
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

const AdoptSceneFromJobUI = makeAssistantToolUI({
  toolName: 'adopt_scene_from_job',
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
  /** 白模线程键：项目 + 白模条目；关闭工作台后可恢复 */
  threadKey: { project: string; surface: 'lexicon'; shotId: string }
  onRemoveAttachment?: (key: string) => void
  onToggleBrief?: (key: string) => void
  onClearAttachments?: () => void
  /** 上传一张本地图片并写进镜头上下文（宿主负责落盘 + 刷新 media + 写 context） */
  onUploadImage?: (file: File) => Promise<void> | void
  /** 从项目素材里选一条并写进镜头上下文 */
  onPickMedia?: () => void
  picking?: boolean
  uploading?: boolean
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
  /** 工作台注入的聊天草稿（不发送、不保存） */
  composerSeed?: string
}

export default function SceneAgentChat({
  settings,
  stagePick,
  manifest,
  threadKey,
  onRemoveAttachment,
  onToggleBrief,
  onClearAttachments,
  onUploadImage,
  onPickMedia,
  picking,
  uploading,
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
  composerSeed,
}: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [preparedSnapshot, setPreparedSnapshot] = useState<PreparedCodeContext | null>(null)
  const [running, setRunning] = useState(false)
  const [currentCodeHash, setCurrentCodeHash] = useState<string | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<AgentBlenderSession | null>(null)
  const hostJobIdRef = useRef('')
  const preparedRef = useRef<PreparedCodeContext | null>(null)
  const messageRef = useRef<AgentMessage | null>(null)
  const videoSessionsRef = useRef<Map<string, VideoSession>>(new Map())
  const draftIdRef = useRef<string | null>(null)
  const requirementsList = requirements?.length ? requirements : undefined
  const capability = sceneAgentCapability({ settings, stagePick })
  const protocolLabel = capability.available ? '原生 tool calls' : '未绑定白模 3D 代码模型'
  const [threadLoaded, setThreadLoaded] = useState(false)
  const [sceneSkillMeta, setSceneSkillMeta] = useState<{
    id: string
    version: number
    source: 'builtin' | 'override'
  } | null>(null)
  const [sceneSkill, setSceneSkill] = useState<Skill | null>(null)
  const inspectorSystemPrompt = sceneSkill
    ? buildSkillPrompt(
        sceneSkill,
        {
          requirements: requirementsList?.length
            ? `\n验收要求：\n${requirementsList.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
            : '',
        },
        'inline',
      ).system
    : ''
  const [skillError, setSkillError] = useState('')
  const [skillLoading, setSkillLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const messagesRef = useRef<AgentMessage[]>([])
  messagesRef.current = messages
  const metaRef = useRef(sceneSkillMeta)
  metaRef.current = sceneSkillMeta
  const userStartedRef = useRef(false)
  const clearGenRef = useRef(0)
  const clearingRef = useRef(false)
  const activeRunGenRef = useRef<number | null>(null)
  /** 附件条的上传入口：真正的落盘与写 context 由宿主负责 */
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  // 打开工作台时恢复该镜头的线程；运行中的旧消息标记取消，不自动重跑。
  useEffect(() => {
    let alive = true
    setThreadLoaded(false)
    setSkillLoading(true)
    setSkillError('')
    setSceneSkill(null)
    setSceneSkillMeta(null)
    getSkill('scene3d')
      .then((s) => {
        if (alive) {
          setSceneSkillMeta({ id: s.id, version: s.manifest.version, source: s.source })
          setSceneSkill(s)
          setSkillError('')
        }
      })
      .catch((e) => {
        if (!alive) return
        const msg = (e as Error).message || 'scene3d 技能不可用'
        setSkillError(msg)
        onToast?.(msg)
      })
      .finally(() => {
        if (alive) setSkillLoading(false)
      })
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
    if (!threadLoaded || running || !messages.length || clearingRef.current) return
    const active = sceneSkillMeta
      ? [{ id: sceneSkillMeta.id, mode: 'host' as const, version: sceneSkillMeta.version, source: sceneSkillMeta.source }]
      : []
    const timer = setTimeout(() => {
      if (clearingRef.current) return
      void saveChatThread(threadKey, messages, active).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [messages, running, threadLoaded, sceneSkillMeta]) // eslint-disable-line react-hooks/exhaustive-deps

  // 关闭工作台时把运行中的本轮标记取消并保留已确认内容。
  useEffect(() => {
    return () => {
      if (clearingRef.current) return
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

  const clearConversation = async () => {
    if (!messages.length || clearingRef.current) return
    if (
      !window.confirm('清空当前对话？只删除聊天记录，不清场景代码草稿，且不可恢复。')
    ) {
      return
    }
    clearingRef.current = true
    setClearing(true)
    clearGenRef.current += 1
    activeRunGenRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    if (hostJobIdRef.current) {
      void cancelAgentJob(hostJobIdRef.current).catch(() => undefined)
      hostJobIdRef.current = ''
    }
    sessionRef.current?.dispose()
    sessionRef.current = null
    messageRef.current = null
    if (draftIdRef.current) {
      void sceneDraftClient.discard(draftIdRef.current).catch(() => {})
      draftIdRef.current = null
    }
    try {
      await clearChatThread(threadKey)
    } catch (e) {
      clearingRef.current = false
      setClearing(false)
      setRunning(false)
      onToast?.((e as Error).message || '清空对话失败')
      return
    }
    messagesRef.current = []
    setMessages([])
    setInspectorOpen(false)
    setPreparedSnapshot(null)
    setRunning(false)
    clearingRef.current = false
    setClearing(false)
  }

  const updateEvent = (event: AgentEvent) => {
    if (activeRunGenRef.current === null || activeRunGenRef.current !== clearGenRef.current) return
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
    if (running || clearingRef.current) return
    if (!sceneSkill) {
      onToast?.(skillError || 'scene3d 技能不可用，无法启动聊天')
      return
    }
    const gen = clearGenRef.current
    userStartedRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    activeRunGenRef.current = gen
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
      hostJobIdRef.current = ''
      if (isFullHostMode(settings)) {
        const { jobId } = await ensureAgentJob(threadKey.project, threadKey.shotId, controller.signal)
        hostJobIdRef.current = jobId
      }
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
        ...(isFullHostMode(settings) && hostJobIdRef.current
          ? {
              agentHost: {
                jobId: hostJobIdRef.current,
                runBash: (command, cwd) =>
                  agentRunBash(hostJobIdRef.current, command, cwd, 30_000, controller.signal),
                readFile: (p) => agentReadFile(hostJobIdRef.current, p, controller.signal),
                writeFile: (p, content) =>
                  agentWriteFile(hostJobIdRef.current, p, content, controller.signal),
                listDir: (p) => agentListDir(hostJobIdRef.current, p, controller.signal),
              },
            }
          : {}),
      }
      const requirementsText = requirementsList?.length
        ? `\n验收要求：\n${requirementsList.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
        : ''
      const prompt = buildSkillPrompt(sceneSkill, { requirements: requirementsText }, 'inline')
      const skillSystem = `${prompt.system}\n${prompt.task}`.trim()
      const sendSummary = manifestSummary(manifest)
      patchMessage(assistant.id, (m) => ({
        ...m,
        parts: [
          {
            type: 'context',
            turn: 1,
            keys: sendSummary.attachmentKeys,
            counts: sendSummary.counts,
            metadata: {
              title: sendSummary.metadata.title,
              ...(sendSummary.metadata.shot
                ? {
                    shot: {
                      no: sendSummary.metadata.shot.no,
                      duration: sendSummary.metadata.shot.duration,
                      aspect: sendSummary.metadata.shot.aspect,
                    },
                  }
                : {}),
            },
            systemPrompt: skillSystem,
            userPrompt: text,
            contextPayload: contextText,
          },
          ...m.parts,
        ],
      }))
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
      if (clearGenRef.current !== gen) {
        /* 清空对话后忽略收尾 */
      } else if (result.cancelled) {
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
          if (clearGenRef.current !== gen) {
            /* 清空后忽略 */
          } else if (controller.signal.aborted || video.status === 'cancelled') {
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
      } else if (clearGenRef.current === gen) {
        patchAssistant((m) => ({ ...m, status: 'complete' }))
        onToast?.(result.summary || '场景已生成')
      }
    } catch (e) {
      if (clearGenRef.current === gen) {
        const msg = (e as Error).name === 'AbortError' ? '已取消' : (e as Error).message || 'agent 失败'
        patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: msg }] }))
        onToast?.(msg)
      }
    } finally {
      if (clearGenRef.current === gen) {
        if (hostJobIdRef.current) {
          void cancelAgentJob(hostJobIdRef.current).catch(() => undefined)
          hostJobIdRef.current = ''
        }
        sessionRef.current?.dispose()
        sessionRef.current = null
        abortRef.current = null
        setRunning(false)
      }
      if (activeRunGenRef.current === gen) activeRunGenRef.current = null
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

  /**
   * manifest 是镜头上下文的唯一投影：这里只做类型映射，不做取舍。
   * 文本项也带进附件条，因为用户需要看到「这次会发什么」并能逐项移除。
   */
  const manifestAttachments: ChatAttachment[] = manifest.attachments.map((a) => {
    if (a.kind === 'image') {
      return { key: a.key, kind: 'image' as const, label: a.label, url: a.url, manifestKey: a.key }
    }
    if (a.kind === 'video') {
      return { key: a.key, kind: 'video' as const, label: a.label, url: a.url, manifestKey: a.key }
    }
    return { key: a.key, kind: 'text' as const, label: a.label, text: a.text, manifestKey: a.key }
  })
  const briefOffSet = new Set(
    manifest.attachments.filter((a) => a.kind !== 'text' && !a.includeBrief).map((a) => a.key),
  )

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const typed = appendText(message)
      // 3D 的附件是镜头上下文，本来就已随本轮发送；没有文字时仍需要一句话才能发起
      if (!typed && !manifestAttachments.length) return
      if (!sceneSkill) {
        onToast?.(skillError || 'scene3d 技能不可用')
        return
      }
      await run(typed || '（见当前镜头附件）')
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
          scope="lexicon"
          toolUis={
            <>
              <RunSandboxUI />
              <SetSceneCodeUI />
              <CaptureFramesUI />
              <ReviewFramesUI />
              <GetContextUI />
              <AdoptSceneFromJobUI />
              <FinishUI />
            </>
          }
        >
          <div className="scene-skill-chip-row flex flex-wrap items-center gap-2">
            {sceneSkillMeta && (
              <div className="scene-skill-chip" data-scene-skill>
                技能：{sceneSkillMeta.id} · {sceneSkillMeta.source} · v{sceneSkillMeta.version}
              </div>
            )}
            <div className="scene-skill-chip" data-tool-protocol>
              工具协议：{protocolLabel}
            </div>
            <button
              type="button"
              className="ca-link ml-auto text-[11px]"
              data-chat-clear
              disabled={!messages.length || running || clearing}
              onClick={() => void clearConversation()}
            >
              {clearing ? '清空中…' : '清空对话'}
            </button>
          </div>
          {skillLoading && (
            <div className="scene-skill-chip text-[11px] text-muted-foreground" data-scene-skill-loading>
              正在加载 scene3d 技能…
            </div>
          )}
          {skillError && (
            <div className="scene-skill-chip text-[11px] text-destructive" data-scene-skill-error role="alert">
              技能不可用：{skillError}
            </div>
          )}
            {inspectorOpen && (
              <ChatContextInspector
                manifest={manifest}
                prepared={preparedSnapshot}
                systemPrompt={inspectorSystemPrompt || ''}
                onClose={() => setInspectorOpen(false)}
              />
            )}
          <ChatThreadBody
            UserMessage={UserMessage}
            AssistantMessage={AssistantMessage}
            placeholder="例如：生成山、男女双剑对打、环绕镜头…"
            inputLabel="3D agent 聊天输入"
            disabled={skillLoading || running || clearing}
            sendDisabled={!sceneSkill}
            sendBlockedNote={
              !sceneSkill && !skillLoading
                ? skillError || 'scene3d 技能未加载，暂不能发送'
                : undefined
            }
            hint={
              sceneSkill
                ? 'Enter 发送 · Shift+Enter 换行'
                : skillLoading
                  ? '正在加载技能…'
                  : '修复技能后可发送'
            }
            composerSeed={composerSeed}
            attachments={{
              items: manifestAttachments,
              // 3D 的上限由镜头上下文的素材预算决定（图片 16 / 视频 4），
              // 这里只做展示上限，不让附件条把整份上下文渲染成一面墙
              limit: SCENE_CODE_LIMITS.images + SCENE_CODE_LIMITS.videos,
              locked: running,
              ...(onRemoveAttachment ? { onRemove: onRemoveAttachment } : { onRemove: () => {} }),
              ...(onClearAttachments ? { onClear: onClearAttachments } : {}),
              ...(onUploadImage ? { onUpload: () => uploadInputRef.current?.click() } : {}),
              ...(uploading ? { uploadBusy: true } : {}),
              ...(onPickMedia ? { onPick: onPickMedia } : {}),
              ...(picking ? { picking: true } : {}),
              hint: '仅显示本轮会发给模型的附件（若有）；不写入镜头参考字段',
              extra: onToggleBrief
                ? (item) => {
                    if (item.kind === 'text') return null
                    const on = !briefOffSet.has(item.manifestKey || item.key)
                    return (
                      <button
                        type="button"
                        className={`ca-brief ${on ? 'on' : 'off'}`}
                        title={on ? '排除这份媒体 brief' : '恢复这份媒体 brief'}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleBrief(item.manifestKey || item.key)
                        }}
                        data-ca-brief
                      >
                        brief
                      </button>
                    )
                  }
                : undefined,
              actions: (
                <button
                  type="button"
                  className="ca-link"
                  onClick={() => setInspectorOpen((v) => !v)}
                  data-ca-inspect
                >
                  {inspectorOpen ? '收起' : '查看将发送'}
                </button>
              ),
              // 空输入时库不允许发送；3D 的附件是镜头上下文，允许直接以它发起一轮
              ...(manifestAttachments.length
                ? {
                    onSendAttachmentsOnly: () => {
                      if (!sceneSkill) {
                        onToast?.(skillError || 'scene3d 技能不可用')
                        return
                      }
                      void run('（见当前镜头附件）')
                    },
                  }
                : {}),
            }}
          />
          {onUploadImage ? (
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onUploadImage(f)
                e.target.value = ''
              }}
            />
          ) : null}
        </ChatThreadShell>
      </AgentUiContext.Provider>
    </VideoUiContext.Provider>
  )
}
