export type DraftScope = { project: string; shotId: string }

export type DraftState = {
  id: string
  project: string
  shotId: string
  lines: number
  chars: number
}

export type DraftRead = DraftState & {
  text: string
  totalLines: number
  startLine: number
  endLine: number
}

export type DraftCommit = DraftState & { code: string }

export type SceneDraftClient = {
  begin(scope: DraftScope): Promise<DraftState>
  append(id: string, chunk: string): Promise<DraftState>
  read(id: string, startLine?: number, endLine?: number): Promise<DraftRead>
  patch(id: string, startLine: number, endLine: number, text: string): Promise<DraftState>
  commit(id: string): Promise<DraftCommit>
  discard(id: string): Promise<void>
  text(id: string): Promise<string>
}

async function request<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const method = body ? 'POST' : 'GET'
  const res = await fetch(body ? `/api/scene-draft/${action}` : `/api/scene-draft?${action}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* 非 JSON 错误按 HTTP 状态处理 */
  }
  if (!res.ok || data.ok === false) {
    throw new Error(String(data.message || `草稿操作失败（HTTP ${res.status}）`))
  }
  return data as T
}

export const sceneDraftClient: SceneDraftClient = {
  async begin(scope) {
    const data = await request<{ draft: DraftState }>('begin', {
      project: scope.project,
      shotId: scope.shotId,
    })
    return data.draft
  },
  async append(id, chunk) {
    const data = await request<{ draft: DraftState }>('append', { id, chunk })
    return data.draft
  },
  async read(id, startLine, endLine) {
    return request<DraftRead>('read', {
      id,
      ...(startLine != null ? { startLine } : {}),
      ...(endLine != null ? { endLine } : {}),
    })
  },
  async patch(id, startLine, endLine, text) {
    const data = await request<{ draft: DraftState }>('patch', { id, startLine, endLine, text })
    return data.draft
  },
  commit(id) {
    return request<DraftCommit>('commit', { id })
  },
  async discard(id) {
    await request('discard', { id })
  },
  async text(id) {
    const data = await request<{ draft: string }>(`id=${encodeURIComponent(id)}`)
    return data.draft
  },
}
