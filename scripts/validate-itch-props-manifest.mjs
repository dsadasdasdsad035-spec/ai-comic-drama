#!/usr/bin/env node
/** 校验 manifest 中 url 在 vendor/itch-props 下存在 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const MANIFEST = path.join(ROOT, 'public', 'presets', 'itch-props', 'manifest.json')
const VENDOR = path.join(ROOT, 'vendor', 'itch-props')

function main() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  let ok = 0
  let bad = 0
  for (const s of m.samples || []) {
    const u = String(s.url || '').split('?')[0]
    if (!u.startsWith('/itch-props/')) {
      console.error(`❌ ${s.id}: url 非法`)
      bad++
      continue
    }
    const rel = decodeURIComponent(u.slice('/itch-props/'.length))
    const full = path.join(VENDOR, rel)
    if (fs.existsSync(full)) {
      console.log(`✅ ${s.id}`)
      ok++
    } else {
      console.error(`❌ ${s.id}: 缺失 ${full}`)
      bad++
    }
  }
  console.log(`[itch-props] ${ok} 就绪，${bad} 缺失`)
  if (bad) process.exit(1)
}

main()