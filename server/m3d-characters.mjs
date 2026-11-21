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

/** 场景三维分镜动物库（Grab3D CC0 写实动物） */
export function readM3dAnimalsManifest(appRoot) {
  const file = path.join(resolveStaticRoot(appRoot), 'presets', 'm3d-animals', 'manifest.json')
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
      categories: ['animals', e.style || 'realistic'],
      url: `/cc0-props/animals/${e.slug}/${e.file}`,
    }))
    const samples = fromSamples.length ? fromSamples : fromEntries
    return { ...raw, samples }
  } catch {
    return { schemaVersion: 1, samples: [], entries: [] }
  }
}

export function m3dAnimalsVendorReady(appRoot) {
  const m = readM3dAnimalsManifest(appRoot)
  if (!m.samples.length) return false
  const cacheRoot = cc0PropsCacheRoot(appRoot)
  return m.samples.every((s) => {
    const rel = String(s.url || '').replace(/^\/cc0-props\//, '')
    if (!rel || rel.includes('..')) return false
    const full = path.join(cacheRoot, rel)
    return fs.existsSync(full) && fs.statSync(full).isFile()
  })
}

/** Poly Haven + 人形分镜素材 + 写实动物 */
export function readMergedCc0PropsManifest(appRoot) {
  const furniture = readCc0PropsManifest(appRoot)
  const characters = readM3dCharactersManifest(appRoot)
  const animals = readM3dAnimalsManifest(appRoot)
  const poly = (furniture.samples || []).filter(
    (s) => !(s.categories || []).includes('characters') && s.source !== 'grab3d',
  )
  return {
    ...furniture,
    sources: ['polyhaven', 'grab3d-characters', 'grab3d-animals'],
    license: 'CC0 (Poly Haven + Grab3D 人形与动物)',
    updatedAt: animals.updatedAt || characters.updatedAt || furniture.updatedAt,
    samples: [...(characters.samples || []), ...(animals.samples || []), ...poly],
    charactersReady: m3dCharactersVendorReady(appRoot),
    animalsReady: m3dAnimalsVendorReady(appRoot),
  }
}