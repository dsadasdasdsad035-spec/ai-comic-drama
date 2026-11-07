async function postJson<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const j = (await r.json()) as { ok?: boolean; message?: string } & T
  if (!j.ok) throw new Error(j.message || '请求失败')
  return j
}

export async function ensureAgentJob(
  project: string,
  shotId: string,
  signal?: AbortSignal,
): Promise<{ jobId: string }> {
  const j = await postJson<{ jobId: string }>(
    '/api/agent/ensure',
    { project, shotId },
    signal,
  )
  return { jobId: j.jobId }
}

export async function agentRunBash(
  jobId: string,
  command: string,
  cwd = '.',
  timeoutMs = 30_000,
  signal?: AbortSignal,
) {
  return postJson<{ exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut?: boolean }>(
    '/api/agent/shell',
    { jobId, command, cwd, timeout_ms: timeoutMs },
    signal,
  )
}

export async function agentReadFile(jobId: string, filePath: string, signal?: AbortSignal) {
  const j = await postJson<{ content: string }>('/api/agent/read', { jobId, path: filePath }, signal)
  return j.content
}

export async function agentWriteFile(
  jobId: string,
  filePath: string,
  content: string,
  signal?: AbortSignal,
) {
  await postJson<{ bytes: number }>('/api/agent/write', { jobId, path: filePath, content }, signal)
}

export async function agentListDir(jobId: string, dirPath = '.', signal?: AbortSignal) {
  const j = await postJson<{ entries: string[] }>('/api/agent/list', { jobId, path: dirPath }, signal)
  return j.entries
}

export async function cancelAgentJob(jobId: string) {
  await postJson('/api/agent/cancel', { jobId })
}
