/**
 * 画布缩略图 URL 纯函数
 * 跑法：node verify-canvas-thumb-url.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-canvas-thumb-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export * from ${abs('src/canvasThumbUrl.ts')}\n`)
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
const lib = await import(bundle)

let bad = 0
const check = (n, c) => {
  console.log(`${c ? '✅' : '❌'} ${n}`)
  if (!c) bad++
}

const u = lib.canvasDisplayImageUrl('/project-assets/demo/a.png')
check('站内路径走 thumb', u.startsWith('/api/canvas-thumb?') && u.includes('ref=%2Fproject-assets%2Fdemo%2Fa.png'))
check('外链不变', lib.canvasDisplayImageUrl('https://x/y.jpg') === 'https://x/y.jpg')
check('data 不变', lib.canvasDisplayImageUrl('data:image/png;base64,ab') === 'data:image/png;base64,ab')

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)