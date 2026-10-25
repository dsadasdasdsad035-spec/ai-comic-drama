/**
 * Blender 渲染宿主验收（任务 2.1–2.7）。
 * 需要 dev server：APP_URL=http://127.0.0.1:5274 node verify-blender-host.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.APP_URL || 'http://127.0.0.1:5274'
const ROOT = path.resolve(import.meta.dirname)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SCENE = `import bpy
from mathutils import Vector

_state = {}

def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def build(ctx):
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 1))
    obj = bpy.context.active_object
    path = ctx.asset("probe:image")
    if path:
        img = bpy.data.images.load(path)
        mat = bpy.data.materials.new("Probe")
        mat.use_nodes = True
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        obj.data.materials.append(mat)
    light = bpy.data.objects.new("Key", bpy.data.lights.new("Key", type='SUN'))
    light.data.energy = 3
    ctx.scene.collection.objects.link(light)
    light.location = (2, -3, 4)
    _look_at(light, (0, 0, 1))
    ctx.camera.location = (0, -6, 2)
    _look_at(ctx.camera, (0, 0, 1))
    _state["obj"] = obj

def pose(t, mode):
    obj = _state.get("obj")
    if obj:
        obj.rotation_euler[2] = t * 1.5

def dispose():
    pass
`

async function json(url, init) {
  const res = await fetch(`${BASE}${url}`, init)
  return res.json()
}

function post(url, body) {
  return json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const health = await json('/api/blender/health')
check('健康检查返回路径与版本', health.ok && Boolean(health.path) && Boolean(health.version), `${health.version}`)

const badParam = await post('/api/blender/render', { code: SCENE, duration: 0, width: 320, height: 180, fps: 30 })
check('非法时长被拒绝', badParam.ok === false && /时长/.test(badParam.message || ''), badParam.message)
const badCode = await post('/api/blender/render', { code: '', duration: 2, width: 320, height: 180, fps: 30 })
check('空代码被拒绝', badCode.ok === false, badCode.message)
const badTier = await post('/api/blender/render', { code: SCENE, duration: 2, width: 320, height: 180, fps: 30, tier: 'ultra' })
check('非法档位被拒绝', badTier.ok === false && /档位/.test(badTier.message || ''), badTier.message)

// 素材：写一张测试图进 public/generated
const genDir = path.join(ROOT, 'public', 'generated')
fs.mkdirSync(genDir, { recursive: true })
const probeName = `probe-${Date.now()}.png`
const probePath = path.join(genDir, probeName)
fs.writeFileSync(
  probePath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)
const probeHash = crypto.createHash('sha256').update(fs.readFileSync(probePath)).digest('hex')

const body = {
  code: SCENE,
  duration: 10 / 30,
  width: 320,
  height: 180,
  fps: 30,
  tier: 'final',
  engine: 'workbench',
  samples: 4,
  times: Array.from({ length: 10 }, (_, i) => i / 30),
  assets: [
    { key: 'probe:image', kind: 'image', label: '测试图', url: `/generated/${probeName}` },
    { key: 'probe:missing', kind: 'image', label: '缺失图', url: '/generated/does-not-exist.png' },
  ],
}

// 并发：三个作业，第 3 个应排队
const jobs = []
for (let i = 0; i < 3; i++) {
  const r = await post('/api/blender/render', body)
  if (!r.ok) {
    check('提交作业', false, r.message)
    process.exit(1)
  }
  jobs.push(r.job)
}
const thirdQueued = await json(`/api/blender/progress?id=${jobs[2].id}`)
check('并发上限 2：第 3 个作业排队', thirdQueued.job.status === 'queued', thirdQueued.job.status)
const dirs = fs.readdirSync(path.join(ROOT, '.blender-jobs')).filter((d) => jobs.some((j) => j.id === d))
check('三个作业目录互不重叠', dirs.length === 3)

// 等全部完成
async function wait(id, timeoutMs = 240_000) {
  const start = Date.now()
  for (;;) {
    const r = await json(`/api/blender/progress?id=${id}`)
    if (r.job.status === 'done' || r.job.status === 'error' || r.job.status === 'cancelled') return r.job
    if (Date.now() - start > timeoutMs) return { ...r.job, status: 'timeout' }
    await sleep(300)
  }
}
const done = await Promise.all(jobs.map((j) => wait(j.id)))
check(
  '三个作业全部完成',
  done.every((j) => j.status === 'done'),
  done.map((j) => j.status).join(','),
)
check('产物有 mp4 与关键帧', done.every((j) => j.videoUrl && j.frameUrls.length === 3))
check('缺失素材被报告', done[0].missingAssets.some((m) => m.key === 'probe:missing'))
check('素材渲染成功（贴图已加载）', done[0].status === 'done')
const newHash = crypto.createHash('sha256').update(fs.readFileSync(probePath)).digest('hex')
check('原始素材未被修改', newHash === probeHash)

const mp4Path = path.join(ROOT, 'public', done[0].videoUrl.replace(/^\//, ''))
const stat = fs.existsSync(mp4Path) ? fs.statSync(mp4Path) : null
check('mp4 落盘', Boolean(stat && stat.size > 1024), stat ? `${stat.size}B` : 'missing')

// 取消：提交一个较长的作业后取消
const long = await post('/api/blender/render', {
  ...body,
  duration: 60 / 30,
  width: 960,
  height: 540,
  times: Array.from({ length: 60 }, (_, i) => i / 30),
  assets: [],
})
check('提交长作业', long.ok)
await sleep(800)
const cancelled = await post('/api/blender/cancel', { id: long.job.id })
check('取消返回 cancelled', cancelled.ok && cancelled.job.status === 'cancelled', cancelled.job?.status)
await sleep(1200)
const after = await json(`/api/blender/progress?id=${long.job.id}`)
check('取消后状态保持 cancelled', after.job.status === 'cancelled')
check('取消后作业目录被清理', !fs.existsSync(path.join(ROOT, '.blender-jobs', long.job.id)))

// 语法错误：必须带出问题行，便于定位到底哪一行不是 Python
const syntaxJob = await post('/api/blender/render', {
  code: 'let S;\nfunction init(ctx) {}\ndef build(ctx):\n    pass\ndef pose(t, mode):\n    pass',
  duration: 2 / 30,
  width: 320,
  height: 180,
  fps: 30,
  tier: 'trial',
  engine: 'workbench',
  times: [0, 2 / 30],
})
const syntaxDone = await wait(syntaxJob.job.id)
check(
  '语法错误带出问题行',
  syntaxDone.status === 'error' && /语法错误（第 1 行）/.test(syntaxDone.error || '') && /let S;/.test(syntaxDone.error || ''),
  syntaxDone.error,
)

// 清理测试图
try {
  fs.unlinkSync(probePath)
} catch {
  /* ignore */
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
