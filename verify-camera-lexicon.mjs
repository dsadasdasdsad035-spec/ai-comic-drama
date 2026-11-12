/**
 * 内置运镜白膜 catalog 与磁盘文件一致性。
 * 跑法：node verify-camera-lexicon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PRESET = path.join(ROOT, 'public/presets/camera-moves-whitebox-132')
const MANIFEST = path.join(PRESET, 'manifest.json')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const catalog = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
check('manifest count', catalog.count === 132, String(catalog.count))
check('entries length', catalog.entries?.length === 132)

const files = fs.readdirSync(PRESET).filter((f) => f.endsWith('.mp4'))
check('mp4 on disk', files.length === 132, String(files.length))

const keys = new Set()
for (const e of catalog.entries) {
  keys.add(e.key)
  const fp = path.join(PRESET, e.filename || `${e.key}.mp4`)
  check(`file ${e.key}`, fs.existsSync(fp))
  check(`url ${e.key}`, String(e.url).startsWith('/presets/camera-moves-whitebox-132/'))
}

check('unique keys', keys.size === 132)

const MOVES = ['推', '拉', '摇', '移', '跟', '升降', '手持']
for (const m of MOVES) {
  const hit = catalog.entries.some((e) => e.mapsToMove === m && e.primaryForMove)
  check(`primary move ${m}`, hit)
}

const SIZES = ['远景', '全景', '中景', '特写', '大特写']
for (const s of SIZES) {
  const hit = catalog.entries.some((e) => e.mapsToSize === s && e.primaryForSize)
  check(`primary size ${s}`, hit)
}

const TMP = fs.mkdtempSync(path.join(ROOT, '.verify-lexicon-'))
const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/cameraLexicon.ts'))}\n`,
)
const bundle = path.join(TMP, 'bundle.mjs')
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)
const list = lib.listCameraLexicon({ category: 'camera-move' })
check('list camera-move', list.length === 100, String(list.length))
const grammar = lib.listCameraLexicon({ category: 'shot-grammar' })
check('list shot-grammar', grammar.length === 32, String(grammar.length))
const push = lib.resolvePrimaryMove('推')
check('resolve 推', push?.key === '01_dolly_in', push?.key)

if (bad) process.exit(1)
console.log('verify-camera-lexicon: ok')
