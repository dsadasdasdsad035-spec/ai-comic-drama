/**
 * 画布水合回归：项目镜头 → 节点/连线必须幂等。
 *
 * 断言点：
 * 1) 同一批 shots 连续水合两次，节点 id 与位置完全一致（不会重置用户拖过的位置）；
 * 2) 素材卡与其他卡不被分镜水合冲掉；
 * 3) 已删镜头的水合不会留下孤儿节点；
 * 4) 顺序边按镜号补齐，转场按 transitionOut 修回；
 * 5) 只有 keyframe_prompt 的镜头照常生成节点（空首帧不拦水合）。
 *
 * 跑法：node verify-canvas-hydrate.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-canvas-hydrate-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

const canvas = await import(bundle('src/canvasShots.ts', 'canvasShots'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shot = (ep, no, extra = {}) => ({
  id: `E${String(ep).padStart(2, '0')}-${no}`,
  episode: ep,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `${no} 描述`,
  dialogue: [],
  cast: [],
  ...extra,
})

const shotsA = [shot(1, 'S01'), shot(1, 'S02'), shot(1, 'S03')]

// ---------------------------------------------------------------- 幂等
const once = canvas.composeShotCanvasNodes([], shotsA)
const twice = canvas.composeShotCanvasNodes(once, shotsA)
check('水合出的节点数等于镜数', once.length === 3, String(once.length))
check(
  '连续水合两次节点 id 一致',
  JSON.stringify(once.map((n) => n.id)) === JSON.stringify(twice.map((n) => n.id)),
)
check(
  '连续水合两次位置一致',
  JSON.stringify(once.map((n) => n.position)) === JSON.stringify(twice.map((n) => n.position)),
)

// 拖过位置后再水合：位置保留
const moved = once.map((n, i) => (i === 1 ? { ...n, position: { x: 999, y: 888 } } : n))
const afterMove = canvas.composeShotCanvasNodes(moved, shotsA)
check('已拖位置不被水合重置', afterMove[1].position.x === 999 && afterMove[1].position.y === 888)

// ---------------------------------------------------------------- 素材卡保留
const withAsset = [
  { id: 'asset-1', type: 'asset', position: { x: 10, y: 10 }, data: { title: '场景', kind: 'scene' } },
  ...once,
]
const keptAsset = canvas.composeShotCanvasNodes(withAsset, shotsA)
check('素材卡在水合后保留', keptAsset.some((n) => n.id === 'asset-1'))

// 示例卡（无 shotId、id 形如 S01）在有真实镜头后退场
const demo = [{ id: 'S01', type: 'shot', position: { x: 0, y: 0 }, data: { no: 'S01', seconds: 3 } }]
check('出现真实镜头后示例卡退场', canvas.composeShotCanvasNodes(demo, shotsA).every((n) => n.data.shotId))

// ---------------------------------------------------------------- 删除不复活
const afterDelete = canvas.composeShotCanvasNodes(once, [shotsA[0], shotsA[2]])
check(
  '删掉 S02 后节点同步减少',
  afterDelete.length === 2 && !afterDelete.some((n) => n.data.shotId === shotsA[1].id),
  String(afterDelete.length),
)

// ---------------------------------------------------------------- 连线
const edges = canvas.composeShotCanvasEdges([], once)
check('顺序边补齐到 N-1 条', edges.length === 2, String(edges.length))
check(
  '顺序边方向按镜号',
  edges[0].source === once[0].id && edges[0].target === once[1].id,
)

const withTransition = [
  { ...once[0], data: { ...once[0].data, transitionOut: { to: shotsA[1].id } } },
  once[1],
  once[2],
]
const repaired = canvas.composeShotCanvasEdges([], withTransition)
const first = repaired.find((e) => e.source === withTransition[0].id && e.target === withTransition[1].id)
check('transitionOut 修回为转场边', first?.data?.relation === 'transition')

// ---------------------------------------------------------------- 空首帧
const structural = [shot(1, 'S01', { desc: '只有描述' }), shot(1, 'S02', { desc: '只有描述' })]
const structuralNodes = canvas.composeShotCanvasNodes([], structural)
check('只有结构（无 keyframe_prompt）的镜头也生成节点', structuralNodes.length === 2)
check(
  '无首帧提示词时节点仍在画布上',
  structuralNodes.every((n) => n.data.shotId && n.type === 'shot'),
)

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
