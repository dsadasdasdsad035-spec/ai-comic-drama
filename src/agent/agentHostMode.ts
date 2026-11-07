export type AgentHostMode = 'restricted' | 'full_host'

export function normalizeAgentHostMode(value: unknown): AgentHostMode {
  return value === 'full_host' ? 'full_host' : 'restricted'
}

export function isFullHostMode(settings: { agentHostMode?: AgentHostMode } | null | undefined): boolean {
  return normalizeAgentHostMode(settings?.agentHostMode) === 'full_host'
}
