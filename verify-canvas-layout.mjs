/**
 * 画布落位的回归：分区、栅格、避让、顺序、整理。
 *
 * 跑法：node verify-canvas-layout.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-canvas-layout-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/canvasLayout.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/canvasShots.ts'))}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const overlap = (a, b, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

const rectOf = (n, kind, seconds) => lib.nodeRect(kind, n.position, seconds === undefined ? undefined : { seconds })
const anyOverlap = (rects) => {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (overlap(rects[i], rects[j])) return [i, j]
  return null
}

/* ---------------------------------------------- 1. 宽窄混排不重叠 */
const mixed = [
  { id: 'a', no: 'S01', episode: 1, seconds: 8 },
  { id: 'b', no: 'S02', episode: 1, seconds: 8 },
  { id: 'c', no: 'S03', episode: 1, seconds: 8 },
  { id: 'd', no: 'S04', episode: 1, seconds: 3 },
]
const mixedNodes = lib.buildShotNodes([], mixed)
const mixedRects = mixedNodes.map((n) => rectOf(n, 'shot', Number(n.data.seconds)))
const mixedHit = anyOverlap(mixedRects)
check('长镜后接短镜不重叠', mixedHit === null, mixedHit ? `第 ${mixedHit[0] + 1} 与第 ${mixedHit[1] + 1} 张相交` : '')
check('列宽按已占用宽度累加', mixedNodes[3].position.x >= mixedNodes[2].position.x + mixedRects[2].w,
  `S04.x=${mixedNodes[3].position.x} S03.right=${mixedNodes[2].position.x + mixedRects[2].w}`)

/* ---------------------------------------------- 2. 落位顺序不随数组顺序漂移 */
const shuffled = [mixed[3], mixed[1], mixed[0], mixed[2]]
const shuffledNodes = lib.buildShotNodes([], shuffled)
const byId = new Map(shuffledNodes.map((n) => [n.data.shotId ?? n.data.no, n]))
const posOf = (no) => shuffledNodes.find((n) => n.data.no === no)?.position ?? { x: -1, y: -1 }
check('镜号小的先落位', posOf('S01').x === 0 && posOf('S02').x > posOf('S01').x,
  `S01=${posOf('S01').x} S02=${posOf('S02').x}`)
check('打乱数组顺序仍按镜号落位', posOf('S04').x > posOf('S03').x, `S04=${posOf('S04').x} S03=${posOf('S03').x}`)
check('镜号带数字感知（S02 在 S10 之前）', lib.compareShotNo('S02', 'S10') < 0)
check('单镜写回后新增镜头不提前', (() => {
  const before = lib.buildShotNodes([], mixed)
  const s05 = { id: 'e', no: 'S05', episode: 1, seconds: 3 }
  // 写回把命中镜提到数组最前，新增镜排在最后
  const after = lib.buildShotNodes(before, [s05, ...mixed])
  const p1 = before.find((n) => n.data.no === 'S04').position
  const p2 = after.find((n) => n.data.no === 'S04').position
  const p5 = after.find((n) => n.data.no === 'S05').position
  return p1.x === p2.x && p5.x > p2.x
})())

/* ---------------------------------------------- 3. 已有位置不被改写 */
const pinned = [{ id: 'n-a', type: 'shot', position: { x: 9999, y: 8888 }, data: { shotId: 'a', no: 'S01', episode: 1, seconds: 8 } }]
const pinnedNodes = lib.buildShotNodes(pinned, mixed)
check('拖动过的分镜位置保留', pinnedNodes[0].position.x === 9999 && pinnedNodes[0].position.y === 8888)
check('同 shotId 节点被复用而不是新建', pinnedNodes[0].id === 'n-a')

