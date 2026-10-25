/**
 * 口型验收抽帧：找静音段和发声段，分别抽帧，交给 UI/视觉模型判断。
 * 只使用本地 ffmpeg/ffprobe，不调用外部 provider。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

function run(cmd, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 600)))
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function probeDuration(ffprobe, file) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  const value = Number(String(stdout).trim())
  if (!Number.isFinite(value) || value <= 0) throw new Error('读不到音频/视频时长')
  return value
}

function parseSilences(stderr) {
  const starts = [...String(stderr).matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...String(stderr).matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  const intervals = []
  for (let i = 0; i < starts.length; i++) {
    const start = Math.max(0, starts[i])
    const end = ends[i] ?? null
    if (end == null || end > start) intervals.push({ start, end })
  }
  return intervals
}

async function extractFrame(ffmpeg, video, at, file) {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', at.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', file,
  ])
}

/**
 * 返回 { duration, silenceIntervals, frames, framesDir }。
 * frames[*].expect 为 closed/open，mouth 留给 UI 或视觉模型填写。
 */
export async function analyzeLipSync({
  video,
  audio,
  outDir,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  noise = '-35dB',
  minSilence = 0.35,
}) {
  if (!fs.existsSync(video)) throw new Error(`视频不存在：${video}`)
  if (audio && !fs.existsSync(audio)) throw new Error(`音频不存在：${audio}`)
  fs.mkdirSync(outDir, { recursive: true })
  const duration = await probeDuration(ffprobe, video)
  const { stderr } = await run(ffmpeg, [
    '-hide_banner', '-i', audio || video,
    '-af', `silencedetect=noise=${noise}:d=${minSilence}`,
    '-f', 'null', '-',
  ])
  const raw = parseSilences(stderr)
  const silenceIntervals = raw
    .map((x) => ({ start: x.start, end: Math.min(duration, x.end ?? duration) }))
    .filter((x) => x.end > x.start)

  const frames = []
  for (const interval of silenceIntervals) {
    const at = Math.min(duration - 0.05, (interval.start + interval.end) / 2)
    const file = path.join(outDir, `silence_${at.toFixed(2)}s.jpg`)
    await extractFrame(ffmpeg, video, at, file)
    frames.push({ at: Number(at.toFixed(2)), kind: 'silence', expect: 'closed', path: file })
  }

  const speechPoints = []
  let prevEnd = 0
  for (const interval of [...silenceIntervals, { start: duration, end: duration }]) {
    if (interval.start - prevEnd > 0.8) {
      speechPoints.push((prevEnd + interval.start) / 2)
    }
    prevEnd = interval.end
  }
  if (speechPoints.length === 0 && duration > 0.3) speechPoints.push(duration * 0.5)
  for (const at of speechPoints) {
    const file = path.join(outDir, `speech_${at.toFixed(2)}s.jpg`)
    await extractFrame(ffmpeg, video, at, file)
    frames.push({ at: Number(at.toFixed(2)), kind: 'speech', expect: 'open', path: file })
  }

  frames.sort((a, b) => a.at - b.at)
  return {
    duration: Number(duration.toFixed(2)),
    silenceIntervals: silenceIntervals.map((x) => ({
      start: Number(x.start.toFixed(2)),
      end: Number(x.end.toFixed(2)),
    })),
    frames,
    framesDir: outDir,
  }
}
