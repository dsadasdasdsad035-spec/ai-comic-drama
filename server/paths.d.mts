/** server/paths.mjs 的类型声明 */

export const MEDIA_DIRS: string[]

export function resolveMediaRoot(appRoot?: string): string

export function resolveStaticRoot(appRoot?: string): string

export function mediaPath(appRoot: string | undefined, ...segments: string[]): string

export function ensureMediaDir(appRoot: string | undefined, ...segments: string[]): string

export function mediaPathFromUrl(appRoot: string | undefined, url: string): string

export function resolveStateRoot(appRoot?: string): string

export function statePath(appRoot: string | undefined, ...segments: string[]): string

export function ensureStateDir(appRoot: string | undefined, ...segments: string[]): string
