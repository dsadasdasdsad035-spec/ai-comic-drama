/**
 * 场景三维分镜人形库 + 写实动物库（均为 Grab3D CC0），与 Poly Haven manifest 合并输出。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveStaticRoot } from './paths.mjs'
import { cc0PropsCacheRoot, readCc0PropsManifest } from './cc0-props.mjs'

const MANIFEST_REL = ['presets', 'm3d-characters', 'manifest.json']

export function readM3dCharactersManifest(appRoot) {
  const file = path.join(resolveStaticRoot(appRoot), ...MANIFEST_REL)
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, samples: [], entries: [] }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const fromSamples = Array.isArray(raw.samples) ? raw.samples : []
    const fromEntries = (Array.isArray(raw.entries) ? raw.entries : []).map((e) => ({
      id: e.id,
      title: e.title,
      source: 'grab3d',
      license: e.license || 'CC0',
      categories: ['characters', 'rigged'],
      url: `/cc0-props/characters/${e.slug}/${e.file}`,
    }))
    const samples = fromSamples.length ? fromSamples : fromEntries
    return { ...raw, samples }
  } catch {
    return { schemaVersion: 1, samples: [], entries: [] }
  }
}

export function m3dCharactersVendorReady(appRoot) {
  const m = readM3dCharactersManifest(appRoot)
  if (!m.samples.length) return false
  const cacheRoot = cc0PropsCacheRoot(appRoot)
  return m.samples.every((s) => {
    const rel = String(s.url || '').replace(/^\/cc0-props\//, '')
    if (!rel || rel.includes('..')) return false
    const full = path.join(cacheRoot, rel)
    return fs.existsSync(full) && fs.statSync(full).isFile()
  })
}

/** Grab3D 清单读取：presets/<dir>/manifest.json → samples（缺 samples 时按 entries 推导） */
function readGrab3dManifest(appRoot, dir, bucket, category, defaultStyle) {
  const file = path.join(resolveStaticRoot(appRoot), 'presets', dir, 'manifest.json')
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, samples: [], entries: [] }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const fromSamples = Array.isArray(raw.samples) ? raw.samples : []
    const fromEntries = (Array.isArray(raw.entries) ? raw.entries : []).map((e) => ({
      id: e.id,
      title: e.title,
      source: 'grab3d',
      license: e.license || 'CC0-1.0',
      categories: [category, e.style || defaultStyle],
      // group 只在家具侧有意义（沙发/桌/柜/软装/绿植/厨卫…），动物不分组
      ...(e.group ? { group: e.group } : {}),
      url: `/cc0-props/${bucket}/${e.slug}/${e.file}`,
    }))
    const samples = fromSamples.length ? fromSamples : fromEntries
    return { ...raw, samples }
  } catch {
    return { schemaVersion: 1, samples: [], entries: [] }
  }
}

function grab3dVendorReady(appRoot, samples) {
  if (!samples.length) return false
  const cacheRoot = cc0PropsCacheRoot(appRoot)
  return samples.every((s) => {
    const rel = String(s.url || '').replace(/^\/cc0-props\//, '')
    if (!rel || rel.includes('..')) return false
    const full = path.join(cacheRoot, rel)
    return fs.existsSync(full) && fs.statSync(full).isFile()
  })
}

/** 场景三维分镜动物库（Grab3D CC0 写实动物） */
export function readM3dAnimalsManifest(appRoot) {
  return readGrab3dManifest(appRoot, 'm3d-animals', 'animals', 'animals', 'realistic')
}

export function m3dAnimalsVendorReady(appRoot) {
  return grab3dVendorReady(appRoot, readM3dAnimalsManifest(appRoot).samples)
}

/** 场景三维布景家具补库（Grab3D CC0 轻量 PBR，补沙发/床/衣柜缺口） */
export function readM3dFurnitureManifest(appRoot) {
  return readGrab3dManifest(appRoot, 'm3d-furniture', 'furniture', 'furniture', 'stylized')
}

export function m3dFurnitureVendorReady(appRoot) {
  return grab3dVendorReady(appRoot, readM3dFurnitureManifest(appRoot).samples)
}

/** Poly Haven 家具 + 人形 + 写实动物 + Grab3D 布景家具补库 */
export function readMergedCc0PropsManifest(appRoot) {
  const furniture = readCc0PropsManifest(appRoot)
  const characters = readM3dCharactersManifest(appRoot)
  const animals = readM3dAnimalsManifest(appRoot)
  const gapFill = readM3dFurnitureManifest(appRoot)
  // Poly Haven 侧只保留家具；人形/动物/补库各自有来源标签，不重复计入
  const poly = (furniture.samples || []).filter(
    (s) => !(s.categories || []).includes('characters') && s.source !== 'grab3d',
  )
  return {
    ...furniture,
    sources: ['polyhaven', 'grab3d-characters', 'grab3d-animals', 'grab3d-furniture'],
    license: 'CC0 (Poly Haven + Grab3D)',
    updatedAt: gapFill.updatedAt || animals.updatedAt || characters.updatedAt || furniture.updatedAt,
    samples: [...(characters.samples || []), ...(animals.samples || []), ...poly, ...(gapFill.samples || [])],
    charactersReady: m3dCharactersVendorReady(appRoot),
    animalsReady: m3dAnimalsVendorReady(appRoot),
    furnitureReady: m3dFurnitureVendorReady(appRoot),
  }
}