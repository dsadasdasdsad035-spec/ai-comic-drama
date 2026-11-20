/**
 * itch.io 等自入库 3D 道具：manifest + vendor/itch-props/<pack>/（无在线拉取）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveStaticRoot } from './paths.mjs'
import { listPolyHavenCacheFiles, patchGltfUriMap } from './cc0-props.mjs'

const MANIFEST_REL = ['presets', 'itch-props', 'manifest.json']
const URL_PREFIX = '/itch-props/'
const CACHE_ROOT_REL = ['vendor', 'itch-props']

export function itchPropsCacheRoot(appRoot) {
  return path.join(path.resolve(appRoot), ...CACHE_ROOT_REL)
}

export function readItchPropsManifest(appRoot) {
  const file = path.join(resolveStaticRoot(appRoot), ...MANIFEST_REL)
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, samples: [], source: 'itch.io (local)', updatedAt: '' }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...raw, samples: Array.isArray(raw.samples) ? raw.samples : [] }
  } catch {
    return { schemaVersion: 1, samples: [], source: 'itch.io (local)', updatedAt: '' }
  }
}

/** 至少有一条 manifest 且对应主文件已在 vendor 中存在 */
export function itchPropsVendorReady(appRoot) {
  const m = readItchPropsManifest(appRoot)
  if (!m.samples.length) return false
  return m.samples.some((s) => {
    try {
      resolveItchPropFile(appRoot, s.url)
      return true
    } catch {
      return false
    }
  })
}

export function parseItchPropUrl(url) {
  const s = String(url || '').split('?')[0]
  if (!s.startsWith(URL_PREFIX)) return null
  return s
}

/** /itch-props/<pack>/... 任意已缓存附属文件 */
export function resolveItchPropFile(appRoot, urlPath) {
  const raw = String(urlPath || '').split('?')[0]
  if (!raw.startsWith(URL_PREFIX)) throw new Error('非法 itch 道具 URL')
  const rel = decodeURIComponent(raw.slice(URL_PREFIX.length))
  if (!rel || rel.includes('..')) throw new Error('路径非法')
  const base = itchPropsCacheRoot(appRoot)
  const full = path.join(base, rel)
  const inside = path.relative(base, full)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('路径越界')
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error('道具未入库：请将包放入 vendor/itch-props/ 并登记 manifest')
  }
  return full
}

export async function importItchPropToProject(appRoot, projectName, sampleUrl, title) {
  const { copyIntoProjectMedia, resolveProjectMediaPath, projectMediaUrl } = await import('./media.mjs')
  const { safeProjectName } = await import('./db.mjs')
  const parsed = parseItchPropUrl(sampleUrl)
  if (!parsed) throw new Error('url 须为 /itch-props/...')
  const rel = parsed.slice(URL_PREFIX.length)
  const [packId, ...rest] = rel.split('/')
  if (!packId || !rest.length) throw new Error('URL 须含 pack 与主文件名')

  const dir = path.join(itchPropsCacheRoot(appRoot), packId)
  if (!fs.existsSync(dir)) throw new Error(`pack 目录不存在：${packId}`)

  const files = listPolyHavenCacheFiles(dir)
  if (!files.length) throw new Error('pack 为空')

  const safe = safeProjectName(projectName)
  const slug = packId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'itch'
  const prefix = `itch-${slug}-`
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
    const outPath = resolveProjectMediaPath(appRoot, safe, outFlat)
    fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    mainUrl = projectMediaUrl(safe, outFlat)
  } else {
    const flat = `${prefix}${mainName}`
    copyIntoProjectMedia(appRoot, safe, mainSrc, flat)
    mainUrl = projectMediaUrl(safe, flat)
  }

  return {
    url: mainUrl,
    title: title || mainName.replace(/\.[^.]+$/, ''),
    kind: 'model',
    note: 'itch-local-pack',
  }
}