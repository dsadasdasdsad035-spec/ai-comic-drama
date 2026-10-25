/**
 * 视频探测与取证：probe、场景切分、证据帧。
 *
 * 设计约束（见 design.md D6）：
 * - 本地视频不能直接送 /api/video-vision，所以主路径是「抽帧 + 图片理解」。
 * - 切分结果必须连续、首尾相接、无重叠；过短的段落并入相邻段而不是丢弃。
 * - 证据帧只追加不覆盖，用户引用的图不会因为重新切分而消失。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { assertFfmpeg, assertFfprobe, resolveFfmpeg, run, runCapture } from './ffmpeg-host.mjs'

/** 小于该长度的切分结果并入相邻镜头 */
export const MIN_SHOT_SECONDS = 0.8
/** 场景变化检测的默认阈值（0–1，越大越不敏感） */
export const DEFAULT_SCENE_THRESHOLD = 0.3
/** 每次最多抽多少帧，防止一次请求打满磁盘 */
export const MAX_FRAMES_PER_REQUEST = 48
/** 单帧像素宽上限：视觉接口对超长边不友好，统一缩到 1280 内 */
const MAX_FRAME_WIDTH = 1280

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** ffprobe 输出标准化：时长优先用 format.duration，缺失时退回流时长 */
export async function probeMedia(file) {
  if (!fs.existsSync(file)) throw new Error('视频文件不存在')
  const ffprobe = assertFfprobe()
  const stdout = await run(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    file,
  ], { timeoutMs: 60_000 })

  let j
  try {
    j = JSON.parse(stdout)
  } catch {
    throw new Error('无法读取媒体信息：ffprobe 输出不是合法 JSON')
  }
  const streams = Array.isArray(j?.streams) ? j.streams : []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!video) throw new Error('无法读取媒体信息：文件里没有视频流')

  const duration =
    num(j?.format?.duration) ??
    num(video?.duration) ??
    null

  let fps = null
  const rate = String(video?.avg_frame_rate || '')
  const m = rate.match(/^(\d+)\/(\d+)$/)
  if (m && Number(m[2]) > 0) fps = round2(Number(m[1]) / Number(m[2]))
  else if (num(rate)) fps = round2(Number(rate))

  return {
    duration: duration == null ? null : round2(duration),
    width: num(video?.width),
    height: num(video?.height),
    fps,
    bitrate: num(j?.format?.bit_rate) ?? num(video?.bit_rate),
    vcodec: String(video?.codec_name || ''),
    acodec: String(audio?.codec_name || ''),
    hasAudio: Boolean(audio),
    /**
     * 容器时长通常比最后一张画面略长，切分时用它兜住末尾，
     * 否则最后一个镜头会因容差被丢掉。
     */
    streamDuration: num(video?.duration),
  }
}

/**
 * 场景切分：用 ffmpeg 的 scene 过滤器输出候选切点。
 * 返回的段落覆盖整段时长，不依赖 ffmpeg 输出是否精确。
 */
