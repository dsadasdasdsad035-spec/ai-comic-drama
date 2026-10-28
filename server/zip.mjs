/**
 * 最小 ZIP 读取器：只支持业务需要的子集，不引入依赖也不调系统 unzip。
 *
 * 为什么自己写：Docker 镜像里没有 unzip 命令（实测），而加一个解压 npm 包
 * 要同时验证 macOS/Windows/Docker；ZIP 的必要子集很短——EOCD → 中央目录
 * → 本地头偏移 → inflateRaw。中文文件名必须按「UTF-8 严格 → GB18030」兜底，
 * 因为 macOS 的 zip 不设 UTF-8 标志位却写裸 UTF-8 字节（实测 31/31 条目如此）。
 *
 * 安全边界：拒绝路径穿越、绝对路径、符号链接、设备文件、嵌套压缩包；
 * 解压累计字节超限立即中止。不按压缩比判炸弹——真实素材包压缩比本来就接近 1。
 */
import zlib from 'node:zlib'
import path from 'node:path'

export const MAX_ENTRIES = 2000
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const ZIP64_LOCATOR_SIG = 0x07064b50

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic)$/i
const TEXT_EXT = /\.(md|markdown|txt|json|csv|tsv)$/i
const NESTED_ARCHIVE = /\.(zip|rar|7z|tar|gz)$/i

/** 系统垃圾：静默忽略，不进清单也不报错 */
function isJunk(entryPath) {
  const segs = entryPath.split('/')
  if (segs.some((s) => s === '__MACOSX')) return true
  const base = segs[segs.length - 1] || ''
  return base === '.DS_Store' || base === 'Thumbs.db' || base.startsWith('._')
}

/**
 * 文件名解码：标志位优先，未置位时先试 UTF-8（macOS 行为）再试 GB18030（GBK 超集）。
 * 用 fatal:true 判失败，不能用替换字符——那会把 GBK 中文静默变成一堆 �。
 */
export function decodeEntryName(raw, flags) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || [])
  if (flags & 0x800) {
    return { name: buf.toString('utf8'), encoding: 'utf8-flag' }
  }
  try {
    const name = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return { name, encoding: 'utf8' }
  } catch {
    /* 落到 GB18030 */
  }
  try {
    const name = new TextDecoder('gb18030', { fatal: true }).decode(buf)
    return { name, encoding: 'gb18030' }
  } catch {
    /* 两种都不是，用安全名 */
  }
  const hex = buf.toString('hex').slice(0, 32) || 'unnamed'
  return { name: `__undecodable-${hex}`, encoding: 'fallback' }
}

/** 路径安全检查：返回拒绝原因或 null */
export function unsafeReason(entryPath, unixMode) {
  const p = String(entryPath || '')
  if (!p) return '路径为空'
  if (p.startsWith('/') || p.startsWith('\\')) return '绝对路径'
  if (/^[a-zA-Z]:/.test(p)) return '盘符路径'
  const segs = p.split(/[\\/]+/)
  if (segs.some((s) => s === '..')) return '包含 .. 路径段'
  // unix 模式位：符号链接 / 字符设备 / 块设备 / 命名管道 / 套接字
  const type = (Number(unixMode) || 0) & 0o170000
  if (type === 0o120000) return '符号链接'
  if (type === 0o020000 || type === 0o060000) return '设备文件'
  if (type === 0o010000 || type === 0o140000) return '特殊文件'
  if (NESTED_ARCHIVE.test(p)) return '嵌套压缩包（不解包）'
  return null
}

