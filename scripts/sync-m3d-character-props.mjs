#!/usr/bin/env node
/**
 * 下载 Grab3D 轻量人形 GLB，写入 vendor 并刷新 manifest 中的 url。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRESET = path.join(ROOT, 'public', 'presets', 'm3d-characters', 'manifest.json')
const VENDOR = path.join(ROOT, 'vendor', 'cc0-props', 'characters')
const GRAB3D_API = 'https://grab3d.com/api/v1/models.json'
const DL = 'https://grab3d.com/dl'

function log(msg) {
  console.log(`[m3d-characters] ${msg}`)
}

function readPreset() {
  const raw = JSON.parse(fs.readFileSync(PRESET, 'utf8'))
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  return { ...raw, entries }
}

async function fetchModels() {
  const res = await fetch(GRAB3D_API, { headers: { 'User-Agent': 'storyboard-canvas-m3d-characters' } })
  if (!res.ok) throw new Error(`Grab3D API HTTP ${res.status}`)
  const j = await res.json()
  return new Map((j.models || []).map((m) => [m.slug, m]))
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const res = await fetch(url, { headers: { 'User-Agent': 'storyboard-canvas-m3d-characters' } })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(part, buf)
  fs.renameSync(part, dest)
}

function resolveLightGlb(model, preferredFile) {
  const files = model?.files || []
  const exact = files.find((f) => f.format === 'glb' && f.file === preferredFile)
  if (exact?.url) return exact
  const light = files.find((f) => f.format === 'glb' && f.variant === 'light')
  if (light?.url) return light
  const full = files.find((f) => f.format === 'glb' && f.variant === 'full')
  return full || null
}

const preset = readPreset()
const bySlug = await fetchModels()
const samples = []

for (const entry of preset.entries) {
  const slug = String(entry.slug || '').trim()
  const file = String(entry.file || '').trim()
  if (!slug || !file) {
    log(`跳过无效条目 ${entry.id}`)
    continue
  }
  const model = bySlug.get(slug)
  const glb = model ? resolveLightGlb(model, file) : null
  const dlName = glb?.file || file
  const url = glb?.url || `${DL}/${slug}/${dlName}`
  const relUrl = `/cc0-props/characters/${slug}/${dlName}`
  const dest = path.join(VENDOR, slug, dlName)

  if (!fs.existsSync(dest)) {
    log(`下载 ${entry.title} ← ${url}`)
    await download(url, dest)
  } else {
    log(`已存在 ${entry.title}`)
  }

  const licensePath = path.join(VENDOR, slug, 'LICENSE.txt')
  if (!fs.existsSync(licensePath)) {
    fs.writeFileSync(
      licensePath,
      `${entry.title} — Grab3D ${slug}\nLicense: CC0 1.0\nPage: https://grab3d.com/models/characters/${slug}/\n`,
      'utf8',
    )
  }

  samples.push({
    id: entry.id,
    title: entry.title,
    source: 'grab3d',
    license: entry.license || 'CC0',
    categories: ['characters', 'rigged'],
    url: relUrl,
  })
}

const out = {
  ...preset,
  updatedAt: new Date().toISOString(),
  samples,
}
fs.writeFileSync(PRESET, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
log(`完成 ${samples.length} 条，vendor → ${path.relative(ROOT, VENDOR)}`)