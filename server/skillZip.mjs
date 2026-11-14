/**
 * 从 SkillHub zip 或本地上传的 zip 中提取 SKILL.md。
 */
import { unzipSync } from 'fflate'

const MAX_ZIP_BYTES = 65 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

function cleanZipPath(name) {
  const n = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = n.split('/').filter((p) => p && p !== '..' && p !== '.')
  return parts.join('/')
}

function sharedTopDir(names) {
  if (!names.length) return null
  const first = names[0].split('/')
  if (first.length < 2) return null
  const root = first[0]
  if (names.every((n) => n.startsWith(`${root}/`))) return root
  return null
}

/** 从 SKILL.md frontmatter 读取 name（不依赖 name 在其它字段之后） */
export function manifestNameFromSkillText(text) {
  const raw = String(text ?? '')
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const header = fm ? fm[1] : raw.slice(0, 800)
  const nm = header.match(/^name:\s*(.+)$/m)
  if (!nm) return ''
  return String(nm[1]).trim().replace(/^['"]|['"]$/g, '')
}

/** @returns {{ path: string, text: string }} */
export function extractSkillMdFromZip(buffer) {
  if (!buffer?.length) throw new Error('空的 zip 包')
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('技能包超过 65MB 上限')

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

  let names = Object.keys(entries)
  if (!names.length) throw new Error('zip 中没有可用文件')

  const top = sharedTopDir(names.map(cleanZipPath))
  if (top) {
    const stripped = {}
    for (const [key, val] of Object.entries(entries)) {
      const clean = cleanZipPath(key)
      if (!clean.startsWith(`${top}/`)) continue
      const short = clean.slice(top.length + 1)
      if (!short) continue
      stripped[short] = val
    }
    entries = stripped
    names = Object.keys(entries)
  }

  let total = 0
  const normalized = []
  for (const raw of names) {
    const p = cleanZipPath(raw)
    if (!p || p.startsWith('..')) throw new Error(`zip 内含无效路径：${raw}`)
    const data = entries[raw]
    if (!data?.length) continue
    if (data.length > MAX_FILE_BYTES) throw new Error(`文件 ${p} 超过 1MB 限制`)
    total += data.length
    if (total > MAX_TOTAL_BYTES) throw new Error('解压后总量超过 64MB 限制')
    normalized.push({ path: p, data })
  }

  const skillCandidates = normalized.filter((f) => /(^|\/)SKILL\.md$/i.test(f.path))
  if (!skillCandidates.length) throw new Error('zip 中未找到 SKILL.md')

  skillCandidates.sort((a, b) => {
    const depthA = a.path.split('/').length
    const depthB = b.path.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.path.localeCompare(b.path)
  })

  const pick = skillCandidates[0]
  const text = new TextDecoder('utf-8', { fatal: false }).decode(pick.data)
  if (!text.trim()) throw new Error('SKILL.md 为空')
  return { path: pick.path, text }
}
