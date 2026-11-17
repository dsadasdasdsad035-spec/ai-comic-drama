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
import { applyHistoryBudget, AGGRESSIVE_HISTORY_BUDGET, type HistoryBudgetResult } from './budget'
import {
  lengthExhaustedMessage,
  MAX_TEXT_CONTINUATIONS,
  MAX_TOOL_CONTINUATIONS,
  TEXT_CONTINUATION_NUDGE,
  TOOL_CONTINUATION_NUDGE,
} from './lengthContinuation'
import { toPiTools } from './toolAdapter'
import { gateAgentEvents } from '../agentEventGate'

export type RunStageAgentInput = {
  userText: string
  /** 与 userText 同一条用户消息里的图片；没有则不传 */
  images?: ImageContent[]
  /** 已拼好的 system：技能角色层 + 锁定契约 + 只读技能 */
  system: string
  tools: ToolDef[]
  /** 只放最近若干轮，避免把整段历史重复送进模型（工作台 transcript 模式） */
  history?: string
  /** Pi 多轮历史：预置的消息按原文送入模型，不做裁剪或折叠 */
  priorMessages?: AgentMessage[]
  /** 供渠道缓存键；创意会话可传 sessionId */
  sessionId?: string
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

/** 长度上限续写次数上限：正文接着写，工具参数改用拆批策略 */


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
      ...(o.onTextDelta ? { onTextDelta: o.onTextDelta } : {}),
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
  // 不传 maxSteps 时不设工具轮次预算：循环只由模型结束、取消、总时长或渠道错误终止。
  // 显式传入时才作为内部安全阀（测试与需要主动保护的面使用）。
  const maxSteps = input.maxSteps == null ? 0 : Math.max(2, input.maxSteps)
  const ask = input.ask || defaultAsk()

  /**
   * 长度上限续写：每次续写仍是一次普通轮次，受总时长与步数安全阀约束。
   * 正文续写与工具参数续写分开计数——工具参数被截断时模型需要换拆批策略，
   * 而不是「接着往下写」。
   */
  let lastLengthKind: 'text' | 'tools' | null = null
  let textContinuations = 0
  let toolContinuations = 0
  let lengthExhausted: 'text' | 'tools' | null = null
  let pendingNudge: string | null = null

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

  // 上限只在显式要求时下发；不传就不带 max_tokens，由渠道决定。
  const maxTokens = input.maxTokens ?? runtime?.maxTokens
  // 续写用尽后的错误要说明预算来源，避免用户以为「模型抽风」。
  const tokenBudget = input.maxTokens
    ? { maxTokens: input.maxTokens, source: 'configured' as const }
    : runtime?.maxTokens
      ? { maxTokens: runtime.maxTokens, source: 'stage-default' as const }
      : { source: 'unset' as const }
  const streamFn = createPiStreamFn({
    ask,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    tools: toOpenAIFunctions(piTools),
    ...(maxTokens ? { maxTokens } : {}),
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
    onLengthStop: (kind) => {
      lastLengthKind = kind
    },
    onStreamError: (info) => {
      lastStreamKind = info.kind || null
    },
  })

  const usePiMemory = Array.isArray(input.priorMessages) && input.priorMessages.length > 0
  const history = String(input.history || '').trim().slice(-6000)
  const userText = usePiMemory
    ? input.userText
    : history
      ? `【之前的对话】\n${history}\n\n${input.userText}`
      : input.userText

  let steps = 0
  let hitLimit = false
  let agent: Agent | undefined
  /** 最近一次历史投影的规模统计（诊断与 system 一致性用） */
  let lastBudget: HistoryBudgetResult | null = null
  let lastBudgetSignature = ''
  /** 渠道错误 kind：只有 context-overflow 值得压缩重跑 */
  let lastStreamKind: string | null = null
  /** 上下文超限只用激进预算重试一次，避免无限重跑 */
  let aggressive = false
  let overflowRetried = false

  agent = new Agent({
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    // 历史预算只作用于「送往模型的投影」：context.messages 仍是全量，
    // 界面线程与落库内容不受影响（creative-thread-context 的现行要求）。
    transformContext: async (messages) => {
      // 重试时用激进预算：卸载更多、摘要更多，并丢掉上一轮失败的助手消息
      // （它只带错误文案，留着只会继续抬高体积）。
      const source = aggressive
        ? messages.filter(
            (m) =>
              !(
                (m as unknown as { role?: string }).role === 'assistant' &&
                (m as unknown as { stopReason?: string }).stopReason === 'error'
              ),
          )
        : messages
      const projected = applyHistoryBudget(
        source,
        aggressive
          ? { budget: AGGRESSIVE_HISTORY_BUDGET, keepRounds: 1 }
          : undefined,
      )
      lastBudget = projected
      if (projected.stubbed || projected.summarized) {
        const signature = `${projected.stubbed}:${projected.summarized}`
        if (signature !== lastBudgetSignature) {
          lastBudgetSignature = signature
          emit({
            type: 'custom',
            name: 'context_compaction',
            value: {
              stubbed: projected.stubbed,
              summarized: projected.summarized,
              charsBefore: projected.charsBefore,
              charsAfter: projected.charsAfter,
            },
          })
        }
      }
      return projected.messages
    },
    initialState: {
      systemPrompt: input.system,
      ...(usePiMemory ? { messages: [...input.priorMessages!] } : {}),
      model: {
        id: input.modelKey || 'unknown',
        name: input.modelKey || 'unknown',
        api: 'openai-completions',
        provider: 'project-proxy',
        baseUrl: '',
        input: [],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 0,
        maxTokens: maxTokens ?? 0,
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

      // 撞输出长度上限：保留已生成部分，注入推动消息继续，而不是以失败结束。
      if (turn.message.stopReason === 'length') {
        const kind = lastLengthKind || 'text'
        lastLengthKind = null
        const limit = kind === 'tools' ? MAX_TOOL_CONTINUATIONS : MAX_TEXT_CONTINUATIONS
        const used = kind === 'tools' ? toolContinuations : textContinuations
        if (used < limit) {
          if (kind === 'tools') toolContinuations += 1
          else textContinuations += 1
          pendingNudge = kind === 'tools' ? TOOL_CONTINUATION_NUDGE : TEXT_CONTINUATION_NUDGE
          emit({
            type: 'custom',
            name: 'continuation',
            value: { attempt: used + 1, total: limit, reason: kind },
          })
          return { action: 'continue' }
        }
        lengthExhausted = kind
        return { action: 'end' }
      }

      // 没有工具调用 = 本轮自然结束；与升级前「工具循环结束即完成」一致。
      if (!hasToolCall(turn.message)) return undefined
      // 显式步数上限只是内部安全阀：超过即终止，退出后补发可读错误。
      if (maxSteps > 0 && steps >= maxSteps) {
        hitLimit = true
        return { action: 'end' }
      }
      return undefined
    },
    prepareNextTurn: () => {
      if (!pendingNudge) return undefined
      const text = pendingNudge
      pendingNudge = null
      return { messages: [{ role: 'user', content: text, timestamp: Date.now() } as AgentMessage] }
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
    const runOnce = async () => {
      const outcome = await Promise.race([agent.prompt(userText, images).then(() => 'done' as const), stopped])
      if (outcome === 'stopped' || controller.signal.aborted) {
        if (timedOut) error = timeoutMessage(input.totalMs ?? 180_000)
        else cancelled = true
        return
      }
      // streamFn 按 pi 契约把渠道失败编码进消息而不是抛出；
      // 不在这里读出来，运行就会以「无错误」结束，错误被静默吞掉。
      error = lastStreamError(agent.state.messages)
    }
    await runOnce()

    // 上下文超限：换激进预算的投影再跑一次，而不是让用户丢掉整段历史。
    // 事件沿用同一 bridge，失败的助手消息在投影里被剔除，所以正文不会重复。
    if (
      !cancelled &&
      !timedOut &&
      lastStreamKind === 'context-overflow' &&
      !overflowRetried
    ) {
      overflowRetried = true
      aggressive = true
      error = ''
      emit({
        type: 'custom',
        name: 'context_compaction',
        value: { reason: 'context-overflow', retry: 1, budget: AGGRESSIVE_HISTORY_BUDGET },
      })
      // pi 的 continue 要求末条不是 assistant；失败的那条只带错误文案，直接摘掉。
      const msgs = agent.state.messages
      if (msgs[msgs.length - 1]?.role === 'assistant') {
        agent.state.messages = msgs.slice(0, -1)
      }
      const outcome = await Promise.race([agent.continue().then(() => 'done' as const), stopped])
      if (outcome === 'stopped' || controller.signal.aborted) {
        if (timedOut) error = timeoutMessage(input.totalMs ?? 180_000)
        else cancelled = true
      } else {
        error = lastStreamError(agent.state.messages)
        if (error && lastStreamKind === 'context-overflow') {
          error = '上下文超限：已用压缩历史重试一次仍失败，建议新建会话（历史仍保留在侧栏）。'
        }
      }
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
    // 续写次数用尽：给出比「被截断」更具体的下一步，而不是停在笼统文案上。
    if (lengthExhausted && !cancelled) error = lengthExhaustedMessage(lengthExhausted, tokenBudget)
    if (!cancelled && !error && hitLimit) error = `工具循环达到 ${maxSteps} 步上限`
  if (error) emit({ type: 'error', message: error })

  return {
    ...(error ? { error } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    steps,
  }
}

function timeoutMessage(ms: number): string {
  // 超时是唯一的产品级预算；已完成部分仍在历史里，用户可接着做。
  return `运行超时（${Math.round(ms / 1000)} 秒）；已完成部分已保留，回复「继续」可接着做`
}

/**
 * 取最后一条助手消息的流错误；正常结束时返回空串。
 *
 * 'length' 也在这里读一遍：某些渠道/历史线程里它可能没被编码成 error。
 */
function lastStreamError(messages: readonly AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    const stopReason = (message as { stopReason?: unknown }).stopReason
    if (stopReason === 'length') return '模型输出达到长度上限被截断；已保留生成部分，可继续让它往下写'
    if (stopReason !== 'error') return ''
    const detail = (message as { errorMessage?: unknown }).errorMessage
    return String(detail || '模型调用失败')
  }
  return ''
}
