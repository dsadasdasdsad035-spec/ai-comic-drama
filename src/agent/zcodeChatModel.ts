import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatResult } from '@langchain/core/outputs'
import { z } from 'zod'
import { callTextStream } from '../api'
import type { SceneCodeAsk } from '../sceneCodeJob'
import { compactDraftHistory } from './agentHistory'
import { actionRetryHint, looksLikeActionPayload, parseActionJson } from './actionJson'

export type ZCodeChatModelParams = BaseChatModelParams & {
  modelKey?: string
  ask?: SceneCodeAsk
  tools?: StructuredToolInterface[]
  /** 只用于稳定生成工具 id；多轮会话可以递增 */
  callSequence?: number
  /** 流式进度回调；由图的 emit 注入 */
  onProgress?: (chars: number) => void
  /** 环节运行参数；缺省沿用 3D 代码的 12000/0.3 */
  maxTokens?: number
  temperature?: number
}

/**
 * 固定协议层：不属于技能，不可被用户编辑。
 * 技能正文由 SystemMessage 传入，这里只负责 JSON action 协议与工具使用纪律。
 */
export const AGENT_PROTOCOL_LINES = [
  '只通过提供的工具执行动作，不访问网络或文件系统。',
  '每次回复只输出 JSON：',
  '{"content":"给用户的简短说明","tool_calls":[{"name":"工具名","args":{}}]}',
  '只输出一个 JSON 对象：不要 Markdown 围栏，不要在 JSON 前后加说明，也不要在末尾追加多余的括号。',
  '需要工具时返回 tool_calls；完成时 content 说明结果，不要伪造工具结果。',
  '不要输出 chain-of-thought。工具参数必须符合 schema。',
  '大段产物只返回摘要和引用，不要把整份产物重复写进回复。',
  '长代码分多次 append_scene_draft，每次不超过 1500 字符；看到工具结果后再写下一段。',
  '代码正文只写进草稿工具（append/patch），不要在 content 或重复的 set_scene_code 里重写整份代码。',
] as const

function messageText(message: BaseMessage): string {
  const content = message.content as unknown
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text || '')
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(content ?? '')
}

function toolsPrompt(tools: StructuredToolInterface[]): string {
  if (!tools.length) return '本次没有可用工具。'
  return tools
    .map((tool, i) => {
      let schema: unknown = {}
      try {
        schema = z.toJSONSchema(tool.schema as never)
      } catch {
        schema = { type: 'object', additionalProperties: true }
      }
      return `${i + 1}. ${tool.name}\n用途：${tool.description || ''}\n参数 JSON Schema：${JSON.stringify(schema)}`
    })
    .join('\n\n')
}

export function historyPrompt(messages: BaseMessage[]): string {
  const compacted = compactDraftHistory(messages)
  return compacted
    // 技能 system 单独拼在 prompt 头部；只放行历史压缩生成的草稿摘要。
    .filter((m) => m.getType() !== 'system' || messageText(m).startsWith('[场景草稿]'))
    .map((m) => {
      const role = m.getType()
      const text = messageText(m)
      if (m instanceof ToolMessage) {
        return `[工具结果 tool_call_id=${m.tool_call_id}]\n${text}`
      }
      if (m instanceof AIMessage && m.tool_calls?.length) {
        return `[助手 tool_calls]\n${JSON.stringify(m.tool_calls.map((c) => ({ name: c.name, args: c.args, id: c.id })))}`
      }
      return `[${role}]\n${text}`
    })
    .join('\n\n')
}

function systemPrompt(messages: BaseMessage[]): string {
  return messages
    .filter((m) => m.getType() === 'system')
    .map(messageText)
    .filter(Boolean)
    .join('\n\n')
}

export function parseZCodeActionJson(raw: unknown): unknown {
  return parseActionJson(raw)
}

/**
 * 把现有 /api/text 的 JSON 模式包装成 LangChain ChatModel。
 * 这是 JSON action 协议，不是 provider native tool calling：
 * 模型返回 { content, tool_calls }，由 LangGraph ToolNode 执行。
 */
export class ZCodeChatModel extends BaseChatModel {
  modelKey?: string
  ask: SceneCodeAsk
  tools: StructuredToolInterface[]
  callSequence: number
  onProgress?: (chars: number) => void
  maxTokens: number
  temperature: number

  constructor(params: ZCodeChatModelParams = {}) {
    super(params)
    this.modelKey = params.modelKey
    this.onProgress = params.onProgress
    this.maxTokens = params.maxTokens ?? 12000
    this.temperature = params.temperature ?? 0.3
    this.ask =
      params.ask ||
      ((o) =>
        callTextStream({
          system: o.system,
          prompt: o.prompt,
          json: o.json,
          maxTokens: o.maxTokens,
          temperature: o.temperature,
          modelKey: o.modelKey,
          signal: o.signal,
          ...(o.onProgress ? { onProgress: o.onProgress } : {}),
        }))
    this.tools = params.tools || []
    this.callSequence = params.callSequence || 0
  }

  _llmType(): string {
    return 'zcode-json-tools'
  }

  bindTools(tools: StructuredToolInterface[], kwargs?: Record<string, unknown>): this {
    void kwargs
    return new ZCodeChatModel({
      ...this,
      tools,
      callSequence: this.callSequence,
      ...(this.onProgress ? { onProgress: this.onProgress } : {}),
    }) as this
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: unknown,
  ): Promise<ChatResult> {
    void runManager
    const skillSystem = systemPrompt(messages)
    const baseSystem = [
      ...(skillSystem ? [skillSystem] : []),
      ...AGENT_PROTOCOL_LINES,
      '',
      '可用工具：',
      toolsPrompt(this.tools),
    ].join('\n')
    const prompt = historyPrompt(messages)
    // 模型偶尔会把 {content, tool_calls} 写成坏 JSON（末尾多括号 / 截断）。
    // 解析不回来时先自行纠一次，避免把原始 JSON 当成回答展示、也避免“伪造已提交”。
    const maxAttempts = 3
    let lastRaw = ''
    let lastFinish: string | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const system = attempt === 1 ? baseSystem : `${baseSystem}\n\n${actionRetryHint(lastRaw, lastFinish)}`
      const r = await this.ask({
        system,
        prompt,
        json: true,
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        modelKey: this.modelKey,
        signal: options?.signal,
        ...(this.onProgress ? { onProgress: this.onProgress } : {}),
      })
      lastFinish = r.finishReason
      const rawText = String(r.text ?? '')
      const parsed = parseActionJson(r.json ?? r.text) as
        | { content?: unknown; tool_calls?: unknown }
        | undefined
      if (!parsed && looksLikeActionPayload(rawText)) {
        lastRaw = rawText
        if (attempt < maxAttempts) continue
        throw new Error(
          `模型连续 ${maxAttempts} 次没有返回合法的工具调用 JSON` +
            (lastFinish === 'length' ? '（输出达到长度上限被截断）' : '') +
            '；请缩短单次输出或更换文本模型后重试',
        )
      }
      const content = String(parsed?.content ?? rawText ?? '').trim()
      const rawCalls = Array.isArray(parsed?.tool_calls) ? parsed.tool_calls : []
      const seq = this.callSequence + 1
      this.callSequence = seq
      const toolCalls = rawCalls
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        .map((call, i) => {
          const name = String(call.name || '')
          const args = call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : {}
          return { name, args, id: `call_${seq}_${i}` }
        })
        .filter((c) => c.name)
      const message = new AIMessage({
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      return {
        generations: [{ message, text: content }],
      }
    }
    throw new Error('模型没有返回可用的回复')
  }
}
