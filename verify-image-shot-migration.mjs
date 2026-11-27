/**
 * 生图镜 → 图片素材卡迁移计划
 * 跑法：node verify-image-shot-migration.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-img-mig-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export { planImageShotToAssetCards } from ${abs('src/imageShotMigration.ts')}`,
    `export { assetNodeId } from ${abs('src/canvasLayoutStore.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
const banner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--banner:js=${banner}`,
  `--outfile=${bundle}`,
])
const { planImageShotToAssetCards, assetNodeId } = await import(bundle)

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const baseShots = [
  { id: 'shot-s01', episode: 1, no: 'S01', prod_kind: 'video', keyframe: '/still.jpg', desc: '静帧镜' },
  {
    id: 'shot-s02',
    episode: 1,
    no: 'S02',
    prod_kind: 'image',
    keyframe_prompt: '主角特写',
    keyframe: '/generated/s02.jpg',
    refIds: ['char-阿岚', 'shot-prev'],
    dialogue: [{ speaker: '阿岚', text: '快走' }],
    seconds: 6,
    move: '推轨',
  },
  {
    id: 'shot-s03',
    episode: 1,
    no: 'S03',
    prod_kind: 'video',
    transition_out: { kind: 'crossfade', duration: 0.5, to: 'shot-s02' },
    refIds: ['shot-next'],
  },
]

{
  const plan = planImageShotToAssetCards({ shots: baseShots, assets: [], canvas: [] })
  check('首次迁移产生计划', Boolean(plan), '')
  check('标记置位', plan?.imageShotsToAssetCards === true)
  check('序列移除生图镜', plan?.shots.length === 2, String(plan?.shots.map((s) => s.no)))
  check('S01/S03 镜号保留', plan?.shots.map((s) => s.no).join(',') === 'S01,S03')
  check('接缝指向生图镜被清除', !plan?.shots.find((s) => s.id === 'shot-s03')?.transition_out)
  const card = plan?.assets.find((a) => a.sourceShotId === 'shot-s02')
  check('提示词来自 keyframe_prompt', card?.prompt === '主角特写', card?.prompt)
  check('地址来自 keyframe', card?.url === '/generated/s02.jpg', card?.url)
  check('邻镜 token 不进入素材卡', !card?.refIds?.some((t) => t.startsWith('shot-')), JSON.stringify(card?.refIds))
  check('角色参考保留', card?.refIds?.includes('char-阿岚'), JSON.stringify(card?.refIds))
  check('台词进备注', String(card?.note || '').includes('阿岚'), card?.note)
  check('秒数不写入素材卡', card?.seconds === undefined)
}

{
  const onlyStill = planImageShotToAssetCards({
    shots: [{ id: 'x', episode: 1, no: 'S01', keyframe: '/k.jpg' }],
    assets: [],
  })
  check('仅静帧无 prod_kind 不迁出', onlyStill?.migratedCount === 0 && onlyStill.shots.length === 1)
}

{
  const done = planImageShotToAssetCards({
    shots: baseShots,
    assets: [],
    imageShotsToAssetCards: true,
  })
  check('已迁移则返回 null', done === null)
}

{
  const canvas = [{ key: 'shot:shot-s02', x: 120, y: 80 }]
  const plan = planImageShotToAssetCards({ shots: baseShots, assets: [], canvas })
  const card = plan?.assets.find((a) => a.sourceShotId === 'shot-s02')
  const assetKey = `asset:${card?.canvasId}`
  check('画布坐标迁到素材槽位', plan?.canvas.some((c) => c.key === assetKey && c.x === 120 && c.y === 80))
  const nodeId = assetNodeId(card?.canvasId || '')
  check('素材节点 id 可派生', nodeId.startsWith('asset-'), nodeId)
}

{
  const existing = {
    kind: 'image',
    title: '已有',
    url: '/old.jpg',
    canvasId: 'keep-me',
    sourceShotId: 'shot-s02',
    prompt: '主角特写',
  }
  const plan = planImageShotToAssetCards({
    shots: baseShots,
    assets: [existing],
    canvas: [],
  })
  check('同 sourceShotId 不重复建卡', plan?.assets.length === 1, String(plan?.assets.length))
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)