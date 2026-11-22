#!/usr/bin/env node
/**
 * rea-video 的 mock 可执行文件：只回放预设行为，供 verify 脚本验证作业生命周期。
 *
 * 用环境变量控制行为：
 *   MOCK_REA_MODE=ok        （默认）按当前目录写 out/breakdown.json，退出 0
 *   MOCK_REA_MODE=stall     只打一行然后睡死（触发停滞检测）
 *   MOCK_REA_MODE=fail      打错误后退出 2
 *   MOCK_REA_MODE=slow      分阶段打印后成功（用于并发/排队测试）
 *   MOCK_REA_FIXTURE        指定 fixture breakdown.json 的绝对路径
 *   MOCK_REA_PRINT_ENV=1    打印收到的视觉模型环境变量（键名 + 是否非空，不打值）
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const mode = String(process.env.MOCK_REA_MODE || 'ok')

if (args[0] === '--help') {
  console.log('rea-video 0.1.0 (mock)')
  process.exit(0)
}

if (process.env.MOCK_REA_PRINT_ENV === '1') {
  for (const k of ['REA_VLM_BASE_URL', 'REA_VLM_API_KEY', 'REA_VLM_MODEL']) {
    console.log(`env ${k}=${process.env[k] ? 'set' : 'empty'}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (mode === 'stall') {
  console.log('survey: starting')
  await sleep(600_000)
  process.exit(0)
}

if (mode === 'fail') {
  console.log('Traceback: cv2 error while decoding')
  process.exit(2)
}

console.log('decompose: input.mp4')
if (mode === 'slow') await sleep(400)
console.log('classify: 3 shots')
if (mode === 'slow') await sleep(400)

// -o 后面是输出目录
const oIdx = args.indexOf('-o')
const outDir = oIdx >= 0 ? args[oIdx + 1] : path.join(process.cwd(), 'out')
fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true })

const fixture = process.env.MOCK_REA_FIXTURE
if (fixture && fs.existsSync(fixture)) {
  fs.copyFileSync(fixture, path.join(outDir, 'breakdown.json'))
} else {
  fs.writeFileSync(path.join(outDir, 'breakdown.json'), JSON.stringify({ shots: [], source: {} }))
}
// 证据帧：fixture 提到的三张 + 一张故意缺失（验证「复制失败只影响该镜」）
for (const name of ['shot_001.jpg', 'shot_001_first.jpg', 'shot_002.jpg']) {
  fs.writeFileSync(path.join(outDir, 'shots', name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
}
fs.writeFileSync(path.join(outDir, 'storyboard.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
console.log('report: done')
process.exit(0)
