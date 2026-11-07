export type AgentHostMode = 'restricted' | 'full_host'

export function normalizeAgentHostMode(value: unknown): AgentHostMode {
  if (value === 'restricted') return 'restricted'
  return 'full_host'
}

export function isFullHostMode(settings: { agentHostMode?: AgentHostMode } | null | undefined): boolean {
  return normalizeAgentHostMode(settings?.agentHostMode) === 'full_host'
}
