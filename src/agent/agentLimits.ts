/**
 * 3D agent 的可配置运行上限。
 * 只开放总运行时长；图节点/步骤不暴露为产品设置。
 */
export type AgentLimitSettings = {
  totalSeconds?: number
}

export type AgentRunLimits = {
  totalSeconds: number
  totalMs: number
}

export const AGENT_LIMIT_DEFAULTS = {
  totalSeconds: 300,
} as const

export const AGENT_LIMIT_RANGES = {
  totalSeconds: { min: 60, max: 1800 },
} as const

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === '' || value == null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeAgentLimits(raw: unknown): Required<AgentLimitSettings> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    totalSeconds: normalizeInt(
      o.totalSeconds,
      AGENT_LIMIT_DEFAULTS.totalSeconds,
      AGENT_LIMIT_RANGES.totalSeconds.min,
      AGENT_LIMIT_RANGES.totalSeconds.max,
    ),
  }
}

export function resolveAgentLimits(settings: { agentLimits?: AgentLimitSettings } | null | undefined): AgentRunLimits {
  const n = normalizeAgentLimits(settings?.agentLimits)
  return { ...n, totalMs: n.totalSeconds * 1000 }
}
