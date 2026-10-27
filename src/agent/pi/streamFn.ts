// pi-ai 的 index 只把事件流类作为类型导出；运行时类在 utils/event-stream 子路径。
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { AssistantMessage, JsonObject, ToolCall, Usage } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import type { ProviderChatMessage, ProviderToolCall, ProviderToolCallDelta } from '../../api'
import type { SceneCodeAsk } from '../../sceneCodeJob'
import { toProviderMessages } from './messages'

export type PiStreamDeps = {
  ask: SceneCodeAsk
  /** 设置页模型键；缺省由 ask 自己解析 */
  modelKey?: string
  /** OpenAI function 定义；由工具清单生成 */
  tools?: Record<string, unknown>[]
  maxTokens?: number
  temperature?: number
  /** 已生成字符数；只作进度 */
  onProgress?: (chars: number) => void
  /** 工具参数分片；只作进度，参数完整前不执行 */
  onToolCallDelta?: (delta: ProviderToolCallDelta) => void
}

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function usageOf(raw: unknown): Usage {
  if (!raw || typeof raw !== 'object') return EMPTY_USAGE
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const input = num(o.prompt_tokens ?? o.input_tokens ?? o.input)
  const output = num(o.completion_tokens ?? o.output_tokens ?? o.output)
  return {
    ...EMPTY_USAGE,
    input,
    output,
    totalTokens: num(o.total_tokens ?? o.totalTokens) || input + output,
  }
}

type ModelInfo = { id?: string; api?: string; provider?: string }

function baseMessage(model: ModelInfo | undefined, stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model?.api ?? 'unknown',
    provider: model?.provider ?? 'unknown',
    model: model?.id ?? 'unknown',
    usage: EMPTY_USAGE,
    stopReason,
    timestamp: Date.now(),
  }
}

function errText(e: unknown): string {
  const message = (e as Error)?.message || String(e)
  return message || '模型调用失败'
}

/**
 * 把项目的 `/api/text` 代理包装成 pi 的 StreamFn。
 *
 * 契约（pi 要求）：
 * - 不 throw；失败编码成 `error` 事件 + stopReason 'error' | 'aborted'
 * - 必须自己响应 options.signal：agent.abort() 只中止当前流，不会停循环
 */
export function createPiStreamFn(deps: PiStreamDeps): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream()

    const fail = (text: string, aborted: boolean) => {
      const message = baseMessage(model, aborted ? 'aborted' : 'error')
      message.errorMessage = text
      stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message })
    }

    const run = async () => {
      const signal = options?.signal
      if (signal?.aborted) {
        fail('已取消', true)
        return
      }
      let result: Awaited<ReturnType<SceneCodeAsk>>
      try {
        result = await deps.ask({
          messages: toProviderMessages(context.messages),
          ...(deps.tools?.length ? { tools: deps.tools, toolChoice: 'auto' } : {}),
          maxTokens: deps.maxTokens ?? 12000,
          temperature: deps.temperature ?? 0.3,
          ...(deps.modelKey ? { modelKey: deps.modelKey } : {}),
          ...(signal ? { signal } : {}),
          ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
          ...(deps.onToolCallDelta ? { onToolCallDelta: deps.onToolCallDelta } : {}),
        })
      } catch (e) {
        const aborted = (e as Error)?.name === 'AbortError' || Boolean(signal?.aborted)
        fail(aborted ? '已取消' : errText(e), aborted)
        return
      }
      if (signal?.aborted) {
        fail('已取消', true)
        return
      }

      const finishReason = String(result.finishReason || '')
      const text = String(result.text || '')
      const rawCalls = Array.isArray(result.toolCalls) ? (result.toolCalls as ProviderToolCall[]) : []
      if (finishReason === 'length') {
        fail(
          rawCalls.length
            ? '模型输出达到长度上限，工具参数可能不完整；请缩小单次输出或改用草稿分片后重试'
            : '模型输出达到长度上限被截断；请缩小单次输出后重试',
          false,
        )
        return
      }

      const toolCalls: ToolCall[] = []
      for (const [index, call] of rawCalls.entries()) {
        const name = String(call.name || '').trim()
        if (!name) {
          fail('模型返回了没有名称的工具调用', false)
          return
        }
        const rawArgs = String(call.arguments ?? '').trim()
        let args: unknown
        try {
          args = rawArgs ? JSON.parse(rawArgs) : {}
        } catch {
          fail(`模型返回的工具参数不是合法 JSON（${name}）；请重新生成，或缩小单次工具参数`, false)
          return
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          fail(`模型返回的工具参数必须是 JSON 对象（${name}）`, false)
          return
        }
        toolCalls.push({
          type: 'toolCall',
          id: String(call.id || `call_${index}`),
          name,
          arguments: args as JsonObject,
        })
      }

      const message = baseMessage(model, toolCalls.length ? 'toolUse' : 'stop')
      message.usage = usageOf(result.usage)
      const content: AssistantMessage['content'] = []
      if (text) content.push({ type: 'text', text })
      content.push(...toolCalls)
      message.content = content

      stream.push({ type: 'start', partial: message })
      if (text) {
        stream.push({ type: 'text_start', contentIndex: 0, partial: message })
        stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message })
        stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message })
      }
      for (const [index, call] of toolCalls.entries()) {
        const contentIndex = (text ? 1 : 0) + index
        stream.push({ type: 'toolcall_start', contentIndex, partial: message })
        stream.push({
          type: 'toolcall_delta',
          contentIndex,
          delta: JSON.stringify(call.arguments),
          partial: message,
        })
        stream.push({ type: 'toolcall_end', contentIndex, toolCall: call, partial: message })
      }
      stream.push({
        type: 'done',
        reason: toolCalls.length ? 'toolUse' : 'stop',
        message,
      })
    }

    void run().catch((e) => {
      // run 内部已处理所有可预期错误；这一层只兜底，保证 streamFn 永不 throw。
      fail(errText(e), Boolean(options?.signal?.aborted))
    })
    return stream
  }
}

/** pi 的 Tool[] → OpenAI function 定义；去掉 TypeBox 生成的 $schema/$id。 */
export function toOpenAIFunctions(tools: readonly { name: string; description: string; parameters: unknown }[]): Record<string, unknown>[] {
  return tools.map((tool) => {
    const raw = (tool.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>
    const { $schema: _schema, $id: _id, ...parameters } = raw
    return {
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters,
      },
    }
  })
}
