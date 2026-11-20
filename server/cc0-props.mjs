/**
 * CC0 道具：Poly Haven 模型（glTF 1k 包，缓存在 vendor/cc0-props/）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveStaticRoot } from './paths.mjs'

const API = 'https://api.polyhaven.com'
const MANIFEST_REL = ['presets', 'cc0-props', 'manifest.json']
const URL_PREFIX = '/cc0-props/'
const CACHE_ROOT_REL = ['vendor', 'cc0-props']

/** 纳入「道具库」的 Poly Haven 分类 */
export const CC0_PROP_CATEGORIES = new Set([
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
  'electronics',
  'instrument',
])

export function cc0PropsCacheRoot(appRoot) {
  return path.join(path.resolve(appRoot), ...CACHE_ROOT_REL)
}

export function readCc0PropsManifest(appRoot) {
  const file = path.join(resolveStaticRoot(appRoot), ...MANIFEST_REL)
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, samples: [], source: 'polyhaven', updatedAt: '' }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...raw, samples: Array.isArray(raw.samples) ? raw.samples : [] }
  } catch {
    return { schemaVersion: 1, samples: [], source: 'polyhaven', updatedAt: '' }
  }
}

export function cc0PropsVendorReady(appRoot) {
  const m = readCc0PropsManifest(appRoot)
  return m.samples.length > 0
}

export function parseCc0PropUrl(url) {
  const s = String(url || '').split('?')[0]
  if (!s.startsWith(URL_PREFIX)) return null
  return s
}

async function phGetJson(pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { 'User-Agent': 'storyboard-canvas-cc0-props' },
  })
  if (!res.ok) throw new Error(`Poly Haven API HTTP ${res.status}`)
  return res.json()
}

async function downloadTo(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { headers: { 'User-Agent': 'storyboard-canvas-cc0-props' } })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

/** 将 Poly Haven 模型 glTF 1k 写入 vendor/cc0-props/polyhaven/<id>/ */
export async function ensurePolyHavenModel(appRoot, assetId) {
  const safeId = String(assetId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) throw new Error('非法 asset id')
  const dir = path.join(cc0PropsCacheRoot(appRoot), 'polyhaven', safeId)
  const marker = path.join(dir, '.complete')
  if (fs.existsSync(marker)) return dir

  const files = await phGetJson(`/files/${encodeURIComponent(safeId)}`)
  const resPack = files?.gltf?.['1k']
  const pack = resPack?.gltf ?? resPack
  if (!pack?.url) throw new Error(`模型 ${safeId} 无 glTF 1k`)

  const gltfName = path.basename(new URL(pack.url).pathname)
  await downloadTo(pack.url, path.join(dir, gltfName))

  for (const [rel, info] of Object.entries(pack.include || {})) {
    if (!info?.url) continue
    await downloadTo(info.url, path.join(dir, rel))
  }

  fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
  return dir
}

/** /cc0-props/polyhaven/<id>/<file> */
export function resolveCc0PropFile(appRoot, urlPath) {
  const raw = String(urlPath || '').split('?')[0]
  if (!raw.startsWith(URL_PREFIX)) throw new Error('非法 CC0 URL')
  const rel = decodeURIComponent(raw.slice(URL_PREFIX.length))
  if (!rel || rel.includes('..')) throw new Error('路径非法')
  const base = cc0PropsCacheRoot(appRoot)
  const full = path.join(base, rel)
  const inside = path.relative(base, full)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('路径越界')
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error('道具文件未缓存，请先从侧栏选用以下载')
  }
  const lower = full.toLowerCase()
  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) throw new Error('仅支持 glTF')
  return full
}

function patchGltfUriMap(doc, relpathToFlat) {
  const patchUri = (uri) => {
    if (!uri || typeof uri !== 'string' || uri.startsWith('data:')) return uri
    const norm = uri.split('/').join('/')
    for (const [rel, flat] of relpathToFlat) {
      if (uri === rel || uri === path.basename(rel) || norm.endsWith(rel)) {
        return flat
      }
    }
    return uri
  }
  for (const b of doc.buffers || []) {
    if (b.uri) b.uri = patchUri(b.uri)
  }
  for (const img of doc.images || []) {
    if (img.uri) img.uri = patchUri(img.uri)
  }
}

export async function importCc0PropToProject(appRoot, projectName, sampleUrl, title) {
  const { copyIntoProjectMedia } = await import('./media.mjs')
  const { safeProjectName } = await import('./db.mjs')
  const parsed = parseCc0PropUrl(sampleUrl)
  if (!parsed) throw new Error('url 须为 /cc0-props/...')
  const rel = parsed.slice(URL_PREFIX.length)
  const [source, assetId, ...rest] = rel.split('/')
  if (source !== 'polyhaven' || !assetId || !rest.length) {
    throw new Error('仅支持 polyhaven 道具')
  }
  const dir = await ensurePolyHavenModel(appRoot, assetId)
  const files = listPolyHavenCacheFiles(dir)
  if (!files.length) throw new Error('缓存为空')

  const safe = safeProjectName(projectName)
  const prefix = `cc0-ph-${assetId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-`
  const uriMap = new Map()
  for (const f of files) {
    const flat = `${prefix}${f.rel.replace(/\//g, '__')}`
    uriMap.set(f.rel, flat)
    copyIntoProjectMedia(appRoot, safe, f.full, flat)
  }

  const mainName = decodeURIComponent(rest.join('/'))
  const mainSrc = path.join(dir, ...rest)
  if (!fs.existsSync(mainSrc)) throw new Error('主 glTF 缺失')

  let mainUrl
  if (mainName.toLowerCase().endsWith('.gltf')) {
    const doc = JSON.parse(fs.readFileSync(mainSrc, 'utf8'))
    patchGltfUriMap(doc, uriMap)
    const outFlat = `${prefix}${mainName}`
    const outPath = (await import('./media.mjs')).resolveProjectMediaPath(appRoot, safe, outFlat)
    fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    mainUrl = (await import('./media.mjs')).projectMediaUrl(safe, outFlat)
  } else {
    const flat = `${prefix}${mainName}`
    copyIntoProjectMedia(appRoot, safe, mainSrc, flat)
    mainUrl = (await import('./media.mjs')).projectMediaUrl(safe, flat)
  }

  return {
    url: mainUrl,
    title: title || assetId,
    kind: 'model',
    note: 'cc0-polyhaven',
  }
}

export function listPolyHavenCacheFiles(dir) {
  const out = []
  const walk = (d, prefix = '') => {
    for (const name of fs.readdirSync(d)) {
      if (name === '.complete') continue
      const full = path.join(d, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full, prefix ? `${prefix}/${name}` : name)
      else out.push({ rel: prefix ? `${prefix}/${name}` : name, full, name })
    }
  }
  walk(dir)
  return out
}