/**
 * 视频参考图宽高比裁切纯函数回归。
 * 跑法：node verify-image-material-crop.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-'))
const entry = path.join(tmp, 'e.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/imageMaterialCrop.ts'))}`)
const bundle = path.join(tmp, 'b.mjs')
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${bundle}`,
  '--log-level=error',
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// 2:5 极限竖图（ratio=0.40）需要裁切
check('0.40 需裁切', lib.needsMaterialAspectCrop(400, 1000))
const rect = lib.materialCropRect(400, 1000)
check('裁切后比例 >= 0.41', rect && lib.materialAspectRatio(rect.sw, rect.sh) >= 0.41)
check('16:9 免裁', !lib.needsMaterialAspectCrop(1920, 1080))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