export async function splitScenes(file, { threshold = DEFAULT_SCENE_THRESHOLD, minShotSeconds = MIN_SHOT_SECONDS } = {}) {
  const info = await probeMedia(file)
  const total = Number(info.duration || 0)
  if (!(total > 0)) throw new Error('无法确定视频时长，不能切分')

  const ffmpeg = assertFfmpeg()
  const t = Math.max(0.05, Math.min(0.95, Number(threshold) || DEFAULT_SCENE_THRESHOLD))
  const captured = await runCapture(ffmpeg, [
    '-hide_banner', '-nostats',
    '-i', file,
    '-filter:v', `select='gt(scene,${t})',showinfo`,
    '-an', '-f', 'null', '-',
  ], { timeoutMs: 300_000 })

  // showinfo 写在 stderr，stdout 是空的
  const cuts = []
  const text = `${captured.stderr}\n${captured.stdout}`
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g
  let m
  while ((m = re.exec(text))) {
    const at = Number(m[1])
    if (Number.isFinite(at) && at > 0.05 && at < total - 0.05) cuts.push(round2(at))
  }
  const unique = [...new Set(cuts)].sort((a, b) => a - b)

  // 边界：0 → 候选切点 → 总时长
  const bounds = [0, ...unique, round2(total)]
  let shots = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]
    const end = bounds[i + 1]
    if (end - start <= 0.0001) continue
    shots.push({ start, end })
  }

  // 过短的段并入前一段（首段并入后一段），保证覆盖不变
  const min = Math.max(0.2, Number(minShotSeconds) || MIN_SHOT_SECONDS)
  const merged = []
  for (const shot of shots) {
    const short = shot.end - shot.start < min
    if (!short) {
      merged.push({ ...shot })
      continue
    }
    const prev = merged[merged.length - 1]
    if (prev) prev.end = shot.end
    else merged.push({ ...shot })
  }
  if (merged.length > 1) {
    const last = merged[merged.length - 1]
    if (last.end - last.start < min) {
      merged[merged.length - 2].end = last.end
      merged.pop()
    }
  }

  return {
    duration: round2(total),
    threshold: t,
    shots: merged.map((s, i) => ({ index: i + 1, start: round2(s.start), end: round2(s.end) })),
  }
}

/**
 * 抽一帧：可以指定时点（秒）。越界时点被夹紧，返回实际使用的时间。
 * 抽帧失败（例如时点落在末帧之后）抛错，由调用方决定跳过还是整体失败。
 */
export async function extractFrame(file, at, outFile) {
  if (!fs.existsSync(file)) throw new Error('视频文件不存在')
  const info = await probeMedia(file)
  const total = Number(info.duration || 0)
  const t = Math.max(0, Math.min(Number(at) || 0, Math.max(0, total - 0.05)))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const ffmpeg = assertFfmpeg()
  await run(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(round2(t)),
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale='min(${MAX_FRAME_WIDTH},iw)':-2`,
    '-q:v', '2',
    outFile,
  ], { timeoutMs: 60_000 })
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 256) {
    throw new Error(`抽帧失败：第 ${round2(t)} 秒没有可用画面`)
  }
  return { at: round2(t), file: outFile, bytes: fs.statSync(outFile).size }
}

/**
 * 每镜抽一张中间帧；已有帧的镜头默认跳过，保证重跑不覆盖用户引用。
 * 帧文件名带 sourceId 前缀，删源时能按前缀清理。
 */
export async function extractShotFrames(file, { sourceId, sessionDir, shots, framesDir, overwrite = false, at = 'mid' }) {
  const dir = framesDir || path.join(sessionDir, 'frames')
  fs.mkdirSync(dir, { recursive: true })
  const results = []
  for (const shot of shots) {
    const index = Number(shot.index)
    const existing = Array.isArray(shot.frames) ? shot.frames : []
    if (existing.length && !overwrite) {
      results.push({ index, frames: existing, skipped: true })
      continue
    }
    const span = Math.max(0.05, Number(shot.end) - Number(shot.start))
    const t =
      at === 'start' ? Number(shot.start) + Math.min(0.1, span / 4)
        : at === 'end' ? Number(shot.end) - Math.min(0.1, span / 4)
          : Number(shot.start) + span / 2
    const name = `${sourceId}-s${String(index).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex')}.jpg`
    const out = path.join(dir, name)
    try {
      const got = await extractFrame(file, t, out)
      results.push({
        index,
        frames: [`/creative/${path.basename(sessionDir)}/frames/${name}`],
        at: got.at,
      })
    } catch (e) {
      results.push({ index, frames: existing, error: e?.message || String(e) })
    }
  }
  return results
}

/** 源封面：优先 1 秒处，太短就取 0 */
export async function extractCover(file, outFile) {
  const info = await probeMedia(file)
  const total = Number(info.duration || 0)
  const at = total > 1.2 ? 1 : 0
  return extractFrame(file, at, outFile)
}

/** 给前端展示的 ffmpeg 就绪状态 */
export function ffmpegStatus() {
  const { ffmpeg, ffprobe } = resolveFfmpeg()
  return { ok: Boolean(ffmpeg && ffprobe), ffmpeg, ffprobe }
}
