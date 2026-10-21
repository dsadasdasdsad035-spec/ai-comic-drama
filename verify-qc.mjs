/**
 * 一致性质检脚本自检：
 * 1) 同参考图 → ok true，色差/构图接近 0
 * 2) 明显不同的参考（纯蓝）→ ok false，色彩与构图都报警
 * 3) --json 输出结构完整
 * 跑法：node verify-qc.mjs
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'

const run = promisify(execFile)
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const videos = fs.readdirSync('public/videos').filter((f) => f.endsWith('.mp4'))
check('有测试视频', videos.length > 0, String(videos.length))
const video = `public/videos/${videos[0]}`

// 用视频首帧当「同源参考」
await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-frames:v', '1', '/tmp/qc-ref.jpg'])
// 纯蓝图当「不同源参考」
await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-frames:v', '1', '/tmp/qc-blue2.png'])

const qc = async (ref) => {
  const { stdout } = await run('node', ['qc.mjs', '--video', video, '--ref', ref, '--json'])
  return JSON.parse(stdout)
}

const same = await qc('/tmp/qc-ref.jpg')
check('同源参考判断为通过', same.ok === true, JSON.stringify(same.issues))
check('同源色差很小', (same.refs?.[0]?.colorDist ?? 1) < 0.05, String(same.refs?.[0]?.colorDist))
check('同源构图接近', (same.refs?.[0]?.dHash ?? 99) <= 8, String(same.refs?.[0]?.dHash))
check('结构完整（duration/checks/refs）',
  typeof same.duration === 'number' && typeof same.checks?.flicker === 'number' && Array.isArray(same.refs))

const diff = await qc('/tmp/qc-blue2.png')
check('异源参考被报警', diff.ok === false, JSON.stringify(diff.issues).slice(0, 100))
check('色彩报警触发', diff.issues.some((i) => i.includes('色温/明暗')), diff.issues.join(' / '))
check('构图报警触发', diff.issues.some((i) => i.includes('构图差异')), diff.issues.join(' / '))
check('异源色差显著', (diff.refs?.[0]?.colorDist ?? 0) > 0.25, String(diff.refs?.[0]?.colorDist))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
