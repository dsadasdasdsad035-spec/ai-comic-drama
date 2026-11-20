#!/usr/bin/env node
/**
 * 将 itch 等平台下载并解压的 glTF/GLB 包复制到 vendor/itch-props/<packId>/，
 * 并可选追加 manifest 条目。
 *
 * 用法：
 *   node scripts/ingest-itch-prop-pack.mjs --pack my-furniture --from ./downloads/couch \
 *     --main couch.glb --title "沙发" --license "CC0" --itch "https://..."
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const MANIFEST = path.join(ROOT, 'public', 'presets', 'itch-props', 'manifest.json')
const VENDOR = path.join(ROOT, 'vendor', 'itch-props')

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pack') out.pack = argv[++i]
    else if (a === '--from') out.from = argv[++i]
    else if (a === '--main') out.main = argv[++i]
    else if (a === '--title') out.title = argv[++i]
    else if (a === '--license') out.license = argv[++i]
    else if (a === '--itch') out.itch = argv[++i]
    else if (a === '--id') out.id = argv[++i]
    else if (a === '--category') {
      out.categories = out.categories || []
      out.categories.push(argv[++i])
    }
  }
  return out
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    if (name === '.DS_Store') continue
    const s = path.join(src, name)
    const d = path.join(dest, name)
    const st = fs.statSync(s)
    if (st.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function safePackId(id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
  if (!s) throw new Error('pack id 非法')
  return s
}

function main() {
  const args = parseArgs(process.argv)
  const pack = safePackId(args.pack)
  const from = path.resolve(args.from || '')
  const mainFile = String(args.main || '').trim()
  if (!from || !fs.existsSync(from)) {
    console.error('缺少有效 --from 目录')
    process.exit(1)
  }
  if (!mainFile) {
    console.error('缺少 --main（pack 内主 .glb/.gltf 相对路径）')
    process.exit(1)
  }
  const mainSrc = path.join(from, mainFile)
  if (!fs.existsSync(mainSrc)) {
    console.error(`主文件不存在：${mainSrc}`)
    process.exit(1)
  }

  const dest = path.join(VENDOR, pack)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  copyDir(from, dest)

  const id = safePackId(args.id || `${pack}-${path.basename(mainFile, path.extname(mainFile))}`)
  const title = args.title || id
  const entry = {
    id,
    title,
    pack,
    license: args.license || '',
    itchUrl: args.itch || '',
    categories: args.categories || ['furniture'],
    url: `/itch-props/${pack}/${mainFile.split('/').map(encodeURIComponent).join('/')}`,
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  manifest.samples = (manifest.samples || []).filter((s) => s.id !== id)
  manifest.samples.push(entry)
  manifest.updatedAt = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`[itch-props] 已入库 vendor/itch-props/${pack}`)
  console.log(`[itch-props] manifest 条目：${id} → ${entry.url}`)
}

main()