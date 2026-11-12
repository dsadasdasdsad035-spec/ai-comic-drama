import fs from 'node:fs'
import path from 'node:path'
import { copyIntoProjectMedia } from './media.mjs'

const CATALOG_ID = 'camera-moves-whitebox-132'

export function presetCatalogPath(appRoot) {
  return path.join(appRoot, 'public/presets', CATALOG_ID, 'manifest.json')
}

export function loadPresetCatalog(appRoot) {
  const p = presetCatalogPath(appRoot)
  if (!fs.existsSync(p)) throw new Error('运镜预置 catalog 缺失')
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

/** 把预置 MP4 复制进项目 media；同名已存在则复用 */
export function importCameraLexiconPreset(appRoot, project, key) {
  const catalog = loadPresetCatalog(appRoot)
  const ent = (catalog.entries || []).find((e) => e.key === String(key || '').trim())
  if (!ent) throw new Error(`未知运镜条目：${key}`)
  const filename = ent.filename || `${ent.key}.mp4`
  const src = path.join(appRoot, 'public/presets', CATALOG_ID, filename)
  if (!fs.existsSync(src)) throw new Error(`预置文件缺失：${filename}`)
  const target = `lexicon-${ent.key}.mp4`
  return {
    ...copyIntoProjectMedia(appRoot, project, src, target),
    key: ent.key,
    title: `${ent.cn} · ${ent.en}`,
    attribution: catalog.attribution || 'hong hou zi',
  }
}
