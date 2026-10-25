export declare const MAX_TOOL_MESSAGES: number
export declare const MAX_TOOLS: number

export type ProviderToolCall = { id: string; name: string; arguments: string }
export type ProviderChatMessage = {
  role: string
  content: string
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}
export type ProviderToolSchema = {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export declare function normalizeChatMessages(raw: unknown): ProviderChatMessage[]
export declare function normalizeToolCalls(raw: unknown, prefix?: string): ProviderToolCall[]
export declare function normalizeToolSchemas(raw: unknown): ProviderToolSchema[]
export declare function toolRequestError(input: {
  tools: unknown
  providerId?: string
  model?: string
  supported: boolean
}): string
