/** server/knowledge.mjs 的类型声明（知识库伴生服务客户端与纯函数） */

export declare const DEFAULT_KB_BASE_URL: string
export declare const MAX_KB_UPLOAD_BYTES: number
export declare const KB_SESSION_PREFIX: string

export declare function kbBaseCandidates(base: string): string[]
export declare function isLoopbackBase(base: string): boolean
export declare function validateKbBaseUrl(base: string): string
export declare function kbSessionId(workspaceSlug: string): string
export declare function isUsableSlug(slug: string): boolean
export declare function translateKbError(
  err: unknown,
  opts?: { hasConfig?: boolean },
): string
export declare function buildUploadForm(input: {
  filename: string
  bytes: Buffer | Uint8Array
  mime?: string
  workspaceSlug?: string
}): { form: FormData; filename: string }
export declare function normalizeWorkspace(raw: unknown): {
  slug: string
  name: string
  docCount: number
  documents: unknown[]
}
export declare function normalizeUploadedDocs(
  raw: unknown,
  fallbackName?: string,
): { location: string; title: string; wordCount: number }[]
export declare function assertDocLocations(list: unknown): string[]
export declare function parseSseDataLine(line: string): Record<string, unknown> | null
export declare function normalizeSources(
  raw: unknown,
): { title: string; text: string; score: number }[]
export declare function readKbLink(db: unknown, projectName: string): string
export declare function writeKbLink(db: unknown, projectName: string, workspaceSlug: string): string
export declare function deleteKbLink(db: unknown, projectName: string): number

export interface KbDoc {
  location: string
  title: string
  wordCount: number
}

export interface KbWorkspaceDetail {
  slug: string
  name: string
  docCount: number
  documents: KbDoc[]
}

export interface KbSearchHit {
  text: string
  title: string
  score: number
  location: string
}

export interface KbChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
  sentAt: number
  sources: { title: string; text: string; score: number }[]
}

export interface KnowledgeClient {
  config(): { baseUrl: string; apiKey: string; enabled: boolean }
  test(): Promise<{
    ok: boolean
    baseUrl: string
    authenticated: boolean
    workspaceCount: number
  }>
  ensureWorkspace(projectName: string, db?: unknown): Promise<string>
  workspaceDetail(slug: string): Promise<KbWorkspaceDetail>
  listDocs(slug: string): Promise<KbWorkspaceDetail>
  uploadDoc(input: {
    slug: string
    filename: string
    bytes: Buffer | Uint8Array
    mime?: string
  }): Promise<KbDoc[]>
  removeDocs(slug: string, locations: unknown): Promise<{ removed: number }>
  purgeDocs(locations: unknown): Promise<{ purged: number }>
  chatStream(input: {
    slug: string
    message?: string
    reset?: boolean
    mode?: string
  }): Promise<Response>
  chat(input: {
    slug: string
    message?: string
    reset?: boolean
    mode?: string
  }): Promise<{ text: string; sources: { title: string; text: string; score: number }[] }>
  history(
    slug: string,
    opts?: { sessionId?: string; limit?: number; orderBy?: 'asc' | 'desc' },
  ): Promise<KbChatHistoryItem[]>
  search(
    slug: string,
    query: string,
    opts?: { topN?: number; scoreThreshold?: number },
  ): Promise<KbSearchHit[]>
  readDoc(docName: string): Promise<{ title: string; text: string; wordCount: number }>
  acceptedTypes(): Promise<{ types: Record<string, string[]>; extensions: string[] }>
  deleteWorkspace(slug: string): Promise<{ deleted: boolean; reason?: string }>
  applyLlmConfig(input: {
    basePath: string
    model: string
    apiKey: string
    tokenLimit?: number
  }): Promise<{ ok: boolean; error?: string; written?: string[] }>
}

export declare function createKnowledgeClient(deps: {
  getSettings: () => { baseUrl: string; apiKey: string; enabled: boolean }
  getExternalFetch?: () => ((url: string, init?: unknown) => Promise<Response>) | null
  timeoutMs?: number
  log?: (line: string) => void
}): KnowledgeClient

export declare function setKnowledgeFetcher(
  fn?: ((url: string, init?: unknown) => Promise<Response>) | null,
): void
