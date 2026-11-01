/**
 * 原生工具调用的模型能力表。
 *
 * 只收录用真实 Key 验证过 tool_calls 的模型；未列出的模型不拦截聊天，
 * 表内条目用于 thinking 策略等运行时提示。
 *
 * 判定以「模型」为键，渠道只作审计信息：同一模型换渠道提供时协议能力不变。
 * （历史实现以「渠道 + 模型」为键，导致同一模型换渠道后判定翻转。）
 *
 * 服务端与客户端共用这张表：服务端用它决定 thinking 策略并拒绝不支持的请求。
 */
export type ToolProtocol = 'auto' | 'native' | 'json'
export type ToolThinking = 'disable' | 'omit'

export type ToolCapability = {
  /** 模型标识；能力判定以此为准 */
  model: string
  nativeTools: boolean
  thinking: ToolThinking
  /** 最近一次真实验证的时间 */
  verifiedAt: string
  /** 首次验证时的渠道，仅作审计；判定不使用 */
  verifiedVia?: string
  note?: string
}

export const TOOL_CAPABILITIES: readonly ToolCapability[] = [
  {
    model: 'MiniMax-M3',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'minimax',
    note: '非流式与流式 delta.tool_calls 已验证；关闭 thinking 后 reasoning_tokens=0',
  },
  {
    model: 'doubao-seed-2-1-lite-260915',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
    note: '关闭 thinking 后 reasoning_tokens=0；不关会吃掉输出预算',
  },
  {
    model: 'doubao-seed-2-1-pro-260915',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
  },
  {
    model: 'doubao-seed-evolving',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
  },
  {
    model: 'deepseek-v4-flash',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
  },
  {
    model: 'deepseek-v4-pro',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
  },
  {
    model: 'kimi-k3',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
    note: '响应较慢；深层嵌套 schema 下必须收紧 required 才会填满字段',
  },
  {
    model: 'glm-5.3',
    nativeTools: true,
    thinking: 'disable',
    verifiedAt: '2026-10-29',
    verifiedVia: 'ark-plan',
  },
]

const norm = (v: unknown) => String(v ?? '').trim()

export function normalizeToolProtocol(v: unknown): ToolProtocol {
  return v === 'native' || v === 'json' ? v : 'auto'
}

/** 只按模型查表；providerId 保留在签名里供调用方传审计信息，不参与判定。 */
export function findToolCapability(
  _providerId: string | undefined,
  model: string | undefined,
): ToolCapability | undefined {
  const m = norm(model)
  if (!m) return undefined
  return TOOL_CAPABILITIES.find((c) => c.model === m)
}

export function supportsNativeTools(providerId: string | undefined, model: string | undefined): boolean {
  return Boolean(findToolCapability(providerId, model)?.nativeTools)
}

export function toolThinkingMode(providerId: string | undefined, model: string | undefined): ToolThinking {
  return findToolCapability(providerId, model)?.thinking ?? 'omit'
}

/** 聊天可用的模型清单；错误信息里用它告诉用户能换什么。 */
export function nativeToolModels(): string[] {
  return TOOL_CAPABILITIES.filter((c) => c.nativeTools).map((c) => c.model)
}

export type ToolProtocolResolution = {
  protocol: 'native' | 'json'
  reason: 'forced-json' | 'forced-native' | 'auto-native' | 'auto-json'
  /** 显式要求 native 但模型未声明支持时的可读错误 */
  error?: string
}

/**
 * auto：支持就用 native，否则 json；显式 native 遇到不支持模型时返回错误而不是静默回退。
 *
 * 注意：`json` 协议已从产品中移除，保留该分支只为兼容仍可复用的纯函数调用方；
 * 聊天运行时只接受 `native`。
 */
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
          error: `当前模型「${providerId || '未知渠道'} / ${model || '未配置'}」未声明支持原生工具调用；请换用能力表内的模型`,
        }
  }
  return supported
    ? { protocol: 'native', reason: 'auto-native' }
    : { protocol: 'json', reason: 'auto-json' }
}

/** 已移除能力表拦截；保留空实现供旧调用方。 */
export function requireNativeTools(_providerId: string | undefined, _model: string | undefined): void {}
