import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  makeAssistantToolUI,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { AppSettings } from '../api'
import type { StagePick } from '../ModelSelect'
import type { SceneCodeCheck } from '../sceneCodeSanitize'
import type { PreparedCodeContext } from '../sceneCodePrepare'
import type { SandboxAssetPayload } from '../sceneSandbox'
import { runSceneAgent } from './sceneAgentGraph'
import { AgentSandboxSession } from './agentSandbox'
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
import type { Shot3DContextItem } from '../shot3dContextCatalog'
import { ChatRoot } from '@/chat-ui/ChatRoot'
import { ChatChips } from '@/chat-ui/ChatChips'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatComposer } from '@/chat-ui/ChatComposer'
import { ChatEmpty } from '@/chat-ui/ChatEmpty'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { ChatViewport } from '@/chat-ui/ChatViewport'
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
import { buttonVariants } from '@/chat-ui/ui/button'
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

function preparedContextText(prepared: PreparedCodeContext): string {
  const lines: string[] = []
  if (prepared.assets.length) {
    lines.push('【可注入沙箱的素材（稳定键）】')
    for (const asset of prepared.assets.slice(0, 32)) {
      const meta = [
        asset.payload.kind,
        asset.payload.width && asset.payload.height ? `${asset.payload.width}x${asset.payload.height}` : '',
        asset.payload.frameTime != null ? `frame @${asset.payload.frameTime.toFixed(2)}s` : '',
      ].filter(Boolean).join(' · ')
      lines.push(`- key=${asset.ref.key}｜${asset.ref.label}｜${meta}`)
    }
  }
  if (prepared.mediaBrief.summary) lines.push(`【媒体理解】${prepared.mediaBrief.summary}`)
  for (const item of prepared.mediaBrief.items.slice(0, 32)) {
    const detail = [item.description, item.composition && `构图：${item.composition}`, item.style && `风格：${item.style}`, item.camera && `镜头：${item.camera}`]
      .filter(Boolean)
      .join('；')
    if (detail) lines.push(`- key=${item.key}｜${item.label}：${detail}`)
  }
  if (prepared.videoBrief) lines.push(`【视频理解】${prepared.videoBrief}`)
  if (prepared.missing.length) {
    lines.push(`【缺失素材】${prepared.missing.map((x) => `${x.label}（${x.reason}）`).join('、')}`)
  }
  if (prepared.warnings.length) lines.push(`【注意】${prepared.warnings.slice(0, 4).join('；')}`)
  if (!prepared.mediaBrief.usedVision && prepared.assets.length) {
    lines.push('【注意】视觉模型未参与素材理解；只能依据上述标签和稳定键，不要编造图片细节。')
  }
  return lines.join('\n').slice(0, 12000)
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

function convertMessage(message: AgentMessage): ThreadMessageLike {
  type Part = Exclude<ThreadMessageLike['content'], string>[number]
  const content: Part[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.text) content.push({ type: 'text', text: part.text })
    } else if (part.type === 'step') {
      const text =
        part.phase === 'start'
          ? `第 ${part.turn} 轮 · 模型调用中…`
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
  toolName: 'run_sandbox',
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
  selectedItems: Shot3DContextItem[]
  onRemoveSelected: (key: string) => void
  getShotContext: () => string
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
  selectedItems,
  onRemoveSelected,
  getShotContext,
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
  const [running, setRunning] = useState(false)
  const [currentCodeHash, setCurrentCodeHash] = useState<string | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<AgentSandboxSession | null>(null)
  const preparedRef = useRef<PreparedCodeContext | null>(null)
  const messageRef = useRef<AgentMessage | null>(null)
  const videoSessionsRef = useRef<Map<string, VideoSession>>(new Map())
  const requirementsList = requirements?.length ? requirements : undefined

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
    if (event.type === 'agent_step') {
      patchAssistant((m) => {
        const exists = m.parts.some((p) => p.type === 'step' && p.turn === event.turn)
        if (exists) {
          return {
            ...m,
            parts: m.parts.map((p) =>
              p.type === 'step' && p.turn === event.turn
                ? { ...p, phase: event.phase, ...(event.text ? { text: event.text } : {}) }
                : p,
            ),
          }
        }
        return {
          ...m,
          parts: [...m.parts, { type: 'step', turn: event.turn, phase: event.phase, ...(event.text ? { text: event.text } : {}) }],
        }
      })
      return
    }
    if (event.type === 'message') {
      patchAssistant((m) => ({
        ...m,
        parts: [...m.parts, { type: 'text', text: event.text }],
      }))
      return
    }
    if (event.type === 'tool_start') {
      patchAssistant((m) => {
        const existing = m.parts.find(
          (p): p is AgentToolPart => p.type === 'tool-call' && (p.toolCallId === event.toolCallId || p.toolName === event.toolName),
        )
        if (existing) {
          return {
            ...m,
            parts: m.parts.map((p) => (p === existing ? { ...p, status: 'running', args: event.args } : p)),
          }
        }
        return {
          ...m,
          parts: [
            ...m.parts,
            {
              type: 'tool-call',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'running',
              startedAt: Date.now(),
            },
          ],
        }
      })
      return
    }
    if (event.type === 'tool_end') {
      patchAssistant((m) => {
        const existing = m.parts.find(
          (p): p is AgentToolPart => p.type === 'tool-call' && p.toolCallId === event.toolCallId,
        )
        if (!existing) {
          return {
            ...m,
            parts: [
              ...m.parts,
              {
                type: 'tool-call',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: event.isError ? 'error' : 'done',
                result: event.result,
                isError: event.isError,
                endedAt: Date.now(),
              },
            ],
          }
        }
        return {
          ...m,
          parts: m.parts.map((p) =>
            p === existing
              ? {
                  ...p,
                  status: event.isError ? 'error' : 'done',
                  result: event.result,
                  isError: event.isError,
                  endedAt: Date.now(),
                }
              : p,
          ),
        }
      })
      return
    }
    if (event.type === 'code') {
      setCurrentCodeHash(event.codeHash)
      return
    }
    if (event.type === 'done') {
      patchAssistant((m) => ({
        ...m,
        parts: [...m.parts, { type: 'text', text: '代码阶段完成，开始 MP4 视频验收…' }],
      }))
      return
    }
    if (event.type === 'cancelled') {
      patchAssistant((m) =>
        m.status === 'cancelled'
          ? m
          : { ...m, status: 'cancelled', parts: [...m.parts, { type: 'text', text: '已取消' }] },
      )
      return
    }
    if (event.type === 'error') {
      patchAssistant((m) => ({
        ...m,
        status: 'error',
        parts: [
          ...m.parts.map((p) =>
            p.type === 'step' && p.phase === 'start' ? { ...p, phase: 'error' as const } : p,
          ),
          { type: 'text', text: `失败：${event.message}` },
        ],
      }))
    }
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
          assets: args.prepared.assets.map((a) => a.payload as SandboxAssetPayload),
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
      const preparedText = preparedContextText(prepared)
      const shotText = getShotContext()
      const assets = prepared.assets.map((a) => a.payload as SandboxAssetPayload)
      let sessionCode = ''
      const deps: SceneAgentDeps = {
        getShotContext: () => [shotText, preparedText].filter(Boolean).join('\n\n'),
        runTrial: async (code) => {
          if (sessionRef.current && sessionCode !== code) {
            sessionRef.current.dispose()
            sessionRef.current = null
          }
          if (!sessionRef.current) {
            sessionRef.current = new AgentSandboxSession({
              code,
              assets,
              width,
              height,
              aspect,
              duration,
            })
            sessionCode = code
          }
          return sessionRef.current.start()
        },
        captureFrames: async (code, times) => {
          if (!sessionRef.current || sessionCode !== code) throw new Error('沙箱会话已失效，请重新运行')
          return sessionRef.current.capture(times)
        },
        reviewFrames: async (frames, reqs) =>
          reviewFramesWithVision({ frames, requirements: reqs, settings, stagePick, signal: controller.signal }),
        onDraftCode: (code, check) => {
          const preparedNow = preparedRef.current
          if (preparedNow) void onDraftCode(code, check, preparedNow)
        },
        onEvent: updateEvent,
        signal: controller.signal,
      }
      const result = await runSceneAgent({
        prompt: text,
        deps,
        settings,
        stagePick,
        initialCode: currentCode,
        requirements: requirementsList,
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
      `视频验收未通过。请只修复以下问题，修复后重新运行沙箱、抓帧并 finish：\n${lines}\n不要修改与这些问题无关的内容。`,
    )
  }

  const cancel = () => {
    abortRef.current?.abort()
    sessionRef.current?.dispose()
    sessionRef.current = null
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
        <AssistantRuntimeProvider runtime={runtime}>
          <RunSandboxUI />
          <SetSceneCodeUI />
          <CaptureFramesUI />
          <ReviewFramesUI />
          <GetContextUI />
          <FinishUI />
          <ChatRoot data-running={running ? 'true' : 'false'}>
            <ChatChips items={selectedItems} onRemove={onRemoveSelected} />
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
              <ChatViewport>
                <ThreadPrimitive.Empty>
                  <ChatEmpty />
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              </ChatViewport>
              <ChatComposer>
                <ComposerPrimitive.Input
                  data-chat-input
                  className="flex min-h-[68px] w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="例如：生成山、男女双剑对打、环绕镜头…"
                  aria-label="3D agent 聊天输入"
                />
                <div data-chat-actions className="flex items-center justify-end gap-1.5 pt-1.5">
                  <ComposerPrimitive.Cancel className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                    取消
                  </ComposerPrimitive.Cancel>
                  <ComposerPrimitive.Send className={buttonVariants({ size: 'sm' })}>发送</ComposerPrimitive.Send>
                </div>
              </ChatComposer>
            </ThreadPrimitive.Root>
          </ChatRoot>
        </AssistantRuntimeProvider>
      </AgentUiContext.Provider>
    </VideoUiContext.Provider>
  )
}
