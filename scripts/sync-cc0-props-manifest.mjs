#!/usr/bin/env node
/**
 * 从 Poly Haven API 生成 CC0 布景家具 manifest。
 *
 * 只收「能撑起一个场景」的家具：座椅、桌、柜架、床。装饰摆件、餐具、
 * 灯具、电器、食物、植物、工具都不进目录——它们要么该用素材卡立板，
 * 要么与分镜布景无关。想临时恢复一类，把它的品类加回 CATS。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'presets', 'cc0-props', 'manifest.json')
const API = 'https://api.polyhaven.com/assets?t=models'
const CATS = new Set(['furniture', 'seating', 'table', 'shelves', 'bed'])
/** 布景主力优先；工业/户外款排后面 */
const HOME_PRIO = ['seating', 'furniture', 'table', 'bed', 'shelves']
/** 不设上限：家具品类在 Poly Haven 只有几十个，全收比截断更有用 */
const MAX = Infinity
/**
 * 集合里的成员也照样收：`collection: the_shed` 之类的标签只说明它出现在哪个
 * Poly Haven 套装里，不代表它不能单独使用。真正要跳过的只有集合本身。
 */
const SKIP_ID = /^collection:/
const DEPRIORITIZE = new Set(['industrial', 'nature', 'rigged'])

function log(msg) {
  console.log(`[cc0-props] ${msg}`)
}

function matchesPropAsset(id, entry) {
  if (SKIP_ID.test(String(id || ''))) return false
  const cats = entry.categories || []
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
  .filter(([id, v]) => matchesPropAsset(id, v))
  .map(([id, v]) => ({ id, name: v.name || id, categories: v.categories || [] }))
  .sort((a, b) => homeRank(a.categories) - homeRank(b.categories) || a.name.localeCompare(b.name))
  .slice(0, Number.isFinite(MAX) ? MAX : undefined)

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