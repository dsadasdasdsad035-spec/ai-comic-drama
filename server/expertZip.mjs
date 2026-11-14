/**
 * 专家 zip：experts/<id>/manifest.json + soul.md
 */
import { strToU8, unzipSync, zipSync } from 'fflate'
import { safeExpertId } from './experts.mjs'

const MAX_ZIP_BYTES = 8 * 1024 * 1024

function cleanZipPath(name) {
  const n = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = n.split('/').filter((p) => p && p !== '..' && p !== '.')
  return parts.join('/')
}

function decodeText(u8) {
  return new TextDecoder('utf-8').decode(u8)
}

/** @param {object} expert */
function expertZipEntries(expert) {
  const id = safeExpertId(expert.id)
  const manifest = JSON.stringify(
    {
      id,
      name: String(expert.name || id),
      description: String(expert.description || ''),
      iconUrl: String(expert.iconUrl || ''),
      imageDescription: String(expert.imageDescription || '').slice(0, 500),
      skillIds: Array.isArray(expert.skillIds) ? expert.skillIds : [],
      toolIds: Array.isArray(expert.toolIds) ? expert.toolIds : [],
    },
    null,
    2,
  )
  const soul = String(expert.soul || '')
  return {
    [`${id}/manifest.json`]: strToU8(manifest),
    [`${id}/soul.md`]: strToU8(soul),
  }
}

/** 多个专家打成一个 zip（导入接口同样支持） */
export function expertsBundleToZipBuffer(experts) {
  if (!Array.isArray(experts) || !experts.length) throw new Error('没有可打包的专家')
  const files = {}
  for (const row of experts) Object.assign(files, expertZipEntries(row))
  return Buffer.from(zipSync(files))
}

export function expertToZipBuffer(expert) {
  return Buffer.from(zipSync(expertZipEntries(expert)))
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Array<{ id, name, description, soul, skillIds, toolIds }>}
 */
export function expertsFromZipBuffer(buffer) {
  if (!buffer?.length) throw new Error('空的 zip 包')
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('专家 zip 超过 2MB 上限')
  let entries
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (f.name.endsWith('/')) return false
        if (f.name.includes('__MACOSX') || f.name.endsWith('.DS_Store')) return false
        return true
      },
    })
  } catch {
    throw new Error('不是有效的 zip 文件')
  }
  const byPath = new Map()
  for (const [raw, data] of Object.entries(entries)) {
    byPath.set(cleanZipPath(raw), data)
  }
  const manifests = [...byPath.keys()].filter((p) => p.endsWith('/manifest.json') || p === 'manifest.json')
  if (!manifests.length) throw new Error('zip 中找不到 manifest.json')

  const out = []
  for (const mfPath of manifests) {
    const dir = mfPath.includes('/') ? mfPath.slice(0, mfPath.lastIndexOf('/')) : ''
    const soulPath = dir ? `${dir}/soul.md` : 'soul.md'
    const mfU8 = byPath.get(mfPath)
    if (!mfU8) continue
    let manifest
    try {
      manifest = JSON.parse(decodeText(mfU8))
    } catch {
      throw new Error(`无法解析 ${mfPath}`)
    }
    const id = safeExpertId(manifest.id || dir.split('/').pop())
    const soulU8 = byPath.get(soulPath)
    const soul = soulU8 ? decodeText(soulU8) : ''
    out.push({
      id,
      name: String(manifest.name || id).slice(0, 120),
      description: String(manifest.description || '').slice(0, 500),
      iconUrl: String(manifest.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(manifest.imageDescription || '').slice(0, 500),
      soul,
      skillIds: Array.isArray(manifest.skillIds) ? manifest.skillIds.map(String) : [],
      toolIds: Array.isArray(manifest.toolIds) ? manifest.toolIds.map(String) : [],
    })
  }
  if (!out.length) throw new Error('未从 zip 解析出专家')
  return out
}