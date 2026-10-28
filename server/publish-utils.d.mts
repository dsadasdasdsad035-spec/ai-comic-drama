/** server/publish-utils.mjs 的类型声明（环境探测、错误脱敏、路径白名单） */

export declare const ALLOWED_URL_PREFIXES: string[]
export declare function resolveChrome(): string
export declare function chromeAvailable(): boolean
/** 有没有可用的图形显示；Linux 容器无 DISPLAY 时为 false */
export declare function hasDisplay(): boolean
/** 无桌面环境的操作提示（扫码登录不可用，需从别处拷 profile） */
export declare const NO_DISPLAY_HINT: string
export declare function sanitizeError(input: unknown): string
export declare function resolvePublishFile(appRoot: string, url: string): { path: string; url: string }
export declare function profilesRoot(appRoot: string): string
export declare function packagesRoot(appRoot: string): string
/** 容器 root 下运行 Chromium 需要的额外启动参数 */
export declare function chromiumSandboxArgs(): string[]
