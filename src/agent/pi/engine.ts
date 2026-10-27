import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { stageModelKey } from '../../ModelSelect'
import { callTextStream } from '../../api'
import type { SceneCodeAsk } from '../../sceneCodeJob'
import { checkSceneCode } from '../../sceneCodeSanitize'
import { codeHashOf } from '../../sceneCodeFingerprint'
import { resolveAgentLimits } from '../agentLimits'
import type { RunSceneAgentInput } from '../sceneAgentEngine'
import {
  createSceneAgentSession,
  type SceneAgentSession,
} from '../sceneAgentTools'
import { DEFAULT_AGENT_LIMITS, type AgentEvent, type SceneAgentResult } from '../sceneAgentTypes'
import { createPiEventBridge } from './events'
import { createPiAgentTools } from './tools'
import { createPiStreamFn, toOpenAIFunctions } from './streamFn'
import { compactPiHistory } from './compact'
import { gateAgentEvents } from '../agentEventGate'

const timeoutMessage = (ms: number) =>
  `运行超时（${Math.round(ms / 1000)} 秒）；可在设置页「Agent 运行上限」调整`

function defaultAsk(): SceneCodeAsk {
  return (o) =>
    callTextStream({
      ...(o.system ? { system: o.system } : {}),
      ...(o.prompt ? { prompt: o.prompt } : {}),
      ...(o.messages ? { messages: o.messages } : {}),
      ...(o.tools ? { tools: o.tools } : {}),
      ...(o.toolChoice ? { toolChoice: o.toolChoice } : {}),
      json: o.json,
      maxTokens: o.maxTokens,
      temperature: o.temperature,
      modelKey: o.modelKey,
      signal: o.signal,
      ...(o.onProgress ? { onProgress: o.onProgress } : {}),
      ...(o.onToolCallDelta ? { onToolCallDelta: o.onToolCallDelta } : {}),
    })
}

function hasToolCall(message: AgentMessage): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return false
  return message.content.some((part) => (part as { type?: unknown })?.type === 'toolCall')
}

function assistantText(message: AgentMessage): string {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return ''
  return message.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: unknown; text?: unknown }
      return block.type === 'text' ? String(block.text ?? '') : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * pi 引擎：pi 负责模型循环与工具调度，工具实现、门禁、草稿与验收全部复用现有代码。
 * 只由 sceneAgentGraph 门面调用。
 */
