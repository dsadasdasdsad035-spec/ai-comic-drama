#!/usr/bin/env node
/**
 * 下载 Grab3D CC0 动物 GLB，写入 vendor/cc0-props/animals/<slug>/，并刷新清单里的 url。
 *
 * 与 sync-m3d-character-props.mjs 同一套模式：清单进 git，二进制按需落 vendor。
 * 例外：动物目录刻意被 git 跟踪（短剧最常用的宠物与动物角色，团队开箱即用），
 * 见 .gitignore 里的负向规则。
 *
 * 用法：
 *   node scripts/sync-m3d-animal-props.mjs            # 只同步清单里登记的条目
 *   node scripts/sync-m3d-animal-props.mjs --force    # 已存在也重新下载
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRESET = path.join(ROOT, 'public', 'presets', 'm3d-animals', 'manifest.json')
const VENDOR = path.join(ROOT, 'vendor', 'cc0-props', 'animals')
const API = 'https://grab3d.com/api/v1/models.json'
const DL = 'https://grab3d.com/dl'
const UA = 'storyboard-canvas-m3d-animals'

const force = process.argv.includes('--force')

function log(msg) {
  console.log(`[m3d-animals] ${msg}`)
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

/** 从清单里挑 light 变体；没有则退回 full */
function resolveGlb(model, preferredFile) {
  const files = model?.files || []
  const exact = files.find((f) => f.format === 'glb' && f.file === preferredFile)
  if (exact?.url) return exact
  return (
    files.find((f) => f.format === 'glb' && f.variant === 'light') ||
    files.find((f) => f.format === 'glb' && f.variant === 'full') ||
    null
  )
}

const raw = JSON.parse(fs.readFileSync(PRESET, 'utf8'))
const entries = Array.isArray(raw.entries) ? raw.entries : []
if (!entries.length) throw new Error('清单没有 entries，先补 public/presets/m3d-animals/manifest.json')

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
    const bytes = await download(glb.url, dest)
    entry.bytes = bytes
  } else {
    log(`已存在 ${entry.title}`)
  }

  const licensePath = path.join(VENDOR, slug, 'LICENSE.txt')
  if (force || !fs.existsSync(licensePath)) {
    const text =
      `${entry.title}（${entry.titleEn || slug}）— Grab3D ${slug}\n` +
      `License: CC0 1.0 Universal (Public Domain Dedication)\n` +
      `Page: ${entry.page || `${DL}/${slug}/`}\n` +
      `Note: AI-assisted content (Meshy base mesh, cleaned in Blender).\n`
    fs.writeFileSync(licensePath, text, 'utf8')
  }

  entry.file = glb.file
  samples.push({
    id: entry.id || slug,
    title: entry.title || slug,
    titleEn: entry.titleEn || '',
    source: 'grab3d',
    license: entry.license || 'CC0-1.0',
    categories: ['animals', 'realistic'],
    url: `/cc0-props/animals/${slug}/${glb.file}`,
  })
}

const out = {
  ...raw,
  updatedAt: new Date().toISOString(),
  samples,
}
fs.writeFileSync(PRESET, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
log(`完成 ${samples.length} 条，vendor → ${path.relative(ROOT, VENDOR)}`)