/* ---------------------------------------------- 4. 同类型新卡避让 */
const assetPeers = []
for (let i = 0; i < 14; i++) {
  const p = lib.placeNewNode('asset', assetPeers)
  assetPeers.push(lib.nodeRect('asset', p))
}
check('连续新增素材卡不重合', anyOverlap(assetPeers) === null, anyOverlap(assetPeers) ? '存在相交' : '')
check('新增素材卡不是同一个点', new Set(assetPeers.map((r) => `${r.x},${r.y}`)).size === assetPeers.length)

const charPeers = []
for (let i = 0; i < 8; i++) {
  const p = lib.placeNewNode('char', charPeers)
  charPeers.push(lib.nodeRect('char', p))
}
check('角色卡横排不重合', anyOverlap(charPeers) === null)
check('角色卡同一条水平线', new Set(charPeers.map((r) => r.y)).size === 1)

/* ---------------------------------------------- 5. 三区不交叉 */
const assetBand = []
for (let i = 0; i < 60; i++) assetBand.push(lib.nodeRect('asset', lib.assetSlotPosition(i)))
check('素材带全在分镜带之上', assetBand.every((r) => r.y + r.h <= 0),
  `最高到 y=${Math.max(...assetBand.map((r) => r.y + r.h))}`)
check('素材带内部不重合', anyOverlap(assetBand) === null)

const charBand = []
for (let i = 0; i < 20; i++) charBand.push(lib.nodeRect('char', lib.charSlotPosition(i)))
check('角色带不压素材带', !assetBand.some((a) => charBand.some((c) => overlap(a, c))),
  `char.y=${charBand[0].y} char.bottom=${charBand[0].y + charBand[0].h}`
)
check('回填的素材卡与分镜带分开', (() => {
  const hydrated = lib.buildShotNodes([], [])
  const assets = [0, 1, 2, 3, 4, 5].map((i) => lib.nodeRect('asset', lib.assetSlotPosition(i)))
  return hydrated.length === 0 && assets.every((r) => r.y + r.h <= 0)
})())

/* ---------------------------------------------- 6. 整理画布 */
const arrangeItems = [
  { id: 'shot-d', kind: 'shot', episode: 1, no: 'S04', seconds: 3, x: 500, y: 900, w: 250, h: 230 },
  { id: 'shot-a', kind: 'shot', episode: 1, no: 'S01', seconds: 8, x: 700, y: 900, w: 380, h: 305 },
  { id: 'shot-b', kind: 'shot', episode: 1, no: 'S02', seconds: 8, x: 10, y: 10, w: 380, h: 305 },
  { id: 'asset-1', kind: 'asset', x: 42, y: 42, w: 200, h: 150 },
  { id: 'asset-2', kind: 'asset', x: 43, y: 44, w: 200, h: 150 },
  { id: 'char-1', kind: 'char', x: 1, y: 2, w: 120, h: 150 },
  { id: 'char-2', kind: 'char', x: 3, y: 4, w: 120, h: 150 },
]
const arranged = lib.arrangeAll(arrangeItems)
check('整理后分镜按镜号归位', arranged.get('shot-a').x === 0 && arranged.get('shot-b').x > 0)
check('整理后分镜按镜号顺序', arranged.get('shot-a').x < arranged.get('shot-b').x && arranged.get('shot-b').x < arranged.get('shot-d').x)
check('整理后素材卡不再重合', (() => {
  const a = { ...arranged.get('asset-1'), w: 200, h: 150 }
  const b = { ...arranged.get('asset-2'), w: 200, h: 150 }
  return !overlap(a, b)
})())
check('整理后角色卡不重合', (() => {
  const a = { ...arranged.get('char-1'), w: 120, h: 150 }
  const b = { ...arranged.get('char-2'), w: 120, h: 150 }
  return !overlap(a, b)
})())
const arrangedAgain = lib.arrangeAll(
  arrangeItems.map((i) => ({ ...i, ...(arranged.get(i.id) ?? {}) })),
)
check('整理可重复执行（第二次结果相同）',
  arrangeItems.every((i) => arranged.get(i.id).x === arrangedAgain.get(i.id).x && arranged.get(i.id).y === arrangedAgain.get(i.id).y))

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
