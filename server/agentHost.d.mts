export function ensureAgentJob(
  root: string,
  body: { project: string; shotId: string },
): { ok: boolean; jobId: string; dir: string }

export function agentShell(
  root: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>>

export function agentReadFile(root: string, body: Record<string, unknown>): Record<string, unknown>

export function agentWriteFile(root: string, body: Record<string, unknown>): Record<string, unknown>

export function agentListDir(root: string, body: Record<string, unknown>): Record<string, unknown>

export function cancelAgentJob(jobId: string): { ok: boolean; jobId: string }
