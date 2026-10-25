import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { Stage } from '../api'
import type { SceneCodeAsk } from '../sceneCodeJob'
import { stageRuntime } from '../skills/stages'
import { createAgentEventBridge } from './sceneAgentEvents'
import type { AgentEvent } from './sceneAgentTypes'
import { ZCodeChatModel } from './zcodeChatModel'

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  steps: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
})

export type RunStageAgentInput = {
  userText: string
  /** 已拼好的 system：技能角色层 + 锁定契约 + 只读技能 */
  system: string
  tools: StructuredToolInterface[]
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

function lastAiMessage(messages: BaseMessage[]): AIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof AIMessage) return messages[i] as AIMessage
  }
  return undefined
}

/** 通用 JSON-action 工具循环：没有 3D 的 finish 门禁，工具调用结束即完成。 */
export async function runStageAgent(input: RunStageAgentInput): Promise<RunStageAgentResult> {
  const runtime = input.stage ? stageRuntime(input.stage) : undefined
  const maxSteps = Math.max(2, input.maxSteps ?? 16)
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1000, input.totalMs ?? 180_000))

  const toolByName = new Map(input.tools.map((t) => [t.name, t]))
  const model = new ZCodeChatModel({
    modelKey: input.modelKey,
    ask: input.ask,
    tools: input.tools,
    maxTokens: input.maxTokens ?? runtime?.maxTokens ?? 8192,
    temperature: input.temperature ?? runtime?.temperature ?? 0.3,
  }).bindTools(input.tools) as ZCodeChatModel

  const bridge = createAgentEventBridge()
  const emit = (event: AgentEvent) => input.onEvent?.(event)
  model.onProgress = (chars) => {
    if (controller.signal.aborted) return
    emit({ type: 'custom', name: 'progress', value: { chars, turn: bridge.turnCount || 1 } })
  }

  let hitLimit = false
  let steps = 0
  const agentNode = async (state: typeof AgentState.State) => {
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
    const response = await model.invoke(state.messages, { signal: controller.signal })
    steps = state.steps + 1
    return { messages: [response], steps }
  }

  const toolsNode = async (state: typeof AgentState.State, config: RunnableConfig) => {
    const ai = lastAiMessage(state.messages)
    if (!ai?.tool_calls?.length) return { steps: state.steps + 1 }
    const results: BaseMessage[] = []
    for (const call of ai.tool_calls) {
      if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      const id = String(call.id || `call_${state.steps}_${results.length}`)
      let result: unknown
      let isError = false
      try {
        const tool = toolByName.get(call.name)
        if (!tool) throw new Error(`未知工具：${call.name}`)
        result = await tool.invoke(call.args as Record<string, unknown>, config)
        if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false) isError = true
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        result = { ok: false, error: (e as Error).message || String(e) }
        isError = true
      }
      results.push(
        new ToolMessage({
          content: JSON.stringify(result),
          tool_call_id: id,
          name: call.name,
          ...(isError ? { status: 'error' as const } : {}),
        }),
      )
    }
    steps = state.steps + 1
    return { messages: results, steps }
  }

  const routeAfterAgent = (state: typeof AgentState.State): 'tools' | typeof END => {
    const ai = lastAiMessage(state.messages)
    return ai?.tool_calls?.length ? 'tools' : END
  }
  const routeAfterTools = (state: typeof AgentState.State): 'agent' | typeof END => {
    if (state.steps >= maxSteps) {
      hitLimit = true
      return END
    }
    return 'agent'
  }

  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
    .addConditionalEdges('tools', routeAfterTools, { agent: 'agent', [END]: END })
    .compile()

  const history = String(input.history || '').trim().slice(-6000)
  const messages: BaseMessage[] = [new SystemMessage(input.system)]
  if (history) messages.push(new HumanMessage(`【之前的对话】\n${history}`))
  messages.push(new HumanMessage(input.userText))

  let error = ''
  let cancelled = false
  let errorEmitted = false
  try {
    const stream = graph.streamEvents(
      { messages, steps: 0 },
      { version: 'v2', recursionLimit: Math.max(32, maxSteps * 4 + 16), signal: controller.signal },
    )
    for await (const event of stream) {
      const mapped = bridge.map(event as never)
      if (!mapped) continue
      for (const e of Array.isArray(mapped) ? mapped : [mapped]) {
        if (e.type === 'error') errorEmitted = true
        emit(e)
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError' || controller.signal.aborted) cancelled = true
    else error = (e as Error).message || String(e)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (timedOut) {
    cancelled = false
    error = `运行超时（${Math.round((input.totalMs ?? 180_000) / 1000)} 秒）`
  }
  if (cancelled) emit({ type: 'cancelled' })
  if (!cancelled && !error && hitLimit) error = `工具循环达到 ${maxSteps} 步上限`
  if (error && !errorEmitted) emit({ type: 'error', message: error })

  return {
    ...(error ? { error } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    steps,
  }
}
