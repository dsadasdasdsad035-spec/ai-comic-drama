/** 出片超时后，凭上游 task_id 重新拉取成片 */
export type VideoUpstreamRecover = {
  upstreamTaskId: string
  providerKind: 'apimart' | 'ark'
  modelKey?: string
  savedAt: string
}

export function parseUpstreamTaskIdFromError(message: string): string | null {
  const text = String(message || '')
  const m1 = text.match(/(?:APIMart task_id|上游 task_id)[：:]\s*(task_\S+)/i)
  if (m1) return m1[1]
  const m2 = text.match(/任务\s+(task_\S+)\s+超时/)
  if (m2) return m2[1]
  const m3 = text.match(/\b(task_[A-Za-z0-9]+)\b/)
  return m3 ? m3[1] : null
}

export function resolveVideoUpstreamRecover(
  error: unknown,
  modelKey: string,
  providerKind?: string,
): VideoUpstreamRecover | undefined {
  const upstreamTaskId =
    String((error as { upstreamTaskId?: string })?.upstreamTaskId || '').trim() ||
    parseUpstreamTaskIdFromError((error as Error)?.message || '')
  if (!upstreamTaskId) return undefined
  const kind: VideoUpstreamRecover['providerKind'] =
    providerKind === 'ark' ? 'ark' : 'apimart'
  return {
    upstreamTaskId,
    providerKind: kind,
    modelKey: modelKey || undefined,
    savedAt: new Date().toISOString(),
  }
}
