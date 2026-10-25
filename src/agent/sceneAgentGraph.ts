import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type { AppSettings } from '../api'
import { stageModelKey, type StagePick } from '../ModelSelect'
import type { SceneCodeAsk } from '../sceneCodeJob'
import { ZCodeChatModel } from './zcodeChatModel'
import { NativeToolChatModel } from './nativeToolChatModel'
import { resolveToolProtocol } from './toolCapabilities'
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
import { checkSceneCode } from '../sceneCodeSanitize'
import { codeHashOf } from '../sceneCodeFingerprint'
import { resolveAgentLimits, type AgentRunLimits } from './agentLimits'
import type { ManifestSummary } from '../contextManifest'

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
  /** 可在本轮开始时作为运行基线的当前工作台代码 */
  initialCode?: string
  /** 本轮显式附件清单的摘要；用于每轮审计事件 */
  manifestSummary?: ManifestSummary
  /** 外部已组装好的 system（技能角色层 + 锁定契约 + 验收要求）；缺省用旧常量 */
  system?: string
  /** 外部取消信号 */
  signal?: AbortSignal
  /** 仅供测试缩短超时；生产路径从 settings.agentLimits 解析 */
  limits?: Partial<Pick<AgentRunLimits, 'totalMs'>>
}

function modelFacingResult(toolName: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const o = result as Record<string, unknown>
  if (toolName === 'run_render') {
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
 * 浏览器内场景 agent：LangGraph 管状态/工具循环，工作台提供 Blender 渲染和视觉能力。
 * 代码只有通过 run_render 才会进入工作台草稿；finish 也必须通过验收。
 */
export async function runSceneAgent(input: RunSceneAgentInput): Promise<SceneAgentResult> {
  const modelKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  if (!modelKey) throw new Error('没有可用的 3D 代码模型，请到设置页绑定「3D 代码」环节')

  const configured = resolveAgentLimits(input.settings)
  const limits = {
    totalMs: Math.max(1, Math.round(input.limits?.totalMs ?? configured.totalMs)),
  }
  const timeoutMessage = `运行超时（${Math.round(limits.totalMs / 1000)} 秒）；可在设置页「Agent 运行上限」调整`
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
  const deps: SceneAgentDeps = { ...input.deps, signal: controller.signal }
  const { tools, byName } = createSceneAgentTools(deps, session, input.requirements)
  const stageEntryKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  const stageEntry = input.settings?.models.find((m) => m.key === stageEntryKey)
  const stageProvider = stageEntry
    ? input.settings?.providers.find((p) => p.id === stageEntry.provider)
    : undefined
  const resolution = resolveToolProtocol(
    input.settings?.agentToolProtocol,
    stageProvider?.id,
    stageEntry?.model,
  )
  if (resolution.error) throw new Error(resolution.error)
  const toolProtocol = resolution.protocol
  const model =
    toolProtocol === 'native'
      ? new NativeToolChatModel({
          modelKey,
          ask: input.ask,
          tools,
        }).bindTools(tools)
      : new ZCodeChatModel({
          modelKey,
          ask: input.ask,
          tools,
        }).bindTools(tools)

  const requirements = (input.requirements || []).length
    ? `\n验收要求：\n${input.requirements!.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
    : ''
  // 3D 身份只来自 scene3d 技能；这里不再注入硬编码的角色前导。
  const system = new SystemMessage(`${input.system || ''}${requirements}`.trim())

  const bridge = createAgentEventBridge()
  let errorEmitted = false
  const emit = (event: AgentEvent) => {
    session.events.push(event)
    deps.onEvent?.(event)
  }
  // 流式进度：只发字符数，不把模型原始片段带进事件流。
  model.onProgress = (chars) => {
    if (controller.signal.aborted) return
    emit({ type: 'custom', name: 'progress', value: { chars, turn: bridge.turnCount || 1 } })
  }
  if (model instanceof NativeToolChatModel) {
    // 工具参数增量只作为进度事件；真正执行仍由 tools 节点在参数完整后进行。
    model.onToolCallDelta = (delta) => {
      if (controller.signal.aborted || !delta.id) return
      emit({ type: 'tool_call_args', toolCallId: delta.id, toolName: delta.name, delta: delta.delta })
    }
  }
  emit({
    type: 'custom',
    name: 'tool_protocol',
    value: {
      protocol: toolProtocol,
      reason: resolution.reason,
      provider: stageProvider?.id || '',
      model: stageEntry?.model || '',
    },
  })
  const consume = (raw: unknown) => {
    const mapped = bridge.map(raw as never)
    if (!mapped) return
    for (const event of Array.isArray(mapped) ? mapped : [mapped]) {
      if (event.type === 'error') errorEmitted = true
      emit(event)
    }
  }

  const agentNode = async (state: typeof AgentState.State) => {
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
    const turn = state.steps + 1
    if (input.manifestSummary) {
      emit({
        type: 'context_manifest',
        turn,
        keys: input.manifestSummary.attachmentKeys,
        counts: input.manifestSummary.counts,
        metadata: input.manifestSummary.metadata,
      })
    }
    const response = await model.invoke(state.messages, { signal: controller.signal })
    return { messages: [response], steps: turn }
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
    const ai = lastAiMessage(state.messages)
    if (!ai?.tool_calls?.length) {
      return {
        messages: [
          new HumanMessage(
            session.trial?.ok
              ? session.review
                ? '请根据验收结果修复并重新运行，通过后调用 finish。'
                : '请继续 capture_frames 和 review_frames；完成验收后调用 finish。'
              : '请继续使用工具。提交代码后必须运行 run_render；不要只返回文本。',
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
    if (state.steps >= 512) return END
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
        recursionLimit: 512,
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
    finished: session.finished,
    cancelled,
    ...(error ? { error } : {}),
    attempts: session.attempts,
    reviewAttempts: session.reviewAttempts,
    toolProtocol,
    events: session.events,
  }
}

export type { SceneAgentSession }
export type { AgentEvent }
