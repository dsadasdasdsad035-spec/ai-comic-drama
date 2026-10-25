/**
 * APIMart 图像异步任务：提交、轮询终态、下载。
 * 跑法：node verify-apimart-image.mjs
 */
import {
  buildImagePayload,
  downloadResult,
  imageUrlsFromTask,
  pollTask,
  submitImage,
} from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const payload = buildImagePayload({
  model: 'seedream-5-0-pro',
  prompt: '雨夜街道',
  ratio: '16:9',
  refUrls: ['https://cdn.example/ref.png'],
})
check('图像 payload 字段', payload.model === 'seedream-5-0-pro' && payload.size === '16:9' && payload.n === 1)
check('图像 payload 参考图', Array.isArray(payload.image_urls) && payload.image_urls.length === 1)

const submit = await submitImage({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  payload,
  fetchImpl: async () => json({ code: 200, data: [{ status: 'submitted', task_id: 't1' }] }),
})
check('提交读取 task_id', submit.taskId === 't1', JSON.stringify(submit))

const syncUrl = await submitImage({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  payload,
  fetchImpl: async () => json({ code: 200, data: [{ url: 'https://cdn.example/a.png' }] }),
})
check('同步 URL 兼容', syncUrl.url === 'https://cdn.example/a.png')

let polls = 0
const progress = []
const done = await pollTask({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  taskId: 't1',
  intervalMs: 5,
  onProgress: (p) => progress.push(p.status),
  fetchImpl: async () => {
    polls++
    if (polls === 1) return json({ code: 200, data: { status: 'processing', progress: 20 } })
    return json({
      code: 200,
      data: {
        status: 'completed',
        progress: 100,
        result: { images: [{ url: ['https://cdn.example/out.png'] }] },
      },
    })
  },
})
check('轮询到 completed', done.status === 'completed' && polls === 2)
check('进度回调', progress.join(',') === 'processing,completed', progress.join(','))
check('解析图像 URL', imageUrlsFromTask(done)[0] === 'https://cdn.example/out.png')

const failed = await pollTask({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  taskId: 't2',
  intervalMs: 5,
  fetchImpl: async () => json({ code: 200, data: { status: 'failed', error: { message: 'moderation' } } }),
}).catch((e) => e)
check('failed → 可读错误', failed?.kind === 'api' && /moderation/.test(failed.message), failed?.message)

const cancelled = await pollTask({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  taskId: 't3',
  intervalMs: 5,
  fetchImpl: async () => json({ code: 200, data: { status: 'cancelled' } }),
}).catch((e) => e)
check('cancelled 终态', cancelled?.kind === 'cancelled', cancelled?.kind)

const timeout = await pollTask({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  taskId: 't4',
  intervalMs: 5,
  timeoutMs: 30,
  fetchImpl: async () => json({ code: 200, data: { status: 'processing' } }),
}).catch((e) => e)
check('轮询超时', timeout?.kind === 'timeout', timeout?.kind)

const bytes = Buffer.from('png-bytes')
const dl = await downloadResult({
  url: 'https://cdn.example/out.png',
  fetchImpl: async () =>
    new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } }),
})
check('下载结果', dl.bytes.equals(bytes) && dl.contentType === 'image/png')

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
