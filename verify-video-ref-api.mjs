/**
 * 3D 调度视频参考验证（不调用真实方舟）：
 * 1) buildVideoPayload 的参考视频模式（无首尾帧 / 无 camera_fixed / 2.5 任务类型）
 * 2) server/files.mjs 的上传、轮询、缓存、过期与失败路径
 * 3) 视频前置校验（格式 / 时长 / 大小）
 * 跑法：node verify-video-ref-api.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildVideoPayload } from './server/video.mjs'
import {
  FileError,
  clearFileCache,
  ensureUploadedVideo,
  validateVideoFile,
} from './server/files.mjs'

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
const captureSync = (fn) => {
  try {
    fn()
    return null
  } catch (e) {
    return e
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-video-ref-'))
const mp4 = path.join(tmp, 'schedule.mp4')
fs.writeFileSync(mp4, Buffer.alloc(4096, 1))
const webm = path.join(tmp, 'schedule.webm')
fs.writeFileSync(webm, Buffer.alloc(4096, 1))
const big = path.join(tmp, 'big.mp4')
fs.writeFileSync(big, '')
fs.truncateSync(big, 200 * 1024 * 1024 + 1)

const model20 = 'doubao-seedance-2-0-260128'
const model25 = 'doubao-seedance-2-5-260628'
const img = 'data:image/png;base64,AA'
const videoUrl = 'https://tos.example.com/secret.mp4?sign=1'

// ---- 1. 请求体 ----
const pVideo = buildVideoPayload({
  model: model20,
  prompt: '参考调度视频',
  seconds: 5,
  referenceImages: [img],
  referenceVideos: [videoUrl],
  firstFrame: 'data:image/png;base64,FF',
  lastFrame: 'data:image/png;base64,LL',
  cameraFixed: true,
  videoRefTaskType: '',
})
check(
  '参考视频模式 content 顺序',
  JSON.stringify(pVideo.content.map((c) => c.type)) === JSON.stringify(['text', 'image_url', 'video_url']),
  JSON.stringify(pVideo.content),
)
check('图片角色 reference_image', pVideo.content[1].role === 'reference_image', pVideo.content[1].role)
check('视频角色 reference_video', pVideo.content[2].role === 'reference_video', pVideo.content[2].role)
check(
  '不发首帧/尾帧',
  !pVideo.content.some((c) => c.role === 'first_frame' || c.role === 'last_frame'),
  JSON.stringify(pVideo.content.map((c) => c.role)),
)
check('参考视频模式不带 camera_fixed', !('camera_fixed' in pVideo), JSON.stringify(pVideo))
check('2.0 不传 omni_reference_task_type', !('omni_reference_task_type' in pVideo))

const p25 = buildVideoPayload({
  model: model25,
  prompt: 'x',
  seconds: 5,
  referenceVideos: [videoUrl],
  videoRefTaskType: 'reference',
})
check('2.5 传参考生视频任务类型', p25.omni_reference_task_type === 'reference', JSON.stringify(p25))

const pVideoOnly = buildVideoPayload({
  model: model20,
  prompt: 'x',
  seconds: 5,
  referenceVideos: [videoUrl],
})
check(
  '只有视频也能提交',
  pVideoOnly.content.length === 2 && pVideoOnly.content[1].type === 'video_url',
  JSON.stringify(pVideoOnly.content),
)

const pCapped = buildVideoPayload({
  model: model20,
  prompt: 'x',
  seconds: 5,
  referenceVideos: ['a', 'b', 'c', 'd'],
})
check(
  '参考视频最多 3 段',
  pCapped.content.filter((c) => c.type === 'video_url').length === 3,
  String(pCapped.content.filter((c) => c.type === 'video_url').length),
)

const pFirst = buildVideoPayload({
  model: 'doubao-seedance-1-0-pro-250528',
  prompt: 'x',
  seconds: 5,
  firstFrame: img,
  cameraFixed: true,
})
check('首帧模式保持原样', pFirst.content[1].role === 'first_frame' && pFirst.camera_fixed === true)
check('首帧模式没有视频项', !pFirst.content.some((c) => c.type === 'video_url'))

// ---- 2. 前置校验 ----
const eWebm = captureSync(() => validateVideoFile({ filePath: webm, seconds: 3 }))
check('webm 被拒绝（由路由先转码）', eWebm instanceof FileError && eWebm.kind === 'unsupported-format', eWebm?.message)
const eShort = captureSync(() => validateVideoFile({ filePath: mp4, seconds: 1 }))
check('少于 2 秒被拒绝', eShort instanceof FileError && eShort.kind === 'bad-duration', eShort?.message)
const eLong = captureSync(() => validateVideoFile({ filePath: mp4, seconds: 16, maxDuration: 15 }))
check('超过 15 秒被拒绝', eLong instanceof FileError && eLong.kind === 'bad-duration', eLong?.message)
const ok30 = captureSync(() => validateVideoFile({ filePath: mp4, seconds: 16, maxDuration: 30 }))
check('2.5 的 30 秒上限放行', ok30 === null, String(ok30))
const eBig = captureSync(() => validateVideoFile({ filePath: big, seconds: 3 }))
check('超过 200MB 被拒绝', eBig instanceof FileError && eBig.kind === 'too-large', eBig?.message)
const eMissing = captureSync(() => validateVideoFile({ filePath: path.join(tmp, 'nope.mp4'), seconds: 3 }))
check('文件不存在被拒绝', eMissing instanceof FileError && eMissing.kind === 'missing', eMissing?.message)

// ---- 3. Files API mock ----
let origin = ''
let mode = 'ok'
let uploads = 0
let gets = 0
let lastAuth = ''
let lastUploadBytes = 0
let expireAt = Math.floor(Date.now() / 1000) + 3600

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'POST' && u.pathname === '/api/v3/files') {
    uploads++
    lastAuth = String(req.headers.authorization || '')
    for await (const c of req) lastUploadBytes += c.length
    if (mode === 'upload-fail') {
      return send(500, { error: { code: 'InternalServiceError', message: 'upload boom' } })
    }
    return send(200, { id: 'file-1', status: 'processing' })
  }
  if (req.method === 'GET' && u.pathname === '/api/v3/files/file-1') {
    gets++
    if (mode === 'file-failed') {
      return send(200, {
        id: 'file-1',
        status: 'failed',
        error: { code: 'PreprocessFailed', message: 'bad video' },
      })
    }
    if (mode === 'no-url') return send(200, { id: 'file-1', status: 'active', expire_at: expireAt })
    if (mode === 'always-processing') return send(200, { id: 'file-1', status: 'processing' })
    if (mode === 'processing-once' && gets === 1) {
      return send(200, { id: 'file-1', status: 'processing' })
    }
    return send(200, {
      id: 'file-1',
      status: 'active',
      download_url: videoUrl,
      expire_at: expireAt,
    })
  }
  res.statusCode = 404
  res.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${server.address().port}`
const BASE = `${origin}/api/v3`
const opts = {
  baseUrl: BASE,
  apiKey: 'test-key',
  filePath: mp4,
  seconds: 3,
  maxDuration: 15,
  intervalMs: 1,
  timeoutMs: 2000,
  sleepImpl: async () => {},
}

clearFileCache()
mode = 'processing-once'
uploads = 0
gets = 0
lastAuth = ''
lastUploadBytes = 0
expireAt = Math.floor(Date.now() / 1000) + 3600
const up1 = await ensureUploadedVideo(opts)
check('上传后轮询到 active', up1.downloadUrl === videoUrl && up1.reused === false, JSON.stringify(up1))
check('上传次数 1', uploads === 1, String(uploads))
check('轮询 processing → active', gets === 2, String(gets))
check('上传带 Bearer 鉴权', lastAuth === 'Bearer test-key', lastAuth)
check('上传是 multipart 且有内容', lastUploadBytes > 4096, String(lastUploadBytes))

mode = 'ok'
const up2 = await ensureUploadedVideo(opts)
check('同文件复用 fileId', up2.reused === true && uploads === 1, JSON.stringify({ up2, uploads }))
check('复用时只刷新地址', gets === 3, String(gets))

clearFileCache()
mode = 'ok'
uploads = 0
gets = 0
expireAt = Math.floor(Date.now() / 1000) + 10 // 小于 60 秒安全余量，应重新上传
await ensureUploadedVideo(opts)
const up3 = await ensureUploadedVideo(opts)
check('文件快过期时重新上传', uploads === 2 && up3.reused === false, JSON.stringify({ uploads, up3, expireAt }))

clearFileCache()
mode = 'upload-fail'
const eUpload = await capture(async () => ensureUploadedVideo(opts))
check(
  '上传失败带阶段信息且不回显地址',
  eUpload instanceof FileError && /上传/.test(eUpload.message) && !eUpload.message.includes('secret.mp4'),
  eUpload?.message,
)

clearFileCache()
mode = 'file-failed'
const eFailed = await capture(async () => ensureUploadedVideo(opts))
check(
  '处理失败带阶段信息且不回显地址',
  eFailed instanceof FileError && /处理失败/.test(eFailed.message) && !eFailed.message.includes('secret.mp4'),
  eFailed?.message,
)

clearFileCache()
mode = 'no-url'
const eNoUrl = await capture(async () => ensureUploadedVideo(opts))
check(
  'active 但缺下载地址会报错',
  eNoUrl instanceof FileError && /没有下载地址/.test(eNoUrl.message) && !eNoUrl.message.includes('secret.mp4'),
  eNoUrl?.message,
)

clearFileCache()
mode = 'always-processing'
const eTimeout = await capture(async () =>
  ensureUploadedVideo({ ...opts, timeoutMs: 20, sleepImpl: async () => {} }),
)
check('轮询超时', eTimeout instanceof FileError && eTimeout.kind === 'timeout', eTimeout?.message)

await new Promise((resolve) => server.close(resolve))
fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
