/**
 * 画布素材卡预览缩略图：减轻 React Flow 缩放时大图解码压力。
 * 生成/参考仍读节点上的原图站内路径，不经此接口。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { localFileForRef } from './media.mjs'
import { resolveStateRoot } from './paths.mjs'
import { resolveFfmpeg, run } from './ffmpeg-host.mjs'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function isCanvasThumbCandidate(ref) {
  const bare = String(ref || '').split('?')[0]
  if (!bare || bare.startsWith('data:') || /^https?:\/\//i.test(bare)) return false
  return (
    bare.startsWith('/project-assets/') ||
    bare.startsWith('/generated/') ||
    bare.startsWith('/videos/')
  )
}

export async function ensureCanvasThumbFile(appRoot, ref, w = 320) {
  const src = localFileForRef(ref, appRoot)
  if (!src) return null
  const ext = path.extname(src).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) return null
  let stat
  try {
    stat = fs.statSync(src)
  } catch {
    return null
  }
  const key = crypto
    .createHash('sha256')
    .update(`${src}\0${stat.mtimeMs}\0${stat.size}\0${w}`)
    .digest('hex')
    .slice(0, 32)
  const cacheDir = path.join(resolveStateRoot(appRoot), 'canvas-thumbs')
  fs.mkdirSync(cacheDir, { recursive: true })
  const out = path.join(cacheDir, `${key}-${w}.jpg`)
  if (fs.existsSync(out)) return out

  const { ffmpeg } = resolveFfmpeg()
  if (!ffmpeg) return src

  const scale = `scale='min(${w},iw)':-2`
  try {
    await run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-vf',
      scale,
      '-frames:v',
      '1',
      '-q:v',
      '6',
      out,
    ])
  } catch {
    return src
  }
  return fs.existsSync(out) ? out : src
}

/** @returns {boolean} 是否已处理该请求 */
export async function handleCanvasThumb(req, res, url, appRoot, serveFile) {
  const u = new URL(url, 'http://local')
  if (u.pathname !== '/api/canvas-thumb') return false
  const ref = decodeURIComponent(String(u.searchParams.get('ref') || '').trim())
  const w = Math.min(512, Math.max(64, Math.round(Number(u.searchParams.get('w')) || 320)))
  if (!ref || !isCanvasThumbCandidate(ref)) {
    res.statusCode = 400
    res.end('invalid ref')
    return true
  }
  try {
    const file = await ensureCanvasThumbFile(appRoot, ref, w)
    if (!file) {
      res.statusCode = 404
      res.end()
      return true
    }
    const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
    serveFile(res, req, file, mime)
    return true
  } catch (e) {
    res.statusCode = 500
    res.end((e && e.message) || 'thumb failed')
    return true
  }
}