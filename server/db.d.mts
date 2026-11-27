/** server/db.mjs 的类型声明（node:sqlite 数据层，路由与设置共用） */
export declare function safeProjectName(name: unknown): string
export declare function resolveRoot(appRoot: string): string
export declare function dbPath(root: string): string
/** 独立连接：给成片/发布/知识库等需要自己控制生命周期的地方用，不参与 open() 的单例切换 */
export declare function openDatabase(root: string): {
  prepare(sql: string): {
    get(...args: unknown[]): Record<string, unknown> | undefined
    all(...args: unknown[]): Record<string, unknown>[]
    run(...args: unknown[]): { changes: number | bigint }
  }
  exec(sql: string): void
  close(): void
}
export declare function listProjects(root: string): {
  name: string
  title: string
  style: string
  aspect: string
  episodes: number
  shots: number
  seconds: number
  updated_at?: string
  /** 第一张非空首帧，供大厅卡片封面 */
  cover?: string
  /** 任一 JSON 列损坏：大厅显示「损坏」并禁用入口 */
  broken?: boolean
  /** 缺首帧 / 缺锚点 / 空项目；健康计算失败时不返回 */
  health?: { empty: boolean; missing_keyframe: number; missing_anchor: number }
}[]
export declare function invalidateProjectHealth(): void
export declare function readProject(root: string, name: string): Record<string, any>
export declare function writeProject(
  root: string,
  name: string,
  data: Record<string, any>,
): Record<string, any>
export declare function createProject(
  root: string,
  name: string,
  init?: Record<string, any>,
): { name: string; created: boolean }
export declare function mergeShots(existing: any[] | undefined, incoming: any[], mode?: 'partial' | 'full'): any[]
export declare const SHOTS_MODES: string[]
export declare function normalizeShotsMode(mode?: unknown): 'partial' | 'full'
export declare function deleteShots(existing: any[] | undefined, ids: string[]): { shots: any[]; removed: number }
export declare function pruneDanglingTransitions(shots: any[]): { shots: any[]; cleared: number }
export declare function findDuplicateShotNos(shots: any[]): { episode: number; no: string; ids: string[] }[]
export declare function getSetting(key: string): any
export declare function setSetting(key: string, value: unknown): void
export declare function listSkillOverrides(): Record<
  string,
  { body: string; baseVersion: number; updatedAt: string }
>
export declare function getSkillOverride(
  id: string,
): { body: string; baseVersion: number; updatedAt: string } | undefined
export declare function setSkillOverride(id: string, body: string, baseVersion?: number): void
export declare function deleteSkillOverride(id: string): void
export declare function listSkillInstalls(): Array<{
  id: string
  provider: string
  slug: string
  namespace: string
  version: string
  text: string
  meta: Record<string, unknown>
  installedAt: string
}>
export declare function getSkillInstall(id: string):
  | {
      id: string
      provider: string
      slug: string
      namespace: string
      version: string
      text: string
      meta: Record<string, unknown>
      installedAt: string
    }
  | undefined
export declare function getSkillInstallBySource(namespace: string, slug: string): ReturnType<typeof getSkillInstall>
export declare function upsertSkillInstall(record: {
  id: string
  provider?: string
  slug?: string
  namespace?: string
  version?: string
  text: string
  meta?: Record<string, unknown>
  installedAt?: string
}): ReturnType<typeof getSkillInstall>
export declare function deleteSkillInstall(id: string): void
export declare type ChatThreadKey = {
  project: string
  surface: string
  episode?: number
  shotId?: string
}
export declare function getChatThread(key: ChatThreadKey):
  | {
      project: string
      surface: string
      episode: number
      shotId: string
      messages: unknown[]
      activeSkills: unknown[]
      updatedAt: string
    }
  | undefined
export declare function saveChatThread(
  key: ChatThreadKey,
  messages: unknown[],
  activeSkills?: unknown[],
): ReturnType<typeof getChatThread>
export declare function deleteChatThread(key: ChatThreadKey): void

/* ---------------------------------------------------------------- 知识库 */

export declare type KnowledgeBase = {
  id: string
  name: string
  upstreamSlug: string
  createdAt: string
}

export declare const KNOWLEDGE_LINKS_MIGRATED_KEY: string

/** 把旧的 knowledge_links 迁成独立知识库（幂等，由 settings 标记键把关） */
export declare function migrateKnowledgeLinks(d: unknown): {
  migrated: number
  skipped: number
  snapshot: string
}

export declare function newKnowledgeBaseId(): string
export declare function listKnowledgeBases(d: unknown): KnowledgeBase[]
export declare function getKnowledgeBase(d: unknown, id: string): KnowledgeBase | null
export declare function getKnowledgeBaseByName(d: unknown, name: string): KnowledgeBase | null
export declare function createKnowledgeBase(
  d: unknown,
  input: { name: string; upstreamSlug: string; id?: string },
): KnowledgeBase
export declare function renameKnowledgeBase(d: unknown, id: string, name: string): KnowledgeBase
export declare function deleteKnowledgeBase(
  d: unknown,
  id: string,
): { deleted: boolean; base: KnowledgeBase | null; sessionsCleared: number }
export declare function setSessionKnowledgeBase(
  d: unknown,
  sessionId: string,
  kbId: string,
): { sessionId: string; kbId: string }
/** 选了但库已被删：`base` 为 null，调用方据此区分「未选」与「选过但没了」 */
export declare function getSessionKnowledgeSelection(
  d: unknown,
  sessionId: string,
): { sessionId: string; kbId: string; base: KnowledgeBase | null } | null
export declare function getSessionKnowledgeBase(
  d: unknown,
  sessionId: string,
): { sessionId: string; kbId: string; base: KnowledgeBase } | null
export declare function clearSessionKnowledgeBase(d: unknown, sessionId: string): number
export declare function pruneKnowledgeSessions(d: unknown, liveSessionIds: string[]): number

export declare type StockImportRecord = {
  provider: string
  itemId: string
  url: string
  mediaType: string
  title: string
  author: string
  authorUrl: string
  sourceUrl: string
  license: string
  licenseUrl: string
  attribution: string
  width?: number
  height?: number
  duration?: number
  bytes?: number
  createdAt: string
}
export declare function upsertStockImport(
  root: string,
  project: string,
  entry: Partial<StockImportRecord> & { provider: string; itemId: string },
): StockImportRecord | undefined
export declare function getStockImportByItem(
  root: string,
  project: string,
  provider: string,
  itemId: string,
): StockImportRecord | undefined
export declare function findStockImportByUrl(
  root: string,
  project: string,
  url: string,
): StockImportRecord | undefined
export declare function listStockImports(
  root: string,
  project: string,
  limit?: number,
): StockImportRecord[]
