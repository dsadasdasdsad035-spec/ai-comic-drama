/**
 * 镜头工位：序列一律出片镜；批量出图只认素材卡；Inspector 无生图入口
 * 跑法：node verify-shot-prod-kind.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  inferProdKindFromProjectShot,
  inferProdKindFromShotData,
} from './src/shotProdKind.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-prod-kind-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export { planAddShot } from ${abs('src/canvasShotOps.ts')}\n`)
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
const { planAddShot } = await import(bundle)

const inspectorSrc = fs.readFileSync(path.join(root, 'src/Inspector.tsx'), 'utf8')
const boardSrc = fs.readFileSync(path.join(root, 'src/BoardMenu.tsx'), 'utf8')
const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

check(
  '仅静帧无工位 → 出片镜',
  inferProdKindFromProjectShot({ id: 'E01-S01', keyframe: '/generated/a.jpg' }) === 'video',
)
check(
  '仅出片',
  inferProdKindFromProjectShot({ id: 'E01-S02', clip: '/videos/a.mp4' }) === 'video',
)
check(
  '双轨仍以出片镜',
  inferProdKindFromProjectShot({
    id: 'E01-S03',
    keyframe: '/generated/a.jpg',
    clip: '/videos/a.mp4',
  }) === 'video',
)
check('空白默认出片', inferProdKindFromProjectShot({ id: 'E01-S04' }) === 'video')
check(
  '显式 image 在迁移前仍可读',
  inferProdKindFromProjectShot({ id: 'E01-S05', prod_kind: 'image' }) === 'image',
)
check(
  '画布态默认出片',
  inferProdKindFromShotData({ no: 'S01', refImage: '/x.jpg', marks: [] }) === 'video',
)

const { shot } = planAddShot([], 1)
check('新增镜头 prod_kind=video', shot.prod_kind === 'video', shot.prod_kind)

check('Inspector 无镜头类型切换菜单', !inspectorSrc.includes('镜头类型：切换'))
check('镜头 Inspector 无生图底栏', !inspectorSrc.includes('生成画面'))
check('BoardMenu 无生图镜入口', !boardSrc.includes('新建生图镜'))
check('批量出图过滤素材卡', appSrc.includes('isAssetCanvasNode(n)') && appSrc.includes('generateAll'))

check(
  'Agent 拒绝 prod_kind image',
  fs.readFileSync(path.join(root, 'src/agent/shotVideoHarnessTools.ts'), 'utf8').includes('不再支持生图镜'),
)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)