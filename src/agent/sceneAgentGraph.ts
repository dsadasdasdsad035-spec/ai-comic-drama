import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type { AppSettings } from '../api'
import { stageModelKey, type StagePick } from '../ModelSelect'
import type { SceneCodeAsk } from '../sceneCodeJob'
import { ZCodeChatModel } from './zcodeChatModel'
import {
  createSceneAgentSession,
  createSceneAgentTools,
  type SceneAgentSession,
} from './sceneAgentTools'
import {
  DEFAULT_AGENT_LIMITS,
  type AgentEvent,
  type SceneAgentDeps,
  type SceneAgentResult,
} from './sceneAgentTypes'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { createAgentEventBridge } from './sceneAgentEvents'
import { resolveAgentLimits, type AgentRunLimits } from './agentLimits'

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

export type RunSceneAgentInput = {
  prompt: string
  deps: SceneAgentDeps
  settings: AppSettings | null
  stagePick?: StagePick
  ask?: SceneCodeAsk
  requirements?: string[]
  /** 外部取消信号 */
  signal?: AbortSignal
  /** 仅供测试缩短超时；生产路径从 settings.agentLimits 解析 */
  limits?: Partial<Pick<AgentRunLimits, 'maxSteps' | 'totalMs'>>
}

function modelFacingResult(toolName: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const o = result as Record<string, unknown>
  if (toolName === 'run_sandbox') {
    const { firstFrame: _firstFrame, ...rest } = o
    return rest
  }
  if (toolName === 'capture_frames' && Array.isArray(o.frames)) {
    return {
      ...o,
      frames: o.frames.map((f) => (f && typeof f === 'object' ? { t: (f as { t?: unknown }).t } : f)),
    }
  }
  return o
}

function lastAiMessage(messages: BaseMessage[]): AIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof AIMessage) return messages[i] as AIMessage
  }
  return undefined
}

function lastText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m instanceof AIMessage) {
      const c = m.content
      if (typeof c === 'string' && c.trim()) return c.trim()
    }
  }
  return ''
}

/**
 * 浏览器内场景 agent：LangGraph 管状态/工具循环，工作台提供沙箱和视觉能力。
 * 代码只有通过 run_sandbox 才会进入工作台草稿；finish 也必须通过验收。
 */
