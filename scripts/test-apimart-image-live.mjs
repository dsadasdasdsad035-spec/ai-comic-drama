/**
 * 本机 APIMart 连通性：探测 + 小图上传（需 APIMART_API_KEY / APIB_API_KEY）
 * 用法：node scripts/test-apimart-image-live.mjs
 */
import { probeApimartReachable, uploadImage } from '../server/apimart.mjs'

const apiKey = String(process.env.APIMART_API_KEY || process.env.APIB_API_KEY || '').trim()
const baseUrl = String(process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1').replace(/\/+$/, '')

if (!apiKey) {
  console.error('未设置 APIMART_API_KEY 或 APIB_API_KEY，跳过实网测试')
  process.exit(2)
}

console.log('Base URL:', baseUrl)
const ok = await probeApimartReachable({ baseUrl, apiKey, timeoutMs: 12_000 })
console.log('probeApimartReachable:', ok)
if (!ok) {
  console.error('结论：无法访问 APIMart；生图/视频参考图上传都会失败，请走方舟或配置 HTTPS_PROXY')
  process.exit(1)
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
try {
  const up = await uploadImage({
    baseUrl,
    apiKey,
    buffer: png,
    mime: 'image/png',
    filename: 'probe-1x1.png',
  })
  console.log('上传成功:', up.url)
  console.log('结论：APIMart 参考图上传可用，生图带参考图应能走 APIMart 渠道。')
  process.exit(0)
} catch (e) {
  console.error('上传失败:', e?.message || e)
  process.exit(1)
}