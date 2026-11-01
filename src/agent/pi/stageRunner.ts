import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent } from '@earendil-works/pi-ai'
import type { Stage } from '../../api'
import type { SceneCodeAsk } from '../../sceneCodeJob'
import { stageRuntime } from '../../skills/stages'
import { callTextStream } from '../../api'
import type { AgentEvent } from '../sceneAgentTypes'
import type { ToolDef } from '../tool'
import { createPiEventBridge } from './events'
import { createPiStreamFn, toOpenAIFunctions } from './streamFn'
import { toPiTools } from './toolAdapter'
import { gateAgentEvents } from '../agentEventGate'

export type RunStageAgentInput = {
  userText: string
  /** 与 userText 同一条用户消息里的图片；没有则不传 */
  images?: ImageContent[]
  /** 已拼好的 system：技能角色层 + 锁定契约 + 只读技能 */
  system: string
  tools: ToolDef[]
  /** 只放最近若干轮，避免把整段历史重复送进模型 */
  history?: string
  modelKey?: string
  stage?: Stage
  ask?: SceneCodeAsk
  maxTokens?: number
  temperature?: number
  maxSteps?: number
  totalMs?: number
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

export type RunStageAgentResult = {
  error?: string
  cancelled?: boolean
  steps: number
}

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

/**
 * 通用聊天运行器：工作台、发布与创意共用。
 *
 * 与 3D 运行器的差别只在「结束条件」：这里没有渲染门禁与 finish 工具，
 * 模型不再给出工具调用就是本轮结束。没有工具调用时 finishTurn 返回 undefined，
 * pi 的循环随即退出，与升级前的行为一致。
 */
export async function runStageAgent(input: RunStageAgentInput): Promise<RunStageAgentResult> {
  const runtime = input.stage ? stageRuntime(input.stage) : undefined
  const maxSteps = Math.max(2, input.maxSteps ?? 16)
  const ask = input.ask || defaultAsk()

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    agent?.abort()
  }, Math.max(1000, input.totalMs ?? 180_000))

  const emit = gateAgentEvents(
    (event) => input.onEvent?.(event),
    () => controller.signal.aborted,
  )
  const bridge = createPiEventBridge()

  const piTools = toPiTools(input.tools)
  const byName = new Map(piTools.map((tool) => [tool.name, tool]))

  const streamFn = createPiStreamFn({
    ask,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    tools: toOpenAIFunctions(piTools),
    maxTokens: input.maxTokens ?? runtime?.maxTokens ?? 8192,
    temperature: input.temperature ?? runtime?.temperature ?? 0.3,
    // 进度只发字符数，不把模型原始片段带进事件流。
    onProgress: (chars) => {
      if (controller.signal.aborted) return
      emit({ type: 'custom', name: 'progress', value: { chars, turn: bridge.turnCount || 1 } })
    },
    onToolCallDelta: (delta) => {
      if (controller.signal.aborted || !delta.id) return
      emit({ type: 'tool_call_args', toolCallId: delta.id, toolName: delta.name, delta: delta.delta })
    },
  })

  const history = String(input.history || '').trim().slice(-6000)
  const userText = history ? `【之前的对话】\n${history}\n\n${input.userText}` : input.userText

  let steps = 0
  let hitLimit = false
  let agent: Agent | undefined

  agent = new Agent({
    initialState: {
      systemPrompt: input.system,
      model: {
        id: input.modelKey || 'unknown',
        name: input.modelKey || 'unknown',
        api: 'openai-completions',
        provider: 'project-proxy',
        baseUrl: '',
        input: [],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 0,
        maxTokens: input.maxTokens ?? runtime?.maxTokens ?? 8192,
        reasoning: false,
      } as never,
      tools: piTools as AgentTool[],
    },
    streamFn,
    toolExecution: 'sequential',
    beforeToolCall: async (context) => {
      if (controller.signal.aborted) return { block: true, reason: '已取消', terminate: true }
      if (!byName.has(context.toolCall.name)) {
        return { block: true, reason: `未知工具：${context.toolCall.name}` }
      }
      return undefined
    },
    finishTurn: (turn) => {
      steps += 1
      // 没有工具调用 = 本轮自然结束；与升级前「工具循环结束即完成」一致。
      if (!hasToolCall(turn.message)) return undefined
      // 步数上限只是内部安全阀：超过即终止，退出后补发可读错误。
      if (steps >= maxSteps) {
        hitLimit = true
        return { action: 'end' }
      }
      return undefined
    },
  })

  const unsubscribe = agent.subscribe((event) => {
    if (controller.signal.aborted && event.type !== 'agent_end') return
    for (const mapped of bridge.map(event)) emit(mapped)
  })

  let cancelled = false
  let error = ''
  // 超时/取消都只中止当前流，不保证 agent.prompt 立刻 settle（渠道可能挂住不返回）。
  // 与中止信号竞速，保证到点就结束这一轮，而不是等底层自己醒过来。
  const stopped = new Promise<'stopped'>((resolve) => {
    const onStop = () => resolve('stopped')
    if (controller.signal.aborted) onStop()
    else controller.signal.addEventListener('abort', onStop, { once: true })
  })
  try {
    const images = input.images?.length ? input.images : undefined
    const outcome = await Promise.race([agent.prompt(userText, images).then(() => 'done' as const), stopped])
    if (outcome === 'stopped' || controller.signal.aborted) {
      if (timedOut) error = timeoutMessage(input.totalMs ?? 180_000)
      else cancelled = true
    } else {
      // streamFn 按 pi 契约把渠道失败编码进消息而不是抛出；
      // 不在这里读出来，运行就会以「无错误」结束，错误被静默吞掉。
      error = lastStreamError(agent.state.messages)
    }
  } catch (e) {
    if (timedOut) error = timeoutMessage(input.totalMs ?? 180_000)
    else if ((e as Error)?.name === 'AbortError' || controller.signal.aborted) cancelled = true
    else error = (e as Error)?.message || String(e)
  } finally {
    clearTimeout(timer)
    unsubscribe()
    input.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (cancelled) emit({ type: 'cancelled' })
  if (!cancelled && !error && hitLimit) error = `工具循环达到 ${maxSteps} 步上限`
  if (error) emit({ type: 'error', message: error })

  return {
    ...(error ? { error } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    steps,
  }
}

function timeoutMessage(ms: number): string {
  return `运行超时（${Math.round(ms / 1000)} 秒）`
}

/** 取最后一条助手消息里的流错误；正常结束时返回空串。 */
function lastStreamError(messages: readonly AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    const stopReason = (message as { stopReason?: unknown }).stopReason
    if (stopReason !== 'error') return ''
    const detail = (message as { errorMessage?: unknown }).errorMessage
    return String(detail || '模型调用失败')
  }
  return ''
}
