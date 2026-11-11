/**
 * VGGT POC：mock Worker + 作业报告 + 不写 project。
 * 跑法：node verify-vggt-poc.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = 18765
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const videoFixture = path.join(root, 'fixtures/evidence-scene3d-chat-mp4/output.mp4')
check('测试视频存在', fs.existsSync(videoFixture), videoFixture)
const publicDir = path.join(root, 'public', 'videos')
fs.mkdirSync(publicDir, { recursive: true })
const publicCopy = path.join(publicDir, 'vggt-poc-fixture.mp4')
if (!fs.existsSync(publicCopy)) fs.copyFileSync(videoFixture, publicCopy)
const videoRef = '/videos/vggt-poc-fixture.mp4'

const mock = spawn(process.execPath, [path.join(root, 'workers/vggt/mock-server.mjs')], {
  env: { ...process.env, VGGT_MOCK_PORT: String(PORT) },
  stdio: 'ignore',
})
await sleep(400)

process.env.VGGT_WORKER_URL = `http://127.0.0.1:${PORT}`
delete process.env.VGGT_MOCK_WORKER

const { submitVggtAnalyze, getVggtJob, isVggtAvailable } = await import('./server/vggt.mjs')

check('Worker 可用', isVggtAvailable())

const job = submitVggtAnalyze(root, {
  videoRef,
  sourceKind: 'reference',
  projectAspect: '16:9',
  effectiveSeconds: 6,
  maxFrames: 8,
})
check('作业已创建', Boolean(job?.id), job?.id)

let final = null
for (let i = 0; i < 120; i++) {
  await sleep(500)
  final = getVggtJob(root, job.id)
  if (final?.status === 'completed' || final?.status === 'failed') break
}
check('作业完成', final?.status === 'completed', final?.status || 'timeout')
check('报告 version', final?.report?.version === 1)
check('运动摘要', Boolean(final?.report?.motionSummaryZh?.length))

const reportPath = path.join(root, '.vggt-jobs', job.id, 'report.json')
check('report.json 落盘', fs.existsSync(reportPath))

const { spawnSync } = await import('node:child_process')
const v = spawnSync(process.execPath, ['workers/vggt/validate-report.mjs', reportPath], { cwd: root })
check('schema 校验', v.status === 0, v.stderr?.toString() || '')

delete process.env.VGGT_WORKER_URL
let blocked = false
try {
  submitVggtAnalyze(root, { videoRef })
} catch (e) {
  blocked = e?.code === 'VGGT_NO_WORKER'
}
check('未配置 Worker 拒绝', blocked)

mock.kill('SIGTERM')

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ VGGT POC 校验通过')
process.exit(bad ? 1 : 0)
