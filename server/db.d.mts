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
}[]
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
export declare function getSetting(key: string): any
export declare function setSetting(key: string, value: unknown): void
