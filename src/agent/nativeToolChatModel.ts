import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatResult } from '@langchain/core/outputs'
import { z } from 'zod'
import {
  callTextStream,
  type ProviderChatMessage,
  type ProviderToolCallDelta,
} from '../api'
import type { SceneCodeAsk } from '../sceneCodeJob'
import { compactDraftHistory } from './agentHistory'

export type NativeToolChatModelParams = BaseChatModelParams & {
  modelKey?: string
  ask?: SceneCodeAsk
  tools?: StructuredToolInterface[]
  /** 只用于稳定生成工具 id；多轮会话可以递增 */
  callSequence?: number
  onProgress?: (chars: number) => void
  /** 原生工具参数增量；只作为进度，参数完整前不执行 */
  onToolCallDelta?: (delta: ProviderToolCallDelta) => void
  /** 缺省 12000 */
  maxTokens?: number
  temperature?: number
}

function messageText(message: BaseMessage): string {
  const content = message.content as unknown
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text || '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(content ?? '')
}

function toolCallId(call: { id?: string }, seq: number, index: number): string {
  return String(call.id || `call_${seq}_${index}`)
}

/**
 * LangChain 消息 → OpenAI 兼容消息。
 * - system 全部合并到首条（compactDraftHistory 会在历史中间插入草稿摘要，部分渠道不接受中间 system）
 * - assistant 带 tool_calls 时保留参数字符串
 * - tool 只保留有对应 tool_call_id 的消息，避免 provider 因孤立工具结果报错
 */
export function toProviderMessages(messages: BaseMessage[]): ProviderChatMessage[] {
  const compacted = compactDraftHistory(messages)
  const systems: string[] = []
  const rest: ProviderChatMessage[] = []
  let seq = 1
  for (const message of compacted) {
    const type = message.getType()
    if (type === 'system') {
      const text = messageText(message).trim()
      if (text) systems.push(text)
      continue
    }
    if (type === 'human' || type === 'user') {
      rest.push({ role: 'user', content: messageText(message) })
      continue
    }
    if (message instanceof AIMessage || type === 'ai') {
      const ai = message as AIMessage
      const text = messageText(ai).trim()
      const calls = Array.isArray(ai.tool_calls) ? ai.tool_calls : []
      if (calls.length) {
        rest.push({
          role: 'assistant',
          content: text,
          tool_calls: calls.map((call, index) => ({
            id: toolCallId(call, seq, index),
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          })),
        })
        seq += 1
      } else if (text) {
        rest.push({ role: 'assistant', content: text })
      }
      continue
    }
    if (type === 'tool' && message instanceof ToolMessage) {
      rest.push({
        role: 'tool',
        tool_call_id: String(message.tool_call_id || ''),
        content: messageText(message),
        ...(message.name ? { name: message.name } : {}),
      })
      continue
    }
    const text = messageText(message).trim()
    if (text) rest.push({ role: 'user', content: text })
  }

  const callIds = new Set<string>()
  for (const message of rest) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls as { id?: unknown }[]) {
      if (call && typeof call === 'object' && call.id) callIds.add(String(call.id))
    }
  }
  const cleaned = rest.filter(
    (message) => message.role !== 'tool' || callIds.has(String(message.tool_call_id || '')),
  )
  return [
    ...(systems.length ? [{ role: 'system' as const, content: systems.join('\n\n') }] : []),
    ...cleaned,
  ]
}

/** zod 工具 → OpenAI function 定义；去掉 zod 生成的 $schema，避免部分渠道拒收。 */
export function toOpenAITool(tool: StructuredToolInterface): {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
} {
  let parameters: Record<string, unknown> = { type: 'object', properties: {} }
  try {
    const schema = z.toJSONSchema(tool.schema as never) as Record<string, unknown>
    const { $schema, $id, ...rest } = schema
    void $schema
    void $id
    parameters = rest
  } catch {
    /* 保底空 schema；工具仍由 zod 校验 */
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters,
    },
  }
}

