/** server/apimart-network.mjs 的类型声明（APIMart 出网：代理与 IPv4 处理） */

export declare function resolveApimartHttpsProxy(): string
export declare function getApimartFetch(
  overrideProxy?: string,
): (url: string, init?: Record<string, unknown>) => Promise<Response>