export async function runSceneAgent(input: RunSceneAgentInput): Promise<SceneAgentResult> {
  const modelKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  if (!modelKey) throw new Error('没有可用的 3D 代码模型，请到设置页绑定「3D 代码」环节')

  const configured = resolveAgentLimits(input.settings)
  const limits = {
    maxSteps: Math.max(1, Math.round(input.limits?.maxSteps ?? configured.maxSteps)),
    totalMs: Math.max(1, Math.round(input.limits?.totalMs ?? configured.totalMs)),
  }
  const timeoutMessage = `运行超时（${Math.round(limits.totalMs / 1000)} 秒）；可在设置页「Agent 运行上限」调整`
  const session = createSceneAgentSession()
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const deps: SceneAgentDeps = { ...input.deps, signal: controller.signal }
  const { tools, byName } = createSceneAgentTools(deps, session, input.requirements)
  const model = new ZCodeChatModel({
    modelKey,
    ask: input.ask,
    tools,
  }).bindTools(tools) as ZCodeChatModel

  const requirements = (input.requirements || []).length
    ? `\n验收要求：\n${input.requirements!.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
    : ''
  const system = new SystemMessage(
    [
      '你是当前镜头的 3D 场景 agent。只能通过工具操作当前镜头；不能访问网络、文件系统或保存。',
      '工作流：get_shot_context → set_scene_code → run_sandbox → capture_frames → review_frames → finish。',
      '失败时根据工具错误修复代码，但不要伪造工具结果；完成前必须调用 finish。',
      '代码 ABI：必须定义 init(ctx)/renderAt(t)/dispose；所有可见对象必须加到 ctx.scene，镜头必须使用 ctx.camera；不要用 new THREE.Scene()/new THREE.PerspectiveCamera() 替换 ctx 提供的 scene/camera。',
      '代码必须多行书写，不要压成一行；renderAt(t) 用 t 驱动动画和相机环绕；至少添加一个可见 mesh。',
      'capture_frames 必须抓满 5 个时间点（默认 0/1/2/3/4，或覆盖完整时长的 5 个等距点）。',
      '不要输出 chain-of-thought，只输出简短说明和工具调用。',
      requirements,
    ].join('\n'),
  )

  const bridge = createAgentEventBridge()
  let errorEmitted = false
  const emit = (event: AgentEvent) => {
    session.events.push(event)
    deps.onEvent?.(event)
  }
  const consume = (raw: unknown) => {
    const event = bridge.map(raw as never)
    if (!event) return
    if (event.type === 'error') errorEmitted = true
    emit(event)
  }

  const agentNode = async (state: typeof AgentState.State) => {
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
    const response = await model.invoke(state.messages, { signal: controller.signal })
    return { messages: [response], steps: state.steps + 1 }
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
        const tool = byName.get(call.name)
        if (!tool) throw new Error(`未知工具：${call.name}`)
        // 把图的回调配置传给工具，streamEvents 才能收到 on_tool_start/end。
        result = await tool.invoke(call.args as Record<string, unknown>, config)
        if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false) isError = true
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        result = { ok: false, error: (e as Error).message || String(e) }
        isError = true
      }
      results.push(
        new ToolMessage({
          content: JSON.stringify(modelFacingResult(call.name, result)),
          tool_call_id: id,
          name: call.name,
          ...(isError ? { status: 'error' as const } : {}),
        }),
      )
    }
    return { messages: results, steps: state.steps + 1 }
  }

  const gateNode = async (state: typeof AgentState.State) => {
    if (session.finished) return {}
    if (session.terminalError) return {}
    if (session.attempts >= DEFAULT_AGENT_LIMITS.maxCodeAttempts && !session.trial?.ok) {
      session.terminalError = `代码修复达到 ${DEFAULT_AGENT_LIMITS.maxCodeAttempts} 次上限`
      return {}
    }
    if (
      session.reviewAttempts >= DEFAULT_AGENT_LIMITS.maxReviewAttempts &&
      session.review &&
      !session.review.passed &&
      !session.review.needsHumanReview
    ) {
      session.terminalError = `视觉验收达到 ${DEFAULT_AGENT_LIMITS.maxReviewAttempts} 次上限`
      return {}
    }
    if (state.steps >= limits.maxSteps) {
      session.terminalError = `agent 步骤达到上限（${limits.maxSteps}）；可在设置页「Agent 运行上限」调整`
      return {}
    }
    const ai = lastAiMessage(state.messages)
    if (!ai?.tool_calls?.length) {
      return {
        messages: [
          new SystemMessage(
            session.trial?.ok
              ? session.review
                ? '请根据验收结果修复并重新运行，通过后调用 finish。'
                : '请继续 capture_frames 和 review_frames；完成验收后调用 finish。'
              : '请继续使用工具。提交代码后必须运行 run_sandbox；不要只返回文本。',
          ),
        ],
        steps: state.steps + 1,
      }
    }
    return {}
  }

  const routeAfterAgent = (state: typeof AgentState.State): 'tools' | 'gate' => {
    const ai = lastAiMessage(state.messages)
    return ai?.tool_calls?.length ? 'tools' : 'gate'
  }
  const routeAfterGate = (state: typeof AgentState.State): 'agent' | typeof END => {
    if (session.finished || session.terminalError) return END
    if (state.steps >= limits.maxSteps) return END
    return 'agent'
  }

  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addNode('gate', gateNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', gate: 'gate' })
    .addEdge('tools', 'gate')
    .addConditionalEdges('gate', routeAfterGate, { agent: 'agent', [END]: END })
    .compile()

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, limits.totalMs)
  let cancelled = false
  let error = ''
  try {
    const stream = graph.streamEvents(
      {
        messages: [system, new HumanMessage(input.prompt)],
        steps: 0,
      },
      {
        version: 'v2',
        recursionLimit: Math.max(32, limits.maxSteps * 4 + 16),
        signal: controller.signal,
      },
    )
    for await (const event of stream) consume(event)
    if (timedOut) error = timeoutMessage
    else if (controller.signal.aborted) cancelled = true
  } catch (e) {
    if (timedOut) error = timeoutMessage
    else if ((e as Error).name === 'AbortError' || controller.signal.aborted) cancelled = true
    else error = (e as Error).message || String(e)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (cancelled && !error) {
    emit({ type: 'cancelled' })
  }
  if (!cancelled && !error && !session.finished && !session.terminalError) {
    error = 'agent 未完成 finish'
  }
  if (session.terminalError && !error) error = session.terminalError
  if (error && !errorEmitted) emit({ type: 'error', message: error })

  return {
    ...(session.code ? { code: session.code } : {}),
    ...(session.codeHash ? { codeHash: session.codeHash } : {}),
    ...(session.trial ? { trial: session.trial } : {}),
    ...(session.frames ? { frames: session.frames } : {}),
    ...(session.review ? { review: session.review } : {}),
    summary: session.summary || (error ? `失败：${error}` : cancelled ? '已取消' : '场景未完成'),
    cancelled,
    ...(error ? { error } : {}),
    attempts: session.attempts,
    reviewAttempts: session.reviewAttempts,
    events: session.events,
  }
}

export type { SceneAgentSession }
export type { AgentEvent }
