/**
 * 3D agent 的可配置运行上限。
 * 设置里存秒；运行时再换算毫秒，避免 UI 出现 300000。
 */
export type AgentLimitSettings = {
  maxSteps?: number
  totalSeconds?: number
}

export type AgentRunLimits = {
  maxSteps: number
  totalSeconds: number
  totalMs: number
}

export const AGENT_LIMIT_DEFAULTS = {
  maxSteps: 24,
  totalSeconds: 300,
} as const

export const AGENT_LIMIT_RANGES = {
  maxSteps: { min: 12, max: 120 },
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
    maxSteps: normalizeInt(o.maxSteps, AGENT_LIMIT_DEFAULTS.maxSteps, AGENT_LIMIT_RANGES.maxSteps.min, AGENT_LIMIT_RANGES.maxSteps.max),
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
