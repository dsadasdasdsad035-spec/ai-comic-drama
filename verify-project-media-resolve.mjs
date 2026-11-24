/**
 * 站内路径解析回归：`/project-assets/<项目>/<文件>` 与媒体根两个根都要认。
 *
 * 背景（2026-11-24）：画布出片报「参考视频不存在：
 * /project-assets/desktop-host-probe/ref-xxx.mp4」，文件其实在
 * `<projects>/<项目>/assets/` 下。图片解析（resolveRef）早就有 project-assets 分支，
 * 视频（resolveVideoRef）却只拼媒体根，于是素材库连线/桌面端探测生成的视频全被
 * 判不存在。这条脚本把两个根一起钉住，避免再漏。
 *
 * 顺带覆盖 APIMart 参考视频上传：本地视频不再被「只接受公网 URL」拒绝，
 * 而是走 POST /uploads/videos 换公网地址（用 mock 上游，不花额度）。
 *
 * 跑法：node verify-project-media-resolve.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 隔离一套 projects + media 根，照桌面端的目录分工 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-media-resolve-'))
const PROJECTS = path.join(TMP, 'projects')
const MEDIA = path.join(TMP, 'media')
const PROJECT = 'probe-project'
process.env.SB_PROJECTS_DIR = PROJECTS
process.env.SB_MEDIA_ROOT = MEDIA

const media = await import(path.join(ROOT, 'server', 'media.mjs'))

// ---- 两套目录各放一个视频 ----
const assetsDir = path.join(PROJECTS, PROJECT, 'assets')
fs.mkdirSync(assetsDir, { recursive: true })
const projectVideo = path.join(assetsDir, 'ref-abc.mp4')
fs.writeFileSync(projectVideo, Buffer.alloc(2048, 1))

fs.mkdirSync(path.join(MEDIA, 'videos'), { recursive: true })
const mediaVideo = path.join(MEDIA, 'videos', 'schedule-1.mp4')
fs.writeFileSync(mediaVideo, Buffer.alloc(2048, 1))

// ---- 1. 项目媒体根 ----
const gotProject = media.localFileForRef(`/project-assets/${PROJECT}/ref-abc.mp4`, ROOT)
check('project-assets 解析到 <projects>/<项目>/assets', gotProject === projectVideo, String(gotProject))

// ---- 2. 媒体根 ----
const gotMedia = media.localFileForRef('/videos/schedule-1.mp4', ROOT)
check('普通站内路径解析到媒体根', gotMedia === mediaVideo, String(gotMedia))

// ---- 3. 带 query 的项目媒体路径 ----
const gotQuery = media.localFileForRef(`/project-assets/${PROJECT}/ref-abc.mp4?v=2`, ROOT)
check('带 query 仍能解析（签名/缓存戳）', gotQuery === projectVideo, String(gotQuery))

// ---- 4. 不存在时返回 null，不抛错 ----
check('缺文件返回 null 而不是抛错', media.localFileForRef(`/project-assets/${PROJECT}/nope.mp4`, ROOT) === null)
check('越界路径返回 null', media.localFileForRef('/project-assets/../etc/passwd', ROOT) === null)

// ---- 5. data / http 不走本地解析 ----
check('data URL 返回 null', media.localFileForRef('data:video/mp4;base64,AAAA', ROOT) === null)
check('http URL 返回 null', media.localFileForRef('https://cdn/x.mp4', ROOT) === null)

// ---- 6. APIMart 参考视频上传 ----
let uploadedName = ''
let uploadedBytes = 0
let uploadContentType = ''
const mock = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/uploads/videos') {
    uploadContentType = String(req.headers['content-type'] || '')
    const chunks = []
    for await (const c of req) chunks.push(Buffer.from(c))
    const body = Buffer.concat(chunks).toString('latin1')
    uploadedBytes = body.length
    // filename 在 multipart 的分段头里（body），不在请求的 content-type 上
    const m = body.match(/name="file"; filename="([^"]+)"/)
    uploadedName = m ? m[1] : ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        url: 'https://getapib.org/video/mock-uploaded.mp4',
        content_type: 'video/mp4',
        filename: uploadedName || 'video.mp4',
      }),
    )
    return
  }
  res.writeHead(404).end('not found')
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const mockBase = `http://127.0.0.1:${mock.address().port}/v1`

const apimart = await import(path.join(ROOT, 'server', 'apimart.mjs'))
const up = await apimart.uploadVideo({
  baseUrl: mockBase,
  apiKey: 'test-key',
  filePath: projectVideo,
  mime: 'video/mp4',
  filename: 'ref-abc.mp4',
})
check('本地上传返回公网 URL', up.url === 'https://getapib.org/video/mock-uploaded.mp4', up.url)
check('上传是 multipart 且带文件内容', /multipart\/form-data/.test(uploadContentType) && uploadedBytes > 1024, `${uploadContentType.slice(0, 40)} / ${uploadedBytes}B`)
check('上传字段名是 file', uploadedName === 'ref-abc.mp4', uploadedName)

// 上传失败时给出上游原因，不静默成功
const mockFail = http.createServer((req, res) => {
  res.writeHead(400, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'file too large', code: 'invalid_request_error' } }))
})
await new Promise((r) => mockFail.listen(0, '127.0.0.1', r))
let failed = null
try {
  await apimart.uploadVideo({
    baseUrl: `http://127.0.0.1:${mockFail.address().port}/v1`,
    apiKey: 'test-key',
    filePath: projectVideo,
  })
} catch (e) {
  failed = e
}
check('上传失败带上游原因', Boolean(failed) && /file too large/.test(String(failed?.message)), String(failed?.message))

await new Promise((r) => mock.close(r))
await new Promise((r) => mockFail.close(r))
fs.rmSync(TMP, { recursive: true, force: true })

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
