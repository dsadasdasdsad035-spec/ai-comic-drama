/**
 * ffmpeg / ffprobe 定位与执行：创意摄取与分析共用。
 *
 * 为什么不复用 vite.config.ts 里的常量：那里只认 macOS 路径且绑着字幕探测。
 * 这里按「环境变量 → 包的静态二进制 → 系统路径 → PATH」顺序找，
 * 只依赖解码、抽帧与探测，不需要 libass。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const CANDIDATES = [
  process.env.FFMPEG_PATH,
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
].filter(Boolean)

let cached = null

function firstExisting(list) {
  for (const p of list) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return ''
}

function fromPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, name)
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return ''
}

/** 返回 { ffmpeg, ffprobe }；找不到时返回空串，由调用方给出可读错误 */
export function resolveFfmpeg() {
  if (cached) return cached
  const ffmpeg = firstExisting(CANDIDATES) || fromPath('ffmpeg')
  let ffprobe = ''
  if (ffmpeg) {
    const sibling = ffmpeg.replace(/ffmpeg(\.exe)?$/, (m) => (m.includes('.exe') ? 'ffprobe.exe' : 'ffprobe'))
    ffprobe = firstExisting([process.env.FFPROBE_PATH, sibling]) || fromPath('ffprobe')
  }
  cached = { ffmpeg, ffprobe }
  return cached
}

export function assertFfmpeg() {
  const { ffmpeg } = resolveFfmpeg()
  if (!ffmpeg) throw new Error('未找到 ffmpeg：请安装 ffmpeg，或设置 FFMPEG_PATH 指向可执行文件')
  return ffmpeg
}

export function assertFfprobe() {
  const { ffprobe } = resolveFfmpeg()
  if (!ffprobe) throw new Error('未找到 ffprobe：请安装 ffmpeg（ffprobe 随附），或设置 FFPROBE_PATH')
  return ffprobe
}

/** 执行并收集 stdout；超时与失败都抛带 stderr 的可读错误 */
export function run(cmd, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '').trim().slice(0, 400)
        reject(new Error(`${path.basename(cmd)} 执行失败：${msg || err.name}`))
        return
      }
      resolve(String(stdout || ''))
    })
  })
}

/**
 * 同时拿 stdout 与 stderr。
 * ffmpeg 的 showinfo / metadata 输出走 stderr，只取 stdout 会静默拿到空结果。
 */
export function runCapture(cmd, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '').trim().slice(0, 400)
        reject(new Error(`${path.basename(cmd)} 执行失败：${msg || err.name}`))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}
