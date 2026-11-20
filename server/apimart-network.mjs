/**
 * APIMart 出网：环境变量代理 + macOS 系统代理（Clash/Surge 等）。
 * Node/Electron 子进程不会自动用系统代理，导致浏览器能上 APIMart、服务端 fetch failed。
 */
import { execFileSync } from 'node:child_process'
import dns from 'node:dns'
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici'

const APIMART_HOST_RE = /apimart\.ai/i

export function resolveApimartHttpsProxy() {
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
  const proxy = String(overrideProxy || resolveApimartHttpsProxy()).trim()
  if (proxy) {
    const dispatcher = new ProxyAgent(proxy)
    return (url, init) => undiciFetch(url, { ...init, dispatcher })
  }
  return (url, init) => undiciFetch(url, { ...init, dispatcher: apimartIpv4Agent })
}