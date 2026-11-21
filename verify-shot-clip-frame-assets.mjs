/**
 * 成片首尾帧素材卡：纯函数回归（幂等、refIds、邻镜）。
 * 跑法：node verify-shot-clip-frame-assets.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-clip-frame-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/clipFrameAssets.ts')}`,
    `export * from ${abs('src/clipFrameRef.ts')}`,
    `export * from ${abs('src/clipBoundaryFrames.ts')}`,
    `export { SHOT_PREV } from ${abs('src/shotReferences.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

const check = (name, ok, detail = '') => {
  if (!ok) {
    console.error(`FAIL ${name}`, detail)
    process.exitCode = 1
  } else {
    console.log(`OK ${name}`)
  }
}

const assets1 = [
  {
    kind: 'image',
    title: 'A',
    url: '/generated/a.jpg',
    sourceShotId: 'E01-S01',
    frameRole: 'tail',
    canvasId: 'abc',
  },
]
const next = lib.mergeClipFrameIntoAssets(assets1, {
  kind: 'image',
  title: 'A2',
  url: '/generated/b.jpg',
  sourceShotId: 'E01-S01',
  frameRole: 'tail',
  canvasId: 'abc',
})
check('覆盖幂等只保留一张', next.length === 1 && next[0].url === '/generated/b.jpg', JSON.stringify(next))
check('覆盖保留 canvasId', next[0].canvasId === 'abc')

const nodes = [
  { id: 'S2', type: 'shot', data: { shotId: 'E01-S02', no: 'S02', episode: 1 } },
  { id: 'S1', type: 'shot', data: { shotId: 'E01-S01', no: 'S01', episode: 1 } },
]
const target = nodes[0]
const link = lib.linkPrevTailRefIds(nodes, target, 'asset-abc')
check('link refIds ok', link.ok && link.refIds.includes('asset-abc'))
check('link 不写 shot-prev', !link.refIds.includes(lib.SHOT_PREV))

const dup = lib.appendRefToken(['asset-abc'], 'asset-abc')
check('appendRef 去重', dup.length === 1)

check('标题含镜号', lib.clipFrameAssetTitle('S01', 'tail') === 'S01 · 成片尾帧')

if (process.exitCode) {
  console.error('verify-shot-clip-frame-assets: 有失败项')
  process.exit(process.exitCode)
}
console.log('verify-shot-clip-frame-assets: 全部通过')