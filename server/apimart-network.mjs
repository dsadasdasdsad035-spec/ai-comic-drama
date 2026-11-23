/**
 * 服务端出网：环境变量代理 + macOS 系统代理（Clash/Surge 等）。
 *
 * Node/Electron 的 `fetch` 默认**完全不认** `HTTPS_PROXY` 与系统代理设置，
 * 所以浏览器能打开的站点、服务端却统一 `fetch failed`。凡是服务端主动访问
 * 外部站点的地方，都要用这里返回的 fetch，而不是全局 `fetch`。
 */
import { execFileSync } from 'node:child_process'
import dns from 'node:dns'
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici'

const APIMART_HOST_RE = /apimart\.ai/i

/** 解析可用代理：显式环境变量优先，其次 macOS 系统设置；没有则返回空串 */
export function resolveSystemHttpsProxy() {
  const fromEnv = String(
    process.env.SB_HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
  ).trim()
  if (fromEnv) return fromEnv
  if (process.platform !== 'darwin') return ''
  try {
    const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 })
    const httpsOn = /HTTPSEnable\s*:\s*1/.test(out)
    const host = out.match(/HTTPSProxy\s*:\s*([^\s]+)/)?.[1]
    const port = out.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]
    if (httpsOn && host && port) return `http://${host}:${port}`
    const httpOn = /HTTPEnable\s*:\s*1/.test(out)
    const hHost = out.match(/HTTPProxy\s*:\s*([^\s]+)/)?.[1]
    const hPort = out.match(/HTTPPort\s*:\s*(\d+)/)?.[1]
    if (httpOn && hHost && hPort) return `http://${hHost}:${hPort}`
  } catch {
    /* 非 mac 或无 scutil */
  }
  return ''
}

/** 兼容旧名：APIMart 与其它外部站点用的是同一套代理解析 */
export const resolveApimartHttpsProxy = resolveSystemHttpsProxy

/** 部分 DNS 会给 apimart.ai 错误的 AAAA；直连时强制 IPv4 */
const apimartIpv4Agent = new Agent({
  connect: {
    family: 4,
    timeout: 60_000,
    lookup: (hostname, options, cb) => {
      if (APIMART_HOST_RE.test(String(hostname))) {
        dns.lookup(hostname, { ...options, family: 4, verbatim: true }, cb)
        return
      }
      dns.lookup(hostname, options, cb)
    },
  },
  headersTimeout: 90_000,
  bodyTimeout: 120_000,
})

/**
 * @param {string} [overrideProxy] 设置页或单次调用可覆盖
 */
export function getApimartFetch(overrideProxy = '') {
  const proxy = String(overrideProxy || resolveSystemHttpsProxy()).trim()
  if (proxy) {
    const dispatcher = new ProxyAgent(proxy)
    return (url, init) => undiciFetch(url, { ...init, dispatcher })
  }
  return (url, init) => undiciFetch(url, { ...init, dispatcher: apimartIpv4Agent })
}

/**
 * 通用外部出网（提示词案例导入等）：有代理就走代理，没有就走直连。
 *
 * 直连用 `autoSelectFamily`（RFC 8305 Happy Eyeballs）同时尝试 A/AAAA：
 * 这类机器常出现「域名有 AAAA 但没有可用 v6」，只解析 AAAA 会整体超时。
 */
const externalDirectAgent = new Agent({
  connect: { autoSelectFamily: true, timeout: 45_000 },
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
})

/**
 * @param {string} [overrideProxy] 设置页或单次调用可覆盖
 */
export function getExternalFetch(overrideProxy = '') {
  const proxy = String(overrideProxy || resolveSystemHttpsProxy()).trim()
  if (proxy) {
    const dispatcher = new ProxyAgent(proxy)
    return (url, init) => undiciFetch(url, { ...init, dispatcher })
  }
  return (url, init) => undiciFetch(url, { ...init, dispatcher: externalDirectAgent })
}