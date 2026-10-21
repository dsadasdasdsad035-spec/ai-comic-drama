/**
 * 视频 HTTP 客户端验证（不调用真实方舟）：
 * 1) 模型档位与请求体
 * 2) 提交 / 轮询 / 下载（本地 mock）
 * 3) 失败、过期、超时、瞬时错误
 * 4) 错误类型映射
 * 跑法：node verify-video-api.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  VideoParamError,
  buildVideoPayload,
  downloadVideoArtifacts,
  pollVideoTask,
  submitVideoTask,
  videoCapsFor,
} from './server/video.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const capture = async (fn) => {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

const model10 = 'doubao-seedance-1-0-pro-250528'
const model15 = 'doubao-seedance-1-5-pro-251215'
const img = 'data:image/png;base64,AA'

let origin = ''
let postMode = 'success'
let getMode = 'success'
let getCalls = 0
let lastPost = null
let lastAuth = ''

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'POST' && u.pathname === '/api/v3/contents/generations/tasks') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    try {
      lastPost = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      lastPost = null
    }
    lastAuth = String(req.headers.authorization || '')
    if (postMode === 'auth') return send(401, { error: { code: 'AuthenticationError', message: 'bad key' } })
    if (postMode === 'rate') return send(429, { error: { code: 'RateLimitExceeded', message: 'slow down' } })
    if (postMode === 'billing') return send(400, { error: { code: 'AccountOverdue', message: '账户欠费' } })
    if (postMode === 'api') return send(500, { error: { code: 'InternalServiceError', message: 'boom' } })
    return send(200, { id: 'task-1' })
  }

  if (req.method === 'GET' && u.pathname === '/api/v3/contents/generations/tasks/task-1') {
    getCalls++
    const ok = () =>
      send(200, {
        status: 'succeeded',
        content: { video_url: `${origin}/video.mp4`, last_frame_url: `${origin}/tail.jpg` },
      })
    if (getMode === 'running') return send(200, { status: 'queued' })
    if (getMode === 'failed') {
      return send(200, {
        status: 'failed',
        error: { code: 'OutputVideoSensitive', message: '内容审核未通过' },
      })
    }
    if (getMode === 'expired') return send(200, { status: 'expired' })
    if (getMode === 'transient') {
      if (getCalls === 1) return send(500, { error: { code: 'InternalServiceError', message: 'temporary' } })
      return ok()
    }
    if (getMode === 'bad-video') {
      return send(200, {
        status: 'succeeded',
        content: { video_url: `${origin}/missing.mp4`, last_frame_url: `${origin}/tail.jpg` },
      })
    }
    if (getMode === 'bad-tail') {
      return send(200, {
        status: 'succeeded',
        content: { video_url: `${origin}/video.mp4`, last_frame_url: `${origin}/missing.jpg` },
      })
    }
    if (getCalls < 2) return send(200, { status: 'running' })
    return ok()
  }

  if (req.method === 'GET' && u.pathname === '/video.mp4') {
    res.setHeader('Content-Type', 'video/mp4')
    res.end(Buffer.from('fake-mp4'))
    return
  }
  if (req.method === 'GET' && u.pathname === '/tail.jpg') {
    res.setHeader('Content-Type', 'image/jpeg')
    res.end(Buffer.from('fake-jpg'))
    return
  }
  res.statusCode = 404
  res.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${server.address().port}`
const BASE = `${origin}/api/v3`

// ---- 1. 档位 ----
const caps10 = videoCapsFor(model10)
const caps15 = videoCapsFor(model15)
check('1.0 档位 2~12 秒', caps10?.minDuration === 2 && caps10?.maxDuration === 12, JSON.stringify(caps10))
check('1.5 档位 4~12 秒', caps15?.minDuration === 4 && caps15?.maxDuration === 12, JSON.stringify(caps15))
check('未登记模型无档位', videoCapsFor('custom-video-9') === null)

// ---- 2. 请求体 ----
const pFirst = buildVideoPayload({
  model: model10,
  prompt: '人物向前走',
  ratio: '9:16',
  seconds: 5,
  resolution: '720p',
  firstFrame: img,
  lastFrame: 'data:image/png;base64,BB',
  cameraFixed: true,
})
const firstRoles = pFirst.content.filter((c) => c.type === 'image_url').map((c) => c.role)
check('首帧 + 尾帧角色', firstRoles.join(',') === 'first_frame,last_frame', firstRoles.join(','))
check(
  '顶层参数',
  pFirst.model === model10 && pFirst.ratio === '9:16' && pFirst.duration === 5 && pFirst.resolution === '720p',
  JSON.stringify(pFirst),
)
check('camera_fixed / return_last_frame', pFirst.camera_fixed === true && pFirst.return_last_frame === true)

const refs = ['A', 'B', 'C', 'D', 'E'].map((x) => `data:image/png;base64,${x}`)
const pRef = buildVideoPayload({
  model: model10,
  prompt: '参考图里的人物',
  seconds: 5,
  lastFrame: 'data:image/png;base64,LAST',
  referenceImages: refs,
})
const refItems = pRef.content.filter((c) => c.type === 'image_url')
check('参考图最多 4 张', refItems.length === 4, String(refItems.length))
check('参考图角色正确', refItems.every((c) => c.role === 'reference_image'))
check('参考图模式忽略尾帧', !refItems.some((c) => c.role === 'last_frame'))

const eBadDuration = await capture(async () =>
  buildVideoPayload({ model: model15, prompt: 'x', seconds: 3, firstFrame: img }),
)
check(
  '1.5 拒绝 3 秒',
  eBadDuration instanceof VideoParamError && /4~12/.test(eBadDuration.message),
  eBadDuration?.message,
)
const p3 = buildVideoPayload({ model: model10, prompt: 'x', seconds: 3, firstFrame: img })
check('1.0 接受 3 秒', p3.duration === 3, String(p3.duration))
const eOver = await capture(async () =>
  buildVideoPayload({ model: model15, prompt: 'x', seconds: 13, firstFrame: img }),
)
check('1.5 拒绝 13 秒', eOver instanceof VideoParamError, eOver?.message)
const eRes = await capture(async () =>
  buildVideoPayload({ model: model10, prompt: 'x', seconds: 5, resolution: '4k', firstFrame: img }),
)
check('已知模型拒绝非法分辨率', eRes instanceof VideoParamError, eRes?.message)
const pUnknown = buildVideoPayload({
  model: 'custom-video-9',
  prompt: 'x',
  seconds: 20,
  resolution: '8k',
  firstFrame: img,
})
check('未登记模型放行参数', pUnknown.duration === 20 && pUnknown.resolution === '8k', JSON.stringify(pUnknown))
const eNoImg = await capture(async () => buildVideoPayload({ model: model10, prompt: 'x', seconds: 5 }))
check('缺少图片时报错', eNoImg instanceof VideoParamError, eNoImg?.message)

// ---- 3. 提交 / 轮询 / 下载 ----
postMode = 'success'
getMode = 'success'
getCalls = 0
const sub = await submitVideoTask({ baseUrl: BASE, apiKey: 'test-key', payload: pFirst })
check('提交返回 task id', sub.taskId === 'task-1', sub.taskId)
check('提交带鉴权头', lastAuth === 'Bearer test-key', lastAuth)
check(
  '提交请求体正确',
  lastPost?.model === model10 && lastPost?.duration === 5 && lastPost?.content?.length === 3,
  JSON.stringify(lastPost),
)

const done = await pollVideoTask({
  baseUrl: BASE,
  apiKey: 'test-key',
  taskId: 'task-1',
  intervalMs: 5,
  timeoutMs: 1000,
})
check(
  '轮询到成功',
  done.status === 'succeeded' && done.videoUrl.endsWith('/video.mp4') && done.lastFrameUrl.endsWith('/tail.jpg'),
  JSON.stringify(done),
)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-video-api-'))
const art = await downloadVideoArtifacts({
  videoUrl: done.videoUrl,
  lastFrameUrl: done.lastFrameUrl,
  videoDir: path.join(tmp, 'videos'),
  frameDir: path.join(tmp, 'generated'),
})
check(
  '视频落盘',
  art.url.startsWith('/videos/shot-vid-') && fs.existsSync(path.join(tmp, 'videos', path.basename(art.url))),
  art.url,
)
check(
  '尾帧落盘',
  art.tail.startsWith('/generated/tail-') &&
    fs.existsSync(path.join(tmp, 'generated', path.basename(art.tail))),
  art.tail,
)
fs.rmSync(tmp, { recursive: true, force: true })

// ---- 4. 失败 / 过期 / 超时 / 瞬时错误 ----
getMode = 'failed'
getCalls = 0
const eFailed = await capture(async () =>
  pollVideoTask({ baseUrl: BASE, apiKey: 'k', taskId: 'task-1', intervalMs: 5, timeoutMs: 1000 }),
)
check(
  '失败状态保留错误码与消息',
  /OutputVideoSensitive/.test(eFailed?.message || '') && /内容审核未通过/.test(eFailed?.message || ''),
  eFailed?.message,
)

getMode = 'expired'
getCalls = 0
const eExpired = await capture(async () =>
  pollVideoTask({ baseUrl: BASE, apiKey: 'k', taskId: 'task-1', intervalMs: 5, timeoutMs: 1000 }),
)
check('过期状态报错', /已过期/.test(eExpired?.message || ''), eExpired?.message)

getMode = 'running'
getCalls = 0
const eTimeout = await capture(async () =>
  pollVideoTask({ baseUrl: BASE, apiKey: 'k', taskId: 'task-1', intervalMs: 5, timeoutMs: 25 }),
)
check('轮询超时', eTimeout?.kind === 'timeout', `${eTimeout?.kind} | ${eTimeout?.message}`)

getMode = 'transient'
getCalls = 0
const doneTransient = await pollVideoTask({
  baseUrl: BASE,
  apiKey: 'k',
  taskId: 'task-1',
  intervalMs: 5,
  timeoutMs: 1000,
})
check('GET 瞬时错误后恢复', doneTransient.status === 'succeeded', doneTransient.status)

getMode = 'bad-video'
getCalls = 0
const doneBadVideo = await pollVideoTask({
  baseUrl: BASE,
  apiKey: 'k',
  taskId: 'task-1',
  intervalMs: 5,
  timeoutMs: 1000,
})
const eBadVideo = await capture(async () =>
  downloadVideoArtifacts({
    videoUrl: doneBadVideo.videoUrl,
    lastFrameUrl: doneBadVideo.lastFrameUrl,
    videoDir: path.join(os.tmpdir(), 'verify-video-missing', 'videos'),
    frameDir: path.join(os.tmpdir(), 'verify-video-missing', 'generated'),
  }),
)
check('视频下载失败使任务失败', /下载视频失败/.test(eBadVideo?.message || ''), eBadVideo?.message)

getMode = 'bad-tail'
getCalls = 0
const doneBadTail = await pollVideoTask({
  baseUrl: BASE,
  apiKey: 'k',
  taskId: 'task-1',
  intervalMs: 5,
  timeoutMs: 1000,
})
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-video-tail-'))
const artTail = await downloadVideoArtifacts({
  videoUrl: doneBadTail.videoUrl,
  lastFrameUrl: doneBadTail.lastFrameUrl,
  videoDir: path.join(tmp2, 'videos'),
  frameDir: path.join(tmp2, 'generated'),
})
check('尾帧失败不影响视频', artTail.tail === '' && artTail.url.startsWith('/videos/'), JSON.stringify(artTail))
fs.rmSync(tmp2, { recursive: true, force: true })

// ---- 5. 提交错误映射 ----
for (const [mode, kind, code] of [
  ['auth', 'auth', 'AuthenticationError'],
  ['rate', 'rate-limit', 'RateLimitExceeded'],
  ['billing', 'billing', 'AccountOverdue'],
  ['api', 'api', 'InternalServiceError'],
]) {
  postMode = mode
  const e = await capture(async () =>
    submitVideoTask({ baseUrl: BASE, apiKey: 'k', payload: pFirst }),
  )
  check(
    `提交错误映射 ${mode}`,
    e?.kind === kind && String(e?.message || '').includes(code),
    `${e?.kind} | ${e?.message}`,
  )
}

await new Promise((resolve) => server.close(resolve))
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
