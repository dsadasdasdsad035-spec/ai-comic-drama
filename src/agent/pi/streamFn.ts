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
  /** 不传就不带 max_tokens，上限交给渠道默认值 */
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

function textContent(text: string): AssistantMessage['content'] {
  return text ? [{ type: 'text', text }] : []
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
 *
 * 正文是**真流式**转发的：代理每吐一段 delta 就立刻推成 pi 的
 * text_delta 事件，界面边生成边显示，不必等整段完成。这也意味着
 * 输出被截断时已经流出的正文不会丢——错误消息里带上它，
 * 既留在界面上，也进下一轮历史。
 */
export function createPiStreamFn(deps: PiStreamDeps): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream()

    /** 已流出的正文；截断或失败时保留，不再整份丢弃 */
    let text = ''
    let started = false
    let textStarted = false

    const partialWithText = (value: string): AssistantMessage => {
      const message = baseMessage(model, 'stop')
      message.content = textContent(value)
      return message
    }

    /** start 必须先于任何 text / toolcall 事件：pi 靠它把 partial 放进上下文 */
    const ensureStarted = () => {
      if (started) return
      started = true
      stream.push({ type: 'start', partial: partialWithText(text) })
    }

    const pushTextDelta = (delta: string) => {
      if (!delta) return
      ensureStarted()
      if (!textStarted) {
        textStarted = true
        stream.push({ type: 'text_start', contentIndex: 0, partial: partialWithText(text) })
      }
      text += delta
      stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: partialWithText(text) })
    }

    const closeText = (message: AssistantMessage) => {
      if (textStarted) {
        stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message })
      }
    }

    const fail = (reason: string, aborted: boolean) => {
      const message = baseMessage(model, aborted ? 'aborted' : 'error')
      message.errorMessage = reason
      // 关键：把已经流出的正文放回错误消息。界面不会丢，toProviderMessages
      // 也会把 assistant 的正文带进下一轮，模型记得自己写到哪。
      message.content = textContent(text)
      closeText(message)
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
          ...(deps.maxTokens ? { maxTokens: deps.maxTokens } : {}),
          temperature: deps.temperature ?? 0.3,
          ...(deps.modelKey ? { modelKey: deps.modelKey } : {}),
          ...(signal ? { signal } : {}),
          // 正文已经在流式显示，字符计数卡片就成了重复信息；只在还没有正文时保留。
          ...(deps.onProgress
            ? {
                onProgress: (chars: number) => {
                  if (!textStarted) deps.onProgress!(chars)
                },
              }
            : {}),
          onTextDelta: pushTextDelta,
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

      // 渠道忽略 stream 时代理回退成整段 JSON，没有增量，这里补一次。
      if (!text) {
        const whole = String(result.text || '')
        if (whole) pushTextDelta(whole)
      }

      const finishReason = String(result.finishReason || '')
      const rawCalls = Array.isArray(result.toolCalls) ? (result.toolCalls as ProviderToolCall[]) : []

      // 撞上限一律编码成 error：pi 见到 'length' 也不会执行工具调用。
      // 关键是 fail() 把已经流出的正文带回错误消息——界面不丢，历史也不丢。
      if (finishReason === 'length') {
        fail(
          rawCalls.length
            ? '模型输出达到长度上限，工具参数被截断；已保留生成内容，请缩小单次输出或分批重试'
            : '模型输出达到长度上限被截断；已保留生成部分，可继续让它往下写',
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
      message.content = [...textContent(text), ...toolCalls]
      // 纯工具调用没有正文时也要先 start，否则 pi 会补发 message_start，UI 多出一张空卡。
      ensureStarted()
      closeText(message)
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
