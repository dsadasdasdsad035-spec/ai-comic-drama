/**
 * 转场边界帧抽取验证：尾帧必须是成片的「最后一帧」，首帧必须是「第 0 帧」。
 *
 * 验什么：
 * 1) 30fps/60 帧、24fps/29 帧、0.6 秒短片三种片，`times:[-0.1]` 抽到的都是各自末帧，
 *    不是倒数第 2/3 帧（旧实现会落空 1~3 帧）。
 * 2) `times:[0]` 抽到的是第 0 帧。
 * 3) 响应里 `stats` 与 `urls`/`times` 等长且按下标对齐，`yavg` 是可用的数值。
 * 4) 以纯黑收尾的成片，尾帧 `stats.dark === true`。
 *
 * 帧号判定：测试片每帧亮度 = 40 + 帧号*3（整片都高于近黑阈值），先把整片逐帧导出成无损 PNG
 * 建「帧号 → YAVG」表，再把接口抽到的 jpg 亮度在表里找最近项。这样不依赖
 * 色彩空间/JPEG 压缩的具体缩放，任何转码都只是整体平移，仍然判得准。
 *
 * 跑法：APP_URL=http://127.0.0.1:5273 node verify-boundary-frames.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { requireServer } from './verify-lib.mjs'

const APP = await requireServer()
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FFPROBE = process.env.FFPROBE || 'ffprobe'
/** 与 server/app.ts 一致：媒体根可用 SB_MEDIA_ROOT 覆盖 */
const MEDIA_ROOT = process.env.SB_MEDIA_ROOT ? path.resolve(process.env.SB_MEDIA_ROOT) : path.join(process.cwd(), 'public')
const GEN_DIR = path.join(MEDIA_ROOT, 'generated')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-frames-'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const run = (bin, args) => execFileSync(bin, args, { stdio: 'ignore' })

/** 整片平均亮度（YAVG） */
const yavg = (file) =>
  Number(
    execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `movie=${file},signalstats`,
        '-show_entries',
        'frame_tags=lavfi.signalstats.YAVG',
        '-of',
        'default=nw=1:nk=1',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean),
  )

const frameCount = (file) =>
  Number(
    execFileSync(
      FFPROBE,
      ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', file],
      { encoding: 'utf8' },
    ).trim(),
  )

/** 亮度 = 40 + 帧号*3 的测试片（既单调可区分，又不会落到近黑阈值下）；`-g 250` 让全片只有一个关键帧，贴真实成片 */
function makeRamp(file, fps, seconds, extra = []) {
  run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=320x180:r=${fps}:d=${seconds}`,
    '-vf',
    "geq=lum='40+N*3':cb=128:cr=128",
    ...extra,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '250',
    file,
  ])
}

/** 帧号 → 该帧的真实亮度（逐帧导出无损 PNG 后测量） */
function buildLumaTable(video, frames) {
  const dir = fs.mkdtempSync(path.join(TMP, 'all-'))
  run(FFMPEG, ['-v', 'error', '-y', '-i', video, '-fps_mode', 'passthrough', path.join(dir, 'f-%04d.png')])
  const table = []
  for (let i = 0; i < frames; i++) {
    const f = path.join(dir, `f-${String(i + 1).padStart(4, '0')}.png`)
    table.push(yavg(f))
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return table
}

/** 在表里找亮度最接近的帧号 */
const nearestFrame = (table, v) => {
  let best = -1
  let bestDiff = Infinity
  table.forEach((lv, i) => {
    const d = Math.abs(lv - v)
    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
  })
  return { frame: best, diff: bestDiff }
}

const apiFrames = async (video, times) => {
  const r = await fetch(`${APP}/api/frames`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video, times }),
  })
  return { status: r.status, ...(await r.json().catch(() => ({}))) }
}

const created = []
const put = (src, name) => {
  fs.mkdirSync(GEN_DIR, { recursive: true })
  const dst = path.join(GEN_DIR, name)
  fs.copyFileSync(src, dst)
  created.push(dst)
  return `/generated/${name}`
}

try {
  const cases = [
    { name: 'f30', fps: 30, seconds: 2 },
    { name: 'f24', fps: 24, seconds: 1.2 },
    { name: 'f06', fps: 30, seconds: 0.6 },
  ]

  for (const c of cases) {
    const local = path.join(TMP, `${c.name}.mp4`)
    makeRamp(local, c.fps, c.seconds)
    const frames = frameCount(local)
    const table = buildLumaTable(local, frames)
    const url = put(local, `verify-boundary-${c.name}.mp4`)

    const tail = await apiFrames(url, [-0.1])
    const head = await apiFrames(url, [0])
    const tailFile = tail.urls?.[0] ? path.join(MEDIA_ROOT, tail.urls[0].replace(/^\//, '')) : ''
    const headFile = head.urls?.[0] ? path.join(MEDIA_ROOT, head.urls[0].replace(/^\//, '')) : ''

    const tailHit = tailFile && fs.existsSync(tailFile) ? nearestFrame(table, yavg(tailFile)) : { frame: -1, diff: NaN }
    const headHit = headFile && fs.existsSync(headFile) ? nearestFrame(table, yavg(headFile)) : { frame: -1, diff: NaN }

    check(
      `${c.name}（${c.fps}fps/${frames} 帧）尾帧是末帧`,
      tailHit.frame === frames - 1,
      `抽到第 ${tailHit.frame} 帧，期望第 ${frames - 1} 帧`,
    )
    check(`${c.name} 首帧是第 0 帧`, headHit.frame === 0, `抽到第 ${headHit.frame} 帧`)
    check(
      `${c.name} stats 与 urls/times 对齐`,
      tail.ok === true && tail.stats?.length === tail.urls?.length && tail.stats?.length === tail.times?.length,
      `urls=${tail.urls?.length} times=${tail.times?.length} stats=${tail.stats?.length}`,
    )
    check(
      `${c.name} stats 带可用亮度且非近黑`,
      typeof tail.stats?.[0]?.yavg === 'number' && tail.stats[0].dark === false,
      JSON.stringify(tail.stats),
    )
  }

  // 淡出黑场收尾：真末帧就是黑的，要照用并标记 dark
  const darkLocal = path.join(TMP, 'dark.mp4')
  makeRamp(darkLocal, 30, 2, ['-vf', "geq=lum='if(lt(N\\,45)\\,200\\,0)':cb=128:cr=128"])
  const darkUrl = put(darkLocal, 'verify-boundary-dark.mp4')
  const dark = await apiFrames(darkUrl, [0, -0.1])
  check(
    '黑场收尾片：尾帧标记为 near-black',
    dark.ok === true && dark.stats?.[1]?.dark === true,
    JSON.stringify(dark.stats),
  )
  check(
    '黑场收尾片：首帧不是近黑',
    dark.stats?.[0]?.dark === false,
    JSON.stringify(dark.stats?.[0]),
  )
} finally {
  for (const f of created) fs.rmSync(f, { force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
