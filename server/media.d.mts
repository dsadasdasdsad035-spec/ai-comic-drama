/** server/media.mjs 的类型声明（项目媒体目录 / URL / 迁移 / 参考图解析） */
export interface ProjectMediaRef {
  name: string
  file: string
}

export interface ProjectMediaFile {
  name: string
  url: string
  size: number
  mtime: number
}

export interface SavedMedia {
  file: string
  url: string
}

export interface MigrationResult {
  characters: any[]
  designs: any[]
  migrated: number
  missing: string[]
  changed: boolean
}

export declare const MAX_REF_BYTES: number

export declare function projectMediaDir(appRoot: string, name: string): string
export declare function projectMediaUrl(name: string, file: string): string
export declare function safeMediaFile(file: unknown): string | null
export declare function parseProjectMediaUrl(ref: unknown): ProjectMediaRef | null
export declare function isProjectMediaUrl(ref: unknown): boolean
export declare function resolveProjectMediaPath(appRoot: string, name: string, file: string): string
export declare function projectMediaExists(appRoot: string, name: string, file: string): boolean
export declare function saveProjectImage(
  appRoot: string,
  name: string,
  bytes: Buffer | Uint8Array,
  ext?: string,
  prefix?: string,
): SavedMedia
export declare function saveProjectMedia(
  appRoot: string,
  name: string,
  bytes: Buffer | Uint8Array,
  options?: { ext?: string; prefix?: string; file?: string },
): SavedMedia
export declare function saveProjectMediaStream(
  appRoot: string,
  name: string,
  stream: ReadableStream<Uint8Array>,
  options?: { ext?: string; prefix?: string; file?: string; maxBytes?: number },
): Promise<SavedMedia & { bytes: number }>
export declare function copyIntoProjectMedia(
  appRoot: string,
  name: string,
  sourceFile: string,
  file?: string,
): SavedMedia
export declare function listProjectImages(
  appRoot: string,
  name: string,
  limit?: number,
): ProjectMediaFile[]
export declare function migrateProjectMedia(
  appRoot: string,
  name: string,
  project: Record<string, any>,
): MigrationResult
export declare function resolveRef(ref: string, appRoot: string): string