/** 只保留安全、可写盘的文件名（落临时目录用） */
function safeFileName(name) {
  const base = String(name || '').split(/[\\/]+/).filter(Boolean).pop() || 'file'
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/**
 * 列出压缩包条目（不解压内容）。返回的条目带解码后的名字、原始路径与安全名。
 * ZIP64 直接拒绝（单文件上限远小于 4GB，不需要支持）。
 */
export function listZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('不是有效的 ZIP：文件太小')
  // ZIP64 locator 紧邻 EOCD 之前
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到目录结尾记录')
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    throw new Error('不支持 ZIP64 压缩包（单文件超过 4GB 的包请先拆分）')
  }

  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count > MAX_ENTRIES) throw new Error(`压缩包条目过多：${count} 条，上限 ${MAX_ENTRIES}`)
  if (cdOffset >= buf.length) throw new Error('不是有效的 ZIP：目录偏移越界')

  const entries = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) {
      throw new Error('ZIP 中央目录损坏')
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const rawSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const externalAttrs = buf.readUInt32LE(p + 38)
    const localOffset = buf.readUInt32LE(p + 42)
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen)
    const decoded = decodeEntryName(nameBuf, flags)
    const unixMode = externalAttrs >>> 16
    const isDir = decoded.name.endsWith('/') || decoded.name.endsWith('\\')

    entries.push({
      /** 解码后的完整路径 */
      path: decoded.name,
      /** 解码方式，用于在清单里标注原名不可读 */
      encoding: decoded.encoding,
      /** 落盘用的安全基名 */
      safeName: safeFileName(decoded.name),
      dir: isDir,
      method,
      crc,
      compSize,
      rawSize,
      localOffset,
      unixMode,
      flags,
      junk: isJunk(decoded.name),
      unsafe: unsafeReason(decoded.name, unixMode),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 判断条目属于图片还是文本（用于限额与分派） */
export function entryKind(entry) {
  if (IMAGE_EXT.test(entry.path)) return 'image'
  if (TEXT_EXT.test(entry.path)) return 'text'
  return 'other'
}

/** 单条目大小上限：图片与文本不同 */
export function limitFor(entry) {
  return entryKind(entry) === 'text' ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES
}

/**
 * 解出一个条目的原始字节。
 *
 * 解压时按声明大小预检，并在实际输出超限时立即抛错中止——
 * 这样即使中央目录谎报大小（压缩炸弹），膨胀也会在超限处被打断。
 */
export function readEntry(buf, entry, opts = {}) {
  const limit = Math.min(opts.limit ?? limitFor(entry), MAX_TOTAL_BYTES)
  if (entry.rawSize > limit) {
    throw new Error(`条目解压后 ${fmtMb(entry.rawSize)} 超过 ${fmtMb(limit)} 上限`)
  }
  const lo = entry.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LOCAL_SIG) {
    throw new Error('ZIP 本地文件头损坏')
  }
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compSize)

  let out
  if (entry.method === 0) {
    out = Buffer.from(data)
  } else if (entry.method === 8) {
    out = zlib.inflateRawSync(data, { maxOutputLength: limit })
  } else {
    throw new Error(`不支持的压缩方式：${entry.method}（只支持 stored 与 deflate）`)
  }
  if (out.length > limit) throw new Error(`条目解压后 ${fmtMb(out.length)} 超过 ${fmtMb(limit)} 上限`)
  return out
}

function fmtMb(n) {
  return `${(Number(n) / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 解包到目标目录：逐条过安全检查与限额。
 * 返回 { written, rejected, ignored, warnings }，不抛错——
 * 单个条目失败不该让整包失败，但超总量或条目数已在 listZip 阶段拒绝。
 */
export function extractZip(buf, entries, destDir, fsmod) {
  const fs = fsmod
  const written = []
  const rejected = []
  const ignored = []
  const warnings = []
  let total = 0
  const seen = new Set()

  for (const e of entries) {
    if (e.junk) {
      ignored.push(e.path)
      continue
    }
    if (e.dir) continue
    if (e.unsafe) {
      rejected.push({ path: e.path, reason: e.unsafe })
      continue
    }
    const kind = entryKind(e)
    if (kind === 'other') {
      rejected.push({ path: e.path, reason: '不是可导入的文本或图片' })
      continue
    }
    const limit = limitFor(e)
    if (e.rawSize > limit) {
      rejected.push({ path: e.path, reason: `解压后 ${fmtMb(e.rawSize)} 超过 ${fmtMb(limit)} 上限` })
      continue
    }
    if (total + e.rawSize > MAX_TOTAL_BYTES) {
      throw new Error(`解压后总计超过 ${fmtMb(MAX_TOTAL_BYTES)} 上限，已中止`)
    }
    let bytes
    try {
      bytes = readEntry(buf, e, { limit })
    } catch (err) {
      rejected.push({ path: e.path, reason: err?.message || String(err) })
      continue
    }
    total += bytes.length
    if (total > MAX_TOTAL_BYTES) throw new Error(`解压后总计超过 ${fmtMb(MAX_TOTAL_BYTES)} 上限，已中止`)

    // 同名条目加序号，避免后写覆盖前写
    let name = e.safeName
    if (seen.has(name)) {
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let i = 2
      while (seen.has(`${stem}-${i}${ext}`)) i++
      name = `${stem}-${i}${ext}`
    }
    seen.add(name)
    const target = path.join(destDir, name)
    fs.writeFileSync(target, bytes)
    written.push({ id: name, path: e.path, name, kind, size: bytes.length, encoding: e.encoding, bytes })
  }

  if (entries.some((e) => e.encoding === 'fallback')) {
    warnings.push('部分文件名无法识别编码，已用安全名保存')
  }
  return { written, rejected, ignored, warnings }
}
