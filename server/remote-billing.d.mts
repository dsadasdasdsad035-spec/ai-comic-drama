import type { IncomingMessage, ServerResponse } from 'node:http'

/** 线上计费服务地址；空串表示使用本机账本 */
export function remoteBillingBase(): string
/** 转发时附带的 Basic Auth 头；未配置返回空串 */
export function remoteBillingAuthHeader(): string
/** 该 URL 是否应转给线上服务（账号/钱包/计费模型接口；未配置线上地址时恒为 false） */
export function shouldProxyRemoteBilling(url: string): boolean
/** 该 URL 是否属于「线上产出、本机可能还没有」的媒体路径 */
export function shouldProxyRemoteMedia(url: string): boolean
/** 当前计费模式：remote（线上共用账号）或 local（本机账本） */
export function billingModeInfo(): { mode: 'remote' | 'local'; base: string }
/** 把请求转发到线上服务并写回响应；返回时响应已结束 */
export function proxyRemoteBilling(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<boolean>

/**
 * 线上产出的媒体：本机没有就先回源下载。
 * 返回 true 表示已写过响应；false 表示文件已就绪，交给本地静态处理器。
 */
export function proxyRemoteMedia(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  root: string,
): Promise<boolean>
