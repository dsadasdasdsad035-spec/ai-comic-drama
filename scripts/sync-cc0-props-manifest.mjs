#!/usr/bin/env node
/**
 * 从 Poly Haven API 生成 CC0 道具 manifest（家具/室内道具，尽量全覆盖）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'presets', 'cc0-props', 'manifest.json')
const API = 'https://api.polyhaven.com/assets?t=models'
const CATS = new Set([
  'furniture',
  'seating',
  'table',
  'props',
  'decorative',
  'decoration',
  'office',
  'appliances',
  'dishes',
  'lighting',
  'shelves',
  'bed',
  'vases',
  'wall decoration',
  'containers',
  'potted plants',
  'plants',
  'electronics',
  'food',
  'tools',
])
/** 家用/室内布景优先；其余按名称排序 */
const HOME_PRIO = [
  'furniture',
  'seating',
  'table',
  'bed',
  'shelves',
  'lighting',
  'appliances',
  'dishes',
  'decorative',
  'decoration',
  'props',
  'containers',
  'vases',
  'wall decoration',
  'potted plants',
  'plants',
  'electronics',
  'office',
  'food',
  'tools',
]
const MAX = 220
const SKIP = /^collection:/
const DEPRIORITIZE = new Set(['industrial', 'nature', 'rigged'])

function log(msg) {
  console.log(`[cc0-props] ${msg}`)
}

function matchesPropAsset(entry) {
  const cats = entry.categories || []
  if (cats.some((c) => SKIP.test(c))) return false
  return cats.some((c) => CATS.has(c))
}

function homeRank(categories) {
  const cats = categories || []
  let best = HOME_PRIO.length + 10
  for (const c of cats) {
    const i = HOME_PRIO.indexOf(c)
    if (i >= 0 && i < best) best = i
  }
  if (cats.some((c) => DEPRIORITIZE.has(c))) best += 50
  return best
}

async function gltf1kFilename(assetId) {
  const res = await fetch(`https://api.polyhaven.com/files/${encodeURIComponent(assetId)}`, {
    headers: { 'User-Agent': 'storyboard-canvas-sync-cc0' },
  })
  if (!res.ok) return null
  const files = await res.json()
  const resPack = files?.gltf?.['1k']
  const pack = resPack?.gltf ?? resPack
  if (!pack?.url) return null
  return path.basename(new URL(pack.url).pathname)
}

const res = await fetch(API, { headers: { 'User-Agent': 'storyboard-canvas-sync-cc0' } })
if (!res.ok) throw new Error(`Poly Haven HTTP ${res.status}`)
const assets = await res.json()

const candidates = Object.entries(assets)
  .filter(([, v]) => matchesPropAsset(v))
  .map(([id, v]) => ({ id, name: v.name || id, categories: v.categories || [] }))
  .sort((a, b) => homeRank(a.categories) - homeRank(b.categories) || a.name.localeCompare(b.name))
  .slice(0, MAX)

log(`匹配 ${candidates.length} 个，解析 glTF 文件名 …`)
const samples = []
let i = 0
for (const c of candidates) {
  i++
  const file = await gltf1kFilename(c.id)
  if (!file) continue
  samples.push({
    id: c.id,
    title: c.name,
    source: 'polyhaven',
    license: 'CC0',
    categories: c.categories,
    url: `/cc0-props/polyhaven/${c.id}/${file}`,
  })
  if (i % 10 === 0) log(`… ${i}/${candidates.length}`)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      source: 'https://polyhaven.com/models',
      license: 'CC0 (Poly Haven)',
      updatedAt: new Date().toISOString(),
      samples,
    },
    null,
    2,
  )}\n`,
  'utf8',
)
log(`已写入 ${samples.length} 条 → ${path.relative(ROOT, OUT)}`)