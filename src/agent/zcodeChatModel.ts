import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatResult } from '@langchain/core/outputs'
import { z } from 'zod'
import { callText } from '../api'
import type { SceneCodeAsk } from '../sceneCodeJob'

export type ZCodeChatModelParams = BaseChatModelParams & {
  modelKey?: string
  ask?: SceneCodeAsk
  tools?: StructuredToolInterface[]
  /** 只用于稳定生成工具 id；多轮会话可以递增 */
  callSequence?: number
}

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

function historyPrompt(messages: BaseMessage[]): string {
  return messages
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

function escapeControlCharsInJsonStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString && ch === '\n') {
      out += '\\n'
    } else if (inString && ch === '\r') {
      out += '\\r'
    } else if (inString && ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }
  return out
}

function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name !== 'set_scene_code' || typeof args.code !== 'string') return args
  let code = args.code
  // 少数模型把已经转义过的换行再次转义，代码会变成一行字面量 \n；只在没有真实换行时还原。
  if (!code.includes('\n') && code.includes('\\n')) {
    code = code.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  return { ...args, code }
}

export function parseZCodeActionJson(raw: unknown): unknown {
  return parseJson(raw)
}

function parseJson(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw || '').trim()
  if (!text) return undefined
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  try {
    return JSON.parse(body)
  } catch {
    // 多数 provider 的 JSON mode 会正确转义；少数模型会把代码里的换行原样塞进字符串。
    try {
      return JSON.parse(escapeControlCharsInJsonStrings(body))
    } catch {
      /* 继续尝试截取首个 {...} */
    }
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const sliced = body.slice(start, end + 1)
      try {
        return JSON.parse(sliced)
      } catch {
        try {
          return JSON.parse(escapeControlCharsInJsonStrings(sliced))
        } catch {
          return undefined
        }
      }
    }
    return undefined
  }
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

  constructor(params: ZCodeChatModelParams = {}) {
    super(params)
    this.modelKey = params.modelKey
    this.ask =
      params.ask ||
      ((o) =>
        callText({
          system: o.system,
          prompt: o.prompt,
          json: o.json,
          maxTokens: o.maxTokens,
          temperature: o.temperature,
          modelKey: o.modelKey,
          signal: o.signal,
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
    }) as this
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: unknown,
  ): Promise<ChatResult> {
    void runManager
    const system = [
      '你是 3D 场景 agent。只通过提供的工具执行动作，不访问网络或文件系统。',
      '每次回复只输出 JSON：',
      '{"content":"给用户的简短说明","tool_calls":[{"name":"工具名","args":{}}]}',
      '需要工具时返回 tool_calls；完成时 content 说明结果，不要伪造工具结果。',
      '不要输出 chain-of-thought。工具参数必须符合 schema。',
      'set_scene_code 的 code 必须是一个合法 JSON 字符串：代码里的换行写成 \\n，双引号要转义。',
      '代码保持精简，优先完整可运行；单次代码建议不超过 180 行。',
      '',
      '可用工具：',
      toolsPrompt(this.tools),
    ].join('\n')
    const prompt = historyPrompt(messages)
    const r = await this.ask({
      system,
      prompt,
      json: true,
      maxTokens: 12000,
      temperature: 0.3,
      modelKey: this.modelKey,
      signal: options?.signal,
    })
    const parsed = parseJson(r.json ?? r.text) as
      | { content?: unknown; tool_calls?: unknown }
      | undefined
    const content = String(parsed?.content ?? r.text ?? '').trim()
    const rawCalls = Array.isArray(parsed?.tool_calls) ? parsed.tool_calls : []
    const seq = this.callSequence + 1
    this.callSequence = seq
    const toolCalls = rawCalls
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
      .map((call, i) => {
        const name = String(call.name || '')
        const args = call.args && typeof call.args === 'object' ? normalizeToolArgs(name, call.args as Record<string, unknown>) : {}
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
}
