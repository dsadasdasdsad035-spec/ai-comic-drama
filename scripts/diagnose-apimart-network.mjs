/**
 * 诊断本机 → api.apimart.ai 连通性（与参考图上传 /uploads/images 同源 fetch）。
 * 用法：node scripts/diagnose-apimart-network.mjs
 * 若走代理：HTTPS_PROXY=http://127.0.0.1:7890 node scripts/diagnose-apimart-network.mjs
 */
import { probeApimartReachable, resolveApimartHttpsProxy } from '../server/apimart.mjs'
import { getApimartFetch } from '../server/apimart-network.mjs'

const proxy = resolveApimartHttpsProxy()
const fetchImpl = getApimartFetch()

console.log('代理:', proxy || '（未检测到；可设置 HTTPS_PROXY / SB_HTTPS_PROXY 或 macOS 系统代理）')

const t0 = Date.now()
try {
  const r = await fetchImpl('https://api.apimart.ai/v1/models', {
    headers: { Authorization: 'Bearer probe' },
    signal: AbortSignal.timeout(15_000),
  })
  console.log(`GET /v1/models → HTTP ${r.status}（${Date.now() - t0}ms）`)
  if (r.ok || r.status === 401 || r.status === 403) {
    console.log('结论: 能完成 TLS 并收到 HTTP 响应，APIMart 网络正常（密钥对错另论）。')
    process.exit(0)
  }
  console.log('结论: 已连上服务器但返回异常状态，请查 API Key 或账户。')
  process.exit(0)
} catch (e) {
  const msg = String(e?.message || e)
  const code = e?.cause?.code || ''
  console.log(`GET /v1/models 失败（${Date.now() - t0}ms）: ${msg}`)
  if (code) console.log('底层 code:', code, e?.cause?.message || '')
  if (/SSL|TLS|HANDSHAKE|timeout/i.test(`${code} ${msg}`)) {
    console.log(
      '结论: TCP 可能已通但 TLS 握手超时/失败 —— 常见于跨境 HTTPS 被干扰；浏览器能开网页不代表 Node 进程走同一代理。',
    )
    console.log('建议: 1) 开启 Clash/Surge 系统代理（macOS 下本脚本会自动读取）或设置 HTTPS_PROXY 后重跑；2) 确认规则放行 api.apimart.ai。')
  } else {
    console.log('结论: 无法建立连接，请查 DNS、防火墙或代理。')
  }
  const ok = await probeApimartReachable({ apiKey: 'x', timeoutMs: 8_000, fetchImpl })
  console.log('probeApimartReachable:', ok)
  process.exit(1)
}