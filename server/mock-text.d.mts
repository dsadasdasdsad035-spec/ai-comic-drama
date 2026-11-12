/** server/mock-text.mjs 的类型声明：测试用文本模型替身 */

export function isMockTextProvider(provider: unknown, entry?: unknown): boolean

export function mockAssistantReply(input: {
  messages?: unknown[]
  prompt?: string
  toolMode?: boolean
}): string

export function explainTextFetchError(err: unknown, provider?: unknown, baseUrl?: string): string