export async function runSceneAgentPi(input: RunSceneAgentInput): Promise<SceneAgentResult> {
  const modelKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  if (!modelKey) throw new Error('没有可用的 3D 代码模型，请到设置页绑定「3D 代码」环节')

  const configured = resolveAgentLimits(input.settings)
  const totalMs = Math.max(1, Math.round(input.limits?.totalMs ?? configured.totalMs))
  const session = createSceneAgentSession()

  const initialCode = String(input.initialCode || '').trim()
  if (initialCode) {
    const checked = checkSceneCode(initialCode)
    if (checked.ok) {
      session.code = checked.code
      session.codeHash = await codeHashOf(checked.code)
      session.lineCount = checked.code.split('\n').length
      session.codeOrigin = 'baseline'
    }
  }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const deps = {
    ...input.deps,
    signal: controller.signal,
    // 取消后不再向 UI 推新事件；审计轨迹仍由 session.events 保留。
    onEvent: gateAgentEvents(input.deps.onEvent, () => controller.signal.aborted),
  }

  const emit = (event: AgentEvent) => {
    session.events.push(event)
    deps.onEvent?.(event)
  }

  const { tools, byName } = createPiAgentTools(deps, session, input.requirements)

  const stageEntry = input.settings?.models.find((m) => m.key === modelKey)
  const stageProvider = stageEntry
    ? input.settings?.providers.find((p) => p.id === stageEntry.provider)
    : undefined

  const ask = input.ask || defaultAsk()
  const bridge = createPiEventBridge()
  let pendingNudge: string | null = null
  // 与 LangGraph 引擎的 512 步上限对齐：模型只回文本时不会无限催促下去。
  let turns = 0
  const MAX_TURNS = 512

  const streamFn = createPiStreamFn({
    ask,
    modelKey,
    tools: toOpenAIFunctions(tools),
    // 进度只发字符数，不把模型原始片段带进事件流。
    onProgress: (chars) => {
      if (controller.signal.aborted) return
      emit({ type: 'custom', name: 'progress', value: { chars, turn: bridge.turnCount || 1 } })
    },
    // 工具参数分片只作为进度；工具仍由 pi 在参数完整后执行。
    onToolCallDelta: (delta) => {
      if (controller.signal.aborted || !delta.id) return
      emit({
        type: 'tool_call_args',
        toolCallId: delta.id,
        toolName: delta.name,
        delta: delta.delta,
      })
    },
  })

  const model = {
    id: stageEntry?.model || 'unknown',
    name: stageEntry?.model || 'unknown',
    api: 'openai-completions',
    provider: stageProvider?.id || 'unknown',
    baseUrl: '',
    input: [] as string[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 12000,
    reasoning: false,
  }

  const requirements = (input.requirements || []).length
    ? `\n验收要求：\n${input.requirements!.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
    : ''
  const system = `${input.system || ''}${requirements}`.trim()

  const agent = new Agent({
    initialState: {
      systemPrompt: system,
      model: model as never,
      tools: tools as AgentTool[],
    },
    streamFn,
    transformContext: async (messages) => compactPiHistory(messages),
    toolExecution: 'sequential',
    beforeToolCall: async (context) => {
      if (controller.signal.aborted) return { block: true, reason: '已取消', terminate: true }
      if (!byName.has(context.toolCall.name)) {
        return { block: true, reason: `未知工具：${context.toolCall.name}` }
      }
      return undefined
    },
    finishTurn: (turn) => {
      turns += 1
      if (session.finished || session.terminalError) return { action: 'end' }
      if (turns >= MAX_TURNS) return { action: 'end' }
      if (turn.message.stopReason === 'error' || turn.message.stopReason === 'aborted') return undefined
      if (session.attempts >= DEFAULT_AGENT_LIMITS.maxCodeAttempts && !session.trial?.ok) {
        session.terminalError = `代码修复达到 ${DEFAULT_AGENT_LIMITS.maxCodeAttempts} 次上限`
        return { action: 'end' }
      }
      if (
        session.reviewAttempts >= DEFAULT_AGENT_LIMITS.maxReviewAttempts &&
        session.review &&
        !session.review.passed &&
        !session.review.needsHumanReview
      ) {
        session.terminalError = `视觉验收达到 ${DEFAULT_AGENT_LIMITS.maxReviewAttempts} 次上限`
        return { action: 'end' }
      }
      if (!hasToolCall(turn.message)) {
        pendingNudge = session.trial?.ok
          ? session.review
            ? '请根据验收结果修复并重新运行，通过后调用 finish。'
            : '请继续 capture_frames 和 review_frames；完成验收后调用 finish。'
          : '请继续使用工具。提交代码后必须运行 run_render；不要只返回文本。'
        return { action: 'continue' }
      }
      return undefined
    },
    prepareNextTurn: () => {
      if (!pendingNudge) return undefined
      const text = pendingNudge
      pendingNudge = null
      const message: AgentMessage = { role: 'user', content: text, timestamp: Date.now() }
      return { messages: [message] }
    },
  })

  const unsubscribe = agent.subscribe((event) => {
    for (const mapped of bridge.map(event)) emit(mapped)
  })

  let timedOut = false
  let cancelled = false
  let error = ''
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    agent.abort()
  }, totalMs)

  try {
    await agent.prompt(input.prompt)
    if (controller.signal.aborted) {
      if (timedOut) error = timeoutMessage(totalMs)
      else cancelled = true
    }
  } catch (e) {
    if (timedOut) error = timeoutMessage(totalMs)
    else if ((e as Error)?.name === 'AbortError' || controller.signal.aborted) cancelled = true
    else error = (e as Error)?.message || String(e)
  } finally {
    clearTimeout(timer)
    unsubscribe()
    input.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (cancelled && !error) emit({ type: 'cancelled' })
  if (!cancelled && !error && !session.finished && !session.terminalError) {
    error = 'agent 未完成 finish'
  }
  if (session.terminalError && !error && !cancelled) error = session.terminalError
  if (error) emit({ type: 'error', message: error })

  const summary =
    session.summary ||
    (error ? `失败：${error}` : cancelled ? '已取消' : assistantText(agent.state.messages[agent.state.messages.length - 1] as AgentMessage) || '场景未完成')

  return {
    ...(session.code ? { code: session.code } : {}),
    ...(session.codeHash ? { codeHash: session.codeHash } : {}),
    ...(session.trial ? { trial: session.trial } : {}),
    ...(session.frames ? { frames: session.frames } : {}),
    ...(session.review ? { review: session.review } : {}),
    summary,
    finished: session.finished,
    cancelled,
    ...(error ? { error } : {}),
    attempts: session.attempts,
    reviewAttempts: session.reviewAttempts,
    toolProtocol: 'native',
    events: session.events,
  }
}

export type { SceneAgentSession }
