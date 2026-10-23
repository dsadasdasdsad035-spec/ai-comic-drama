/**
 * 每镜 ShotScene / 旧布局迁移 / 上一镜种子 / 连续性 / visualBrief 持久化回归。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-shot-scene-api.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const STAMP = Date.now()
const A = `vshots-${STAMP}`
const B = `vshotsb-${STAMP}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-shots-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shotScene.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const shots = await import(bundle)

const legacy = {
  id: 'E01-SC01',
  episode: 1,
  sceneNo: 1,
  sceneSlug: '井道',
  w: 10,
  h: 8,
  walls: [{ id: 'w1', x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18, openings: [{ at: 6, width: 1, height: 2.1, kind: 'door' }] }],
  props: [],
  zones: [],
  source: 'manual',
}
const resolved = shots.resolveShotScene(
  { no: 'S02', seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [], episode: 1, sceneNo: 1 },
  { shotId: 'E01-S02', sceneLayouts: [legacy], episode: 1, sceneNo: 1, sceneSlug: '井道' },
)
check('旧场次布局懒迁移', resolved.migrated && resolved.scene.id === 'E01-S02' && resolved.scene.source === 'legacy')
const before = legacy.walls[0].x2
resolved.scene.walls[0].x2 = 99
check('迁移得到独立副本', legacy.walls[0].x2 === before, `${legacy.walls[0].x2}`)

const blocking = {
  keys: [{ t: 0, actors: [{ name: 'A', x: 0.3, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.9, lookX: 0.3, lookY: 0.5, height: 1.6, fov: 45 } }],
  source: 'manual',
}
const projectShots = [
  { id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '井道', shot_scene: { ...legacy, id: 'E01-S01', seedFrom: undefined }, shot_blocking: blocking },
  { id: 'E01-S02', episode: 1, no: 'S02', scene_no: 1, scene_slug: '井道' },
  { id: 'E01-S03', episode: 1, no: 'S03', scene_no: 2, scene_slug: '走廊' },
]
const prev = shots.previousShotFor(projectShots, 'E01-S02', [legacy])
check('同场上一镜作为种子', prev?.shot.id === 'E01-S01' && prev.scene.id === 'E01-S01')
check('跨场次不拿种子', shots.previousShotFor(projectShots, 'E01-S03', [legacy]) === null)

const changed = { ...resolved.scene, w: 14, walls: [] }
const warnings = shots.continuityWarnings(changed, { ...legacy, id: 'E01-S01' }, 'E01-S01')
check('尺寸差异警告', warnings.some((w) => w.kind === 'size'), JSON.stringify(warnings))
check('墙体/门差异警告', warnings.some((w) => w.kind === 'wall') || warnings.some((w) => w.kind === 'opening'), JSON.stringify(warnings))

const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const create = async (name) => {
  await api(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: name }),
  })
}
const post = (name, body) => api(`/api/project?name=${encodeURIComponent(name)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
await create(A)
await create(B)
const sceneA = { ...legacy, id: 'E01-S01' }
const visual = {
  version: 1, usedVision: true,
  subjects: [{ name: 'A', screen: 'left', depth: 'mid' }],
  visible: [{ kind: 'door', side: 'right', description: '门在右侧' }],
  composition: '主体偏左',
}
const meta = { version: 1, fingerprint: 'fp123', usedVision: true, modelKey: 'test-vision', createdAt: new Date().toISOString() }
await post(A, {
  sceneLayouts: [legacy],
  shots: [{
    id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '井道',
    seconds: 3, cast: ['A'], keyframe_prompt: 'x', shot_scene: sceneA, shot_scene_seed: 'E00-S09',
    visual_brief: visual, visual_brief_meta: meta, shot_blocking: blocking,
  }],
})
const a = (await api(`/api/project?name=${encodeURIComponent(A)}`)).project
const s = a.shots.find((x) => x.id === 'E01-S01')
check('shot_scene 往返', s?.shot_scene?.w === 10 && s?.shot_scene?.id === 'E01-S01')
check('shotSceneSeed 往返', s?.shot_scene_seed === 'E00-S09')
check('visualBrief 往返', s?.visual_brief?.subjects?.[0]?.screen === 'left' && s?.visual_brief_meta?.usedVision === true)
await post(B, { sceneLayouts: [{ ...legacy, id: 'E01-SC02', sceneNo: 2, w: 20 }], shots: [{ id: 'E01-S01', episode: 1, no: 'S01', scene_no: 2, seconds: 3, shot_scene: { ...legacy, id: 'E01-S01', w: 20 } }] })
const b = (await api(`/api/project?name=${encodeURIComponent(B)}`)).project
check('项目 A/B 场景隔离', a.sceneLayouts?.[0]?.w === 10 && b.sceneLayouts?.[0]?.w === 20)
check('镜头空间按项目隔离', s?.shot_scene?.w === 10 && b.shots?.[0]?.shot_scene?.w === 20)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
