/**
 * APIMart 参考图上传。
 * 跑法：node verify-apimart-upload.mjs
 */
import { uploadImage } from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const png = Buffer.from('89504e470d0a1a0a', 'hex')
let seen = null
const mockFetch = async (url, init) => {
  seen = { url: String(url), auth: init?.headers?.Authorization, body: init?.body }
  return new Response(JSON.stringify({ url: 'https://cdn.example/ref.png', filename: 'ref.png' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
const out = await uploadImage({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  buffer: png,
  mime: 'image/png',
  filename: 'ref.png',
  fetchImpl: mockFetch,
})
check('上传 URL', seen?.url === 'https://api.apimart.ai/v1/uploads/images', seen?.url)
check('Bearer 头', seen?.auth === 'Bearer k')
check('multipart FormData', seen?.body instanceof FormData)
const file = seen?.body?.get('file')
check('字段名 file 且带内容', Boolean(file) && file.size === png.length && file.name === 'ref.png', file && `${file.name}/${file.size}`)
check('返回 URL', out.url === 'https://cdn.example/ref.png', out.url)

let tooBig = ''
try {
  await uploadImage({
    baseUrl: 'https://api.apimart.ai/v1',
    apiKey: 'k',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    fetchImpl: mockFetch,
  })
} catch (e) {
  tooBig = e.kind
}
check('20MB 上限', tooBig === 'bad-request', tooBig)

const authErr = await uploadImage({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  buffer: png,
  fetchImpl: async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }),
}).catch((e) => e.kind)
check('401 → auth', authErr === 'auth', authErr)

const sizeErr = await uploadImage({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  buffer: png,
  fetchImpl: async () => new Response('{"error":{"message":"too large"}}', { status: 413 }),
}).catch((e) => e.kind)
check('413 → bad-request', sizeErr === 'bad-request', sizeErr)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