/**
 * provider 原生工具调用的 LangChain ChatModel。
 *
 * 输入：BaseMessage[]（system / human / 带 tool_calls 的 assistant / tool）；
 * 输出：AIMessage，tool_calls 为 { name, args, id }。
 * `ask` 收到 messages / tools / toolChoice，返回 toolCalls / finishReason / usage。
 *
 * 与 ZCodeChatModel 的区别：不再要求模型输出 JSON action，也不再压平历史；
 * 直接把 messages/tools 交给 /api/text，把 provider 的 tool_calls 还原成 AIMessage.tool_calls。
 * 两者共用 compactDraftHistory 与 LangGraph 的 tools 执行节点。
 */
export class NativeToolChatModel extends BaseChatModel {
  modelKey?: string
  ask: SceneCodeAsk
  tools: StructuredToolInterface[]
  callSequence: number
  onProgress?: (chars: number) => void
  onToolCallDelta?: (delta: ProviderToolCallDelta) => void
  maxTokens: number
  temperature: number

  constructor(params: NativeToolChatModelParams = {}) {
    super(params)
    this.modelKey = params.modelKey
    this.onProgress = params.onProgress
    this.onToolCallDelta = params.onToolCallDelta
    this.maxTokens = params.maxTokens ?? 12000
    this.temperature = params.temperature ?? 0.3
    this.ask =
      params.ask ||
      ((o) =>
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
        }))
    this.tools = params.tools || []
    this.callSequence = params.callSequence || 0
  }

  _llmType(): string {
    return 'native-tool-calling'
  }

  bindTools(tools: StructuredToolInterface[], kwargs?: Record<string, unknown>): this {
    void kwargs
    return new NativeToolChatModel({
      ...this,
      tools,
      callSequence: this.callSequence,
      ...(this.onProgress ? { onProgress: this.onProgress } : {}),
      ...(this.onToolCallDelta ? { onToolCallDelta: this.onToolCallDelta } : {}),
    }) as this
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: unknown,
  ): Promise<ChatResult> {
    void runManager
    const bodyMessages = toProviderMessages(messages)
    const tools = this.tools.map(toOpenAITool)
    const r = await this.ask({
      messages: bodyMessages,
      ...(tools.length ? { tools, toolChoice: 'auto' } : {}),
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      modelKey: this.modelKey,
      signal: options?.signal,
      ...(this.onProgress ? { onProgress: this.onProgress } : {}),
      ...(this.onToolCallDelta ? { onToolCallDelta: this.onToolCallDelta } : {}),
    })
    const finishReason = r.finishReason
    const rawCalls = Array.isArray(r.toolCalls) ? r.toolCalls : []
    if (rawCalls.length) {
      if (finishReason === 'length') {
        throw new Error('模型输出达到长度上限，工具参数可能不完整；请缩小单次输出或改用草稿分片后重试')
      }
      const seq = this.callSequence + 1
      this.callSequence = seq
      const content = String(r.text || '').trim()
      const toolCalls = rawCalls.map((call, index) => {
        const name = String(call.name || '').trim()
        if (!name) throw new Error('模型返回了没有名称的工具调用')
        let args: unknown
        const rawArgs = String(call.arguments ?? '').trim()
        try {
          args = rawArgs ? JSON.parse(rawArgs) : {}
        } catch {
          throw new Error(`模型返回的工具参数不是合法 JSON（${name}）；请重新生成，或缩小单次工具参数`)
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error(`模型返回的工具参数必须是 JSON 对象（${name}）`)
        }
        return {
          name,
          args: args as Record<string, unknown>,
          id: String(call.id || `call_${seq}_${index}`),
        }
      })
      return {
        generations: [
          {
            message: new AIMessage({ content, tool_calls: toolCalls }),
            text: content,
          },
        ],
      }
    }
    if (finishReason === 'length') {
      throw new Error('模型输出达到长度上限被截断；请缩小单次输出后重试')
    }
    const content = String(r.text || '').trim()
    return {
      generations: [{ message: new AIMessage({ content }), text: content }],
    }
  }
}
