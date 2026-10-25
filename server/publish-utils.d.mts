/** server/publish-utils.mjs 的类型声明（环境探测、错误脱敏、路径白名单） */

export declare const ALLOWED_URL_PREFIXES: string[]
export declare function resolveChrome(): string
export declare function chromeAvailable(): boolean
export declare function sanitizeError(input: unknown): string
export declare function resolvePublishFile(appRoot: string, url: string): { path: string; url: string }
export declare function profilesRoot(appRoot: string): string
export declare function packagesRoot(appRoot: string): string
