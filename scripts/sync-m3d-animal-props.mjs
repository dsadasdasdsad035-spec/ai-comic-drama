#!/usr/bin/env node
/**
 * 下载 Grab3D CC0 模型（动物 / 家具 …），写入 vendor/cc0-props/<bucket>/<slug>/，
 * 并刷新对应清单里的 url 与体积。
 *
 * 与 sync-m3d-character-props.mjs 同一套模式：清单进 git，二进制落 vendor。
 * animals 与 furniture 两个 bucket 刻意被 git 跟踪（布景常用、体积可控），
 * 其余 bucket 仍按 .gitignore 的默认策略按需下载。
 *
 * 用法：
 *   node scripts/sync-m3d-animal-props.mjs                       # 默认 animals
 *   node scripts/sync-m3d-animal-props.mjs --bucket furniture    # 家具
 *   node scripts/sync-m3d-animal-props.mjs --bucket furniture --force
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const API = 'https://grab3d.com/api/v1/models.json'
const UA = 'storyboard-canvas-m3d-grab3d'

/** bucket → 清单与人形/动物/家具目录的对应关系 */
const BUCKETS = {
  animals: {
    preset: ['public', 'presets', 'm3d-animals', 'manifest.json'],
    vendor: ['vendor', 'cc0-props', 'animals'],
    /** 静态服务前缀：/cc0-props/<bucket>/...（vendor 目录不算进 URL） */
    urlBucket: 'animals',
    category: 'animals',
    label: '动物',
  },
  furniture: {
    preset: ['public', 'presets', 'm3d-furniture', 'manifest.json'],
    vendor: ['vendor', 'cc0-props', 'furniture'],
    urlBucket: 'furniture',
    category: 'furniture',
    label: '家具',
  },
}

function argOf(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const bucketKey = argOf('bucket', 'animals')
const bucket = BUCKETS[bucketKey]
if (!bucket) {
  throw new Error(`未知 bucket「${bucketKey}」；可选：${Object.keys(BUCKETS).join(' / ')}`)
}
const force = process.argv.includes('--force')
const PRESET = path.join(ROOT, ...bucket.preset)
const VENDOR = path.join(ROOT, ...bucket.vendor)

function log(msg) {
  console.log(`[m3d-${bucketKey}] ${msg}`)
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(part, buf)
  fs.renameSync(part, dest)
  return buf.length
}

/** 优先 light 变体（动物有），没有就取最小的 GLB（家具只有 full） */
function resolveGlb(model, preferredFile) {
  const files = (model?.files || []).filter((f) => f.format === 'glb')
  if (!files.length) return null
  const exact = preferredFile ? files.find((f) => f.file === preferredFile) : null
  if (exact?.url) return exact
  const light = files.find((f) => f.variant === 'light')
  if (light?.url) return light
  return files.reduce((a, b) => (a.bytes <= b.bytes ? a : b))
}

const raw = JSON.parse(fs.readFileSync(PRESET, 'utf8'))
const entries = Array.isArray(raw.entries) ? raw.entries : []
if (!entries.length) throw new Error(`清单没有 entries：${path.relative(ROOT, PRESET)}`)

log(`拉取目录 ${API}`)
const res = await fetch(API, { headers: { 'User-Agent': UA } })
if (!res.ok) throw new Error(`目录 HTTP ${res.status}`)
const catalog = await res.json()
const bySlug = new Map((catalog.models || []).map((m) => [m.slug, m]))

const samples = []
for (const entry of entries) {
  const slug = String(entry.slug || '').trim()
  if (!slug) continue
  const model = bySlug.get(slug)
  if (!model) {
    log(`跳过 ${slug}：目录里没有这个模型`)
    continue
  }
  const glb = resolveGlb(model, entry.file)
  if (!glb) {
    log(`跳过 ${slug}：没有可用 GLB`)
    continue
  }
  const dest = path.join(VENDOR, slug, glb.file)
  if (force || !fs.existsSync(dest)) {
    log(`下载 ${entry.title} ← ${glb.url}`)
    entry.bytes = await download(glb.url, dest)
  } else {
    log(`已存在 ${entry.title}`)
    entry.bytes = fs.statSync(dest).size
  }

  const licensePath = path.join(VENDOR, slug, 'LICENSE.txt')
  if (force || !fs.existsSync(licensePath)) {
    const text =
      `${entry.title}（${entry.titleEn || slug}）— Grab3D ${slug}\n` +
      `License: CC0 1.0 Universal (Public Domain Dedication)\n` +
      `Page: ${entry.page || `https://grab3d.com/models/${bucket.category}/${slug}/`}\n` +
      `Note: AI-assisted content (base mesh from an AI image-to-3D tool, cleaned in Blender).\n`
    fs.writeFileSync(licensePath, text, 'utf8')
  }

  entry.file = glb.file
  samples.push({
    id: entry.id || slug,
    title: entry.title || slug,
    titleEn: entry.titleEn || '',
    source: 'grab3d',
    license: entry.license || 'CC0-1.0',
    categories: [bucket.category, entry.style || model.style || 'stylized'],
    url: `/cc0-props/${bucket.urlBucket}/${slug}/${glb.file}`,
  })
}

const out = { ...raw, updatedAt: new Date().toISOString(), samples }
fs.writeFileSync(PRESET, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
log(`完成 ${samples.length} 条，vendor → ${path.relative(ROOT, VENDOR)}`)
