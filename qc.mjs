/**
 * 一致性质检（不依赖外网）：用 ffmpeg 抽帧到 64×64 RGB，算三类客观指标。
 *
 *   node qc.mjs --video public/videos/x.mp4 --ref public/generated/char.jpg [--json]
 *   node qc.mjs --shot E01-S01 [--project recycle]      # 从项目里取该镜的视频/首帧与角色参考
 *
 * 指标与门限：
 *   1. 色彩距离 colorDist（0~1，>0.25 报警）—— 与参考图平均色 + 通道分布差异
 *   2. 构图差异 dHash（0~64，>24 报警）—— 8×8 灰度感知哈希汉明距离
 *   3. 帧间稳定性 flicker（0~1，>0.35 报警）—— 视频相邻抽帧的平均像素差
 *
 * 说明：人脸身份相似度需要人脸模型，本脚本不做；用「色彩 + 构图 + 稳定性」做机器初筛，
 * 人脸/手指/穿模仍要人工抽检。指标越界只是「可疑」，不是判定失败。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'

const run = promisify(execFile)
const SIDE = 64

const args = process.argv.slice(2)
const opt = (name, def = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] ?? def : def
}
const flag = (name) => args.includes(`--${name}`)

/** 用 ffmpeg 把任意输入（图片/视频某一秒）解成 64×64 RGB 原始帧 */
async function frameOf(input, ss) {
  const a = ['-v', 'error']
  if (ss !== undefined) a.push('-ss', String(ss))
  a.push('-i', input, '-frames:v', '1', '-vf', `scale=${SIDE}:${SIDE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
  const { stdout } = await run('ffmpeg', a, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
  if (stdout.length < SIDE * SIDE * 3) throw new Error(`抽帧失败：${input}`)
  return stdout.subarray(0, SIDE * SIDE * 3)
}

async function durationOf(input) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', input,
    ])
    return Number(stdout.trim()) || 0
  } catch {
    return 0
  }
}

const avgColor = (buf) => {
  let r = 0, g = 0, b = 0
  const n = SIDE * SIDE
  for (let i = 0; i < n; i++) {
    r += buf[i * 3]
    g += buf[i * 3 + 1]
    b += buf[i * 3 + 2]
  }
  return [r / n, g / n, b / n]
}

/** 0~1：平均色差（欧氏距离 / 最大距离） */
const colorDist = (a, b) => {
  const [ar, ag, ab] = avgColor(a)
  const [br, bg, bb] = avgColor(b)
  return Math.round((Math.hypot(ar - br, ag - bg, ab - bb) / 441.67) * 1000) / 1000
}

/** 8×8 灰度差分哈希，返回汉明距离（0~64） */
function dHash(buf) {
  const gray = new Float64Array(SIDE * SIDE)
  for (let i = 0; i < SIDE * SIDE; i++) {
    gray[i] = buf[i * 3] * 0.299 + buf[i * 3 + 1] * 0.587 + buf[i * 3 + 2] * 0.114
  }
  // 降采样到 9×8
  const cell = SIDE / 8
  const small = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      let s = 0, c = 0
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          s += gray[(y * cell + dy) * SIDE + (x * cell + dx)]
          c++
        }
      }
      small.push(s / c)
    }
  }
  const bits = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits.push(small[y * 9 + x] > small[y * 9 + x + 1] ? 1 : 0)
  }
  return bits
}
const hamming = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0)

/** 0~1：两帧平均像素差 */
const frameDiff = (a, b) => {
  let s = 0
  for (let i = 0; i < SIDE * SIDE * 3; i++) s += Math.abs(a[i] - b[i])
  return Math.round((s / (SIDE * SIDE * 3) / 255) * 1000) / 1000
}

const resolveLocal = (u, root) => {
  if (!u) return ''
  if (/^https?:/.test(u)) return u
  const p = u.startsWith('/') ? path.join(root, 'public', u.replace(/^\//, '')) : u
  return fs.existsSync(p) ? p : ''
}

async function main() {
  const projectName = opt('project', 'recycle')
  const root = process.cwd()
  let video = opt('video')
  let refs = args.includes('--ref') ? [opt('ref')] : []
  let label = video || '(项目镜头)'

  if (!video && opt('shot')) {
    // 从项目里取：该镜的 clip / keyframe + 出场角色图
    const j = await fetch(`http://localhost:5273/api/project?name=${projectName}`).then((r) => r.json())
    const shot = (j.project?.shots ?? []).find((s) => s.no === opt('shot'))
    if (!shot) throw new Error(`找不到镜头 ${opt('shot')}`)
    video = resolveLocal(shot.clip, root)
    const kf = resolveLocal(shot.keyframe, root)
    if (kf) refs.push(kf)
    for (const name of shot.cast ?? []) {
      const c = (j.project.characters ?? []).find((x) => x.name === name)
      const img = resolveLocal(c?.image, root)
      if (img) refs.push(img)
    }
    label = `${projectName} ${shot.no}`
    if (!video) throw new Error('这个镜头还没有视频产物（先出片）')
  }

  if (!video) {
    console.error('用法：node qc.mjs --video <mp4> [--ref <图片>]…  |  node qc.mjs --shot E01-S01')
    process.exit(2)
  }
  if (!fs.existsSync(video) && !/^https?:/.test(video)) throw new Error(`视频不存在：${video}`)

  const dur = await durationOf(video)
  const times = dur > 1.5 ? [0.15, dur * 0.5, Math.max(0.16, dur - 0.25)] : [0]
  const frames = []
  for (const t of times) frames.push(await frameOf(video, t))

  const report = { target: label, duration: Math.round(dur * 100) / 100, checks: {}, refs: [], issues: [] }

  // 稳定性：相邻抽帧差异
  let flick = 0
  for (let i = 1; i < frames.length; i++) flick = Math.max(flick, frameDiff(frames[i - 1], frames[i]))
  report.checks.flicker = flick
  if (flick > 0.35) report.issues.push(`帧间跳变偏大（${flick}）—— 动作可能不连贯或闪烁`)

  // 与参考图比对（色彩 + 构图）
  const first = frames[0]
  const fh = dHash(first)
  for (const r of refs) {
    if (!r || !fs.existsSync(r)) continue
    const rf = await frameOf(r)
    const cd = colorDist(first, rf)
    const dh = hamming(fh, dHash(rf))
    report.refs.push({ ref: path.basename(r), colorDist: cd, dHash: dh })
    if (cd > 0.25) report.issues.push(`${path.basename(r)}：色温/明暗差异大（${cd}）—— 可能不是同一场景/光线`)
    if (dh > 24) report.issues.push(`${path.basename(r)}：构图差异大（${dh}/64）—— 参考没生效？`)
  }
  report.ok = report.issues.length === 0

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`\n质检：${label}  时长 ${report.duration}s`)
  console.log(`  帧间稳定性 flicker=${flick}（>0.35 报警）`)
  for (const r of report.refs) {
    console.log(`  参考 ${r.ref}  色彩距离=${r.colorDist}（>0.25 报警）  构图 dHash=${r.dHash}/64（>24 报警）`)
  }
  if (report.ok) console.log('  ✅ 客观指标未见异常（人脸/手指/穿模仍需人工抽检）')
  else for (const i of report.issues) console.log(`  ⚠️ ${i}`)
  console.log('')
}

main().catch((e) => {
  console.error('质检失败：', e.message)
  process.exit(1)
})
