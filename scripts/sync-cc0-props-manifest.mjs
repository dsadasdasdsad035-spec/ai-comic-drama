#!/usr/bin/env node
/**
 * 从 Poly Haven API 生成 CC0 布景家具 manifest。
 *
 * 两道筛选：
 * 1) 品类只要座椅/桌/柜架/床——装饰摆件、餐具、灯具、电器、食物、
 *    植物、工具撑不起场景，要它们该用素材卡立板。
 * 2) 风格只留现代款。Poly Haven 本身是废墟/古堡风素材库（85 件家具里
 *    有 51 件带 vintage、33 件 old、25 件 antique），留给短剧现代生活
 *    场景的只有十几件。带任何复古标签的一律不入目录。
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
 * 复古风格标签：命中任意一个就排除。Poly Haven 的 tags 是资产作者打的，
 * 比标题更可靠——标题写 `Modern Arm Chair` 也可能带 fancy 的仿古饰线。
 */
const VINTAGE_TAGS = new Set([
  'vintage',
  'old',
  'antique',
  'gothic',
  'victorian',
  'ornate',
  'traditional',
  'rustic',
  'worn',
  'aged',
  'weathered',
  'rusted',
  'dirty',
  'farmhouse',
  'classic',
  'fancy',
  'varnished',
  'asian',
  'chinese',
  'abandoned',
])
/** 现代款判定：必须至少命中一个才保留 */
const MODERN_TAGS = new Set(['modern', 'contemporary', 'minimalist', 'sleek', 'industrial'])
/**
 * 标签缺失但形态确实是现代款的几件（人工核对过）：
 * 皮质布艺沙发、皮革脚凳、金属塑料校椅、移动咖啡车、皮质现代扶手椅、皮质餐椅。
 * 它们只是作者没打 modern 标签，一并保留。
 */
const MODERN_ID_ALLOWLIST = new Set([
  'sofa_02',
  'Ottoman_01',
  'SchoolChair_01',
  'CoffeeCart_01',
  'modern_arm_chair_01',
  'dining_chair_02',
])
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
  if (!cats.some((c) => CATS.has(c))) return false
  if (MODERN_ID_ALLOWLIST.has(id)) return true
  const tags = new Set(entry.tags || [])
  if ([...VINTAGE_TAGS].some((t) => tags.has(t))) return false
  return [...MODERN_TAGS].some((t) => tags.has(t))
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