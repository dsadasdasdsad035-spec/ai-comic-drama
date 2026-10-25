/**
 * 原生工具调用的模型能力表。
 *
 * 只收录用真实 Key 验证过 tool_calls 的渠道/模型；未列出的模型默认不支持，
 * `auto` 会回退到 JSON action，显式 `native` 会给出可读错误。
 * 服务端与客户端共用这张表：服务端用它决定 thinking 策略并拒绝不支持的 native 请求。
 */
export type ToolProtocol = 'auto' | 'native' | 'json'
export type ToolThinking = 'disable' | 'omit'

export type ToolCapability = {
  providerId: string
  model: string
  nativeTools: boolean
  thinking: ToolThinking
  verifiedAt: string
  note?: string
}

export const TOOL_CAPABILITIES: readonly ToolCapability[] = [
  {
    providerId: 'minimax',
    model: 'MiniMax-M3',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-24',
    note: '非流式与流式 delta.tool_calls 已验证；关闭 thinking 后 reasoning_tokens=0',
  },
  {
    providerId: 'ark-plan',
    model: 'doubao-seed-2-1-lite-260915',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-24',
    note: '关闭 thinking 后 reasoning_tokens=0；不关会吃掉输出预算',
  },
  {
    providerId: 'ark-plan',
    model: 'deepseek-v4-flash',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-24',
  },
  {
    providerId: 'ark-plan',
    model: 'kimi-k3',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-24',
    note: '响应较慢，能力表只声明协议支持',
  },
]

const norm = (v: unknown) => String(v ?? '').trim()

export function normalizeToolProtocol(v: unknown): ToolProtocol {
  return v === 'native' || v === 'json' ? v : 'auto'
}

export function findToolCapability(
  providerId: string | undefined,
  model: string | undefined,
): ToolCapability | undefined {
  const p = norm(providerId)
  const m = norm(model)
  if (!p || !m) return undefined
  return TOOL_CAPABILITIES.find((c) => c.providerId === p && c.model === m)
}

export function supportsNativeTools(providerId: string | undefined, model: string | undefined): boolean {
  return Boolean(findToolCapability(providerId, model)?.nativeTools)
}

export function toolThinkingMode(providerId: string | undefined, model: string | undefined): ToolThinking {
  return findToolCapability(providerId, model)?.thinking ?? 'omit'
}

export type ToolProtocolResolution = {
  protocol: 'native' | 'json'
  reason: 'forced-json' | 'forced-native' | 'auto-native' | 'auto-json'
  /** 显式要求 native 但模型未声明支持时的可读错误 */
  error?: string
}

/** auto：支持就用 native，否则 JSON；显式 native 遇到不支持模型时返回错误而不是静默回退。 */
export function resolveToolProtocol(
  requested: ToolProtocol | undefined,
  providerId: string | undefined,
  model: string | undefined,
): ToolProtocolResolution {
  const supported = supportsNativeTools(providerId, model)
  if (requested === 'json') return { protocol: 'json', reason: 'forced-json' }
  if (requested === 'native') {
    return supported
      ? { protocol: 'native', reason: 'forced-native' }
      : {
          protocol: 'json',
          reason: 'forced-native',
          error: `当前模型「${providerId || '未知渠道'} / ${model || '未配置'}」未声明支持原生工具调用；请换模型，或把工具协议切回 auto/json`,
        }
  }
  return supported
    ? { protocol: 'native', reason: 'auto-native' }
    : { protocol: 'json', reason: 'auto-json' }
}
