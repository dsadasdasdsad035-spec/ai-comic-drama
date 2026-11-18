/**
 * 从 SkillHub zip 或本地上传的 zip 中提取技能包内容。
 *
 * 一次解压两份结果：
 * - `parseSkillPackage` 返回全量条目，安装时整体落盘（references/scripts/assets 都保留）；
 * - `extractSkillMdFromZip` 仍返回单个 SKILL.md，供只关心正文的调用方与既有验收脚本使用。
 */
import { unzipSync } from 'fflate'

const MAX_ZIP_BYTES = 65 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

/**
 * 可读文本文件的单文件上限，读工具的硬上限也用这个值。
 *
 * 必须与读取端同源：装得下但读不到，等于给模型一条兑现不了的指引。
 * 图片/音视频这类只做素材、从不经 read_skill_file 读取的文件仍按 MAX_FILE_BYTES 放行。
 */
export const MAX_READABLE_FILE_BYTES = 256 * 1024

/** 会被 read_skill_file 当文本读的扩展名 */
const READABLE_EXT = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.py',
  '.js',
  '.mjs',
  '.ts',
  '.csv',
  '.html',
  '.css',
  '.xml',
  '.toml',
])

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
/** unix 文件类型掩码里的符号链接 */
const S_IFLNK = 0xa000

function cleanZipPath(name) {
  const n = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = n.split('/').filter((p) => p && p !== '..' && p !== '.')
  return parts.join('/')
}

/**
 * 严格版本的路径归一化：不再静默剥离 `..`，遇到就越界报错。
 * cleanZipPath 只用于展示与旧调用方；写盘路径必须走这里。
 */
function safeZipPath(raw) {
  const n = String(raw || '').replace(/\\/g, '/')
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n)) {
    throw new Error(`zip 内含无效路径：${raw}`)
  }
  const parts = []
  for (const seg of n.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') throw new Error(`zip 内含越界路径：${raw}`)
    parts.push(seg)
  }
  const out = parts.join('/')
  if (!out) throw new Error(`zip 内含无效路径：${raw}`)
  return out
}

function sharedTopDir(names) {
  if (!names.length) return null
  const first = names[0].split('/')
  if (first.length < 2) return null
  const root = first[0]
  if (names.every((n) => n.startsWith(`${root}/`))) return root
  return null
}

/**
 * 扫中央目录挑出符号链接条目。
 *
 * fflate 的 unzipSync 只给文件名与内容，不暴露 unix mode，所以符号链接会被当作普通文件
 * 解出来（内容是目标路径文本）。这里直接读中央目录的 external attributes 拒绝它们，
 * 避免「包里有链接」这件事以任何形式被当成普通文件落盘。
 */
function zipSymlinkNames(buf) {
  const names = new Set()
  if (buf.length < 22) return names
  let eocd = -1
  const floor = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return names
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  // zip64 的计数/偏移是 0xffff/0xffffffff 占位，本平台不生成也不接受这种包扫描结果
  if (count === 0xffff || off === 0xffffffff) return names
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CENTRAL_SIG) break
    const madeBy = buf.readUInt16LE(off + 4)
    const extAttr = buf.readUInt32LE(off + 38)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    if (off + 46 + nameLen > buf.length) break
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    // 高字节 3 表示 unix 宿主；只有它才把 external attributes 高 16 位当 unix mode
    if (madeBy >> 8 === 3 && ((extAttr >>> 16) & 0xf000) === S_IFLNK) names.add(name)
    off += 46 + nameLen + extraLen + commentLen
  }
  return names
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

/**
 * 解压为归一化条目数组。剥离公共顶层目录，过滤目录条目与系统垃圾文件。
 * @returns {{ path: string, text: string, files: Array<{ path: string, data: Uint8Array }> }}
 */
export function parseSkillPackage(buffer) {
  if (!buffer?.length) throw new Error('空的 zip 包')
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('技能包超过 65MB 上限')

  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const symlinks = zipSymlinkNames(raw)

  let entries
  try {
    entries = unzipSync(new Uint8Array(raw), {
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

  // 先按原始名做安全校验：剥离公共顶层目录时 cleanZipPath 会吞掉 `..`，
  // 一旦先剥离，`pkg/../escape.md` 就变成看似合法的 `escape.md`。
  for (const rawName of names) {
    if (symlinks.has(rawName)) throw new Error(`zip 内含符号链接：${rawName}`)
    safeZipPath(rawName)
  }

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
  const files = []
  for (const rawName of names) {
    const p = safeZipPath(rawName)
    const data = entries[rawName]
    // 0 字节文件是包内合法文件（.keep、__init__.py、空 config.yaml）：目录条目与系统
    // 垃圾文件已在解压 filter 里排除，这里不能再按长度丢弃，否则磁盘结构与 zip 不一致。
    if (!data) continue
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(`文件 ${p} 超过 ${Math.floor(MAX_FILE_BYTES / 1024)}KB 限制`)
    }
    // 文本类附件装进去却读不出来，比直接拒绝更糟：这里和读工具共用同一个上限
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
    if (READABLE_EXT.has(ext) && data.length > MAX_READABLE_FILE_BYTES) {
      throw new Error(
        `文件 ${p} 超过 ${Math.floor(MAX_READABLE_FILE_BYTES / 1024)}KB 上限（模型读不完整，请拆分后再打包）`,
      )
    }
    total += data.length
    if (total > MAX_TOTAL_BYTES) throw new Error('解压后总量超过 64MB 限制')
    files.push({ path: p, data })
  }
  if (!files.length) throw new Error('zip 中没有可用文件')

  const skillCandidates = files.filter((f) => /(^|\/)SKILL\.md$/i.test(f.path))
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
  return { path: pick.path, text, files }
}

/** 只要正文的旧入口；内部复用 parseSkillPackage，避免两套解压与路径校验。 */
/** @returns {{ path: string, text: string }} */
export function extractSkillMdFromZip(buffer) {
  const { path: p, text } = parseSkillPackage(buffer)
  return { path: p, text }
}
