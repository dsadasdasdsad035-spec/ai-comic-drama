/** server/db.mjs 的类型声明（node:sqlite 数据层，路由与设置共用） */
export declare function safeProjectName(name: unknown): string
export declare function resolveRoot(appRoot: string): string
export declare function dbPath(root: string): string
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
export declare function mergeShots(existing: any[] | undefined, incoming: any[]): any[]
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
