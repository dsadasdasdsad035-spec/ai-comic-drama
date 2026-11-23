/** server/apimart-network.mjs 的类型声明（服务端出网：系统代理与 IPv4 处理） */

/** 解析可用代理：显式环境变量优先，其次 macOS 系统设置；没有则返回空串 */
export declare function resolveSystemHttpsProxy(): string
/** 兼容旧名，与 resolveSystemHttpsProxy 等价 */
export declare function resolveApimartHttpsProxy(): string

/** APIMart 专用：apimart.ai 强制 IPv4，其余主机照常解析 */
export declare function getApimartFetch(
  overrideProxy?: string,
): (url: string, init?: Record<string, unknown>) => Promise<Response>

/** 通用外部出网：有代理走代理，没代理走直连（Happy Eyeballs 同时试 A/AAAA） */
export declare function getExternalFetch(
  overrideProxy?: string,
): (url: string, init?: Record<string, unknown>) => Promise<Response>
