/**
 * 项目媒体：角色三视图、场景/道具设定图这类长效参考图存放在
 * <projects>/<项目>/assets/，与项目数据库同一个目录树。
 *
 * 为什么不用 public/generated：那是被 gitignore 的公共产物池，
 * 工作区复制、重建或清理产物目录后，数据库里的 /generated 路径会变成悬空引用。
 * 项目媒体目录跟着 projects/ 走，项目数据搬到哪，图片就在哪。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveRoot, safeProjectName } from './db.mjs'

const ASSETS_DIR = 'assets'
const MAX_REF_BYTES = 30 * 1024 * 1024
const IMAGE_EXTS = /\.(png|jpe?g|webp)$/i

export function projectMediaDir(appRoot, name) {
  return path.join(resolveRoot(appRoot), safeProjectName(name), ASSETS_DIR)
}

export function projectMediaUrl(name, file) {
  return `/project-assets/${encodeURIComponent(safeProjectName(name))}/${encodeURIComponent(file)}`
}

/** 文件名只接受单段 basename，挡掉 ../、绝对路径和分隔符 */
export function safeMediaFile(file) {
  const raw = String(file || '')
  if (!raw || raw !== path.basename(raw) || raw === '.' || raw === '..') return null
  if (/[\\/]/.test(raw)) return null
  return raw
}

/** /project-assets/<项目>/<文件> → { name, file }；非法或越界返回 null */
export function parseProjectMediaUrl(ref) {
  const s = String(ref || '').split('?')[0]
  const m = s.match(/^\/project-assets\/([^/]+)\/([^/]+)$/)
  if (!m) return null
  try {
    const name = safeProjectName(decodeURIComponent(m[1]))
    const file = safeMediaFile(decodeURIComponent(m[2]))
    return file ? { name, file } : null
  } catch {
    return null
  }
}

export function isProjectMediaUrl(ref) {
  return Boolean(parseProjectMediaUrl(ref))
}

/** 项目媒体文件的绝对路径；名字或路径不合法时抛错 */
export function resolveProjectMediaPath(appRoot, name, file) {
  const safeName = safeProjectName(name)
  const safeFile = safeMediaFile(file)
  if (!safeFile) throw new Error(`非法的媒体文件名：${file}`)
  const dir = projectMediaDir(appRoot, safeName)
  const full = path.join(dir, safeFile)
  const rel = path.relative(dir, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('媒体路径越界')
  return full
}

export function projectMediaExists(appRoot, name, file) {
  try {
    return fs.existsSync(resolveProjectMediaPath(appRoot, name, file))
  } catch {
    return false
  }
}

/** 写一张项目图片，返回站内 URL（/project-assets/...） */
export function saveProjectImage(appRoot, name, bytes, ext = 'png', prefix = 'media') {
  const safeName = safeProjectName(name)
  const cleanExt = String(ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const cleanPrefix = String(prefix || 'media').replace(/[^a-z0-9-]/gi, '') || 'media'
  const dir = projectMediaDir(appRoot, safeName)
  fs.mkdirSync(dir, { recursive: true })
  const file = `${cleanPrefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${cleanExt}`
  fs.writeFileSync(path.join(dir, file), bytes)
  return { file, url: projectMediaUrl(safeName, file) }
}

/** 把已有的公共产物复制进项目目录；目标已存在时不重复复制 */
export function copyIntoProjectMedia(appRoot, name, sourceFile, file = '') {
  const safeName = safeProjectName(name)
  const target = safeMediaFile(file) || safeMediaFile(path.basename(sourceFile))
  if (!target) throw new Error(`非法的媒体文件名：${file || sourceFile}`)
  const dir = projectMediaDir(appRoot, safeName)
  fs.mkdirSync(dir, { recursive: true })
  const dst = path.join(dir, target)
  if (!fs.existsSync(dst)) fs.copyFileSync(sourceFile, dst)
  return { file: target, url: projectMediaUrl(safeName, target) }
}

/** 列出项目媒体图片（给素材选择器用），按修改时间倒序 */
export function listProjectImages(appRoot, name, limit = 120) {
  const dir = projectMediaDir(appRoot, name)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXTS.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f))
      return {
        name: f,
        url: projectMediaUrl(name, f),
        size: st.size,
        mtime: st.mtimeMs,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}

/**
 * 幂等迁移：把项目里的旧 /generated 引用改写到项目目录。
 * 优先复用项目目录里的同名文件（手工恢复路径），其次从 public/generated 复制。
 * 找不到文件时保留原引用并记入 missing，不造指向不存在文件的新 URL。
 */
export function migrateProjectMedia(appRoot, name, project) {
  const characters = Array.isArray(project?.characters) ? project.characters : []
  const designs = Array.isArray(project?.designs) ? project.designs : []
  const missing = new Set()
  let migrated = 0

  const rewrite = (ref) => {
    const s = String(ref || '')
    if (!s || s.startsWith('data:') || /^https?:\/\//i.test(s)) return s

    const pm = parseProjectMediaUrl(s)
    if (pm) {
      if (!projectMediaExists(appRoot, pm.name, pm.file)) missing.add(s)
      return s
    }
    if (!s.startsWith('/generated/')) return s

    const file = safeMediaFile(path.basename(s.split('?')[0]))
    if (!file) {
      missing.add(s)
      return s
    }
    const dst = resolveProjectMediaPath(appRoot, name, file)
    const src = path.join(appRoot, 'public', 'generated', file)
    try {
      if (!fs.existsSync(dst)) {
        if (!fs.existsSync(src)) {
          missing.add(s)
          return s
        }
        copyIntoProjectMedia(appRoot, name, src, file)
        migrated += 1
      }
      return projectMediaUrl(name, file)
    } catch {
      missing.add(s)
      return s
    }
  }

  const mapSheet = (sheet) => {
    if (!sheet || typeof sheet !== 'object') return sheet
    const next = { ...sheet }
    if (typeof sheet.image === 'string') next.image = rewrite(sheet.image)
    if (Array.isArray(sheet.candidates)) next.candidates = sheet.candidates.map((u) => rewrite(u))
    // 表情总图 / 单格裁剪 / 旧逐情绪表情 / 音色样本：和 image 一样都是项目媒体引用
    if (sheet.expression_sheet && typeof sheet.expression_sheet === 'object') {
      const es = sheet.expression_sheet
      next.expression_sheet = {
        ...es,
        ...(typeof es.image === 'string' ? { image: rewrite(es.image) } : {}),
        ...(Array.isArray(es.cells)
          ? {
              cells: es.cells.map((cell) =>
                cell && typeof cell === 'object' && typeof cell.cropUrl === 'string'
                  ? { ...cell, cropUrl: rewrite(cell.cropUrl) }
                  : cell,
              ),
            }
          : {}),
      }
    }
    if (sheet.expressions && typeof sheet.expressions === 'object') {
      const expressions = {}
      for (const [emotion, value] of Object.entries(sheet.expressions)) {
        if (!value || typeof value !== 'object') {
          expressions[emotion] = value
          continue
        }
        expressions[emotion] = {
          ...value,
          ...(typeof value.image === 'string' ? { image: rewrite(value.image) } : {}),
          ...(Array.isArray(value.candidates) ? { candidates: value.candidates.map((u) => rewrite(u)) } : {}),
        }
      }
      next.expressions = expressions
    }
    if (sheet.voice_sample && typeof sheet.voice_sample === 'object' && typeof sheet.voice_sample.url === 'string') {
      next.voice_sample = { ...sheet.voice_sample, url: rewrite(sheet.voice_sample.url) }
    }
    return next
  }

  const nextCharacters = characters.map(mapSheet)
  const nextDesigns = designs.map(mapSheet)
  const changed =
    JSON.stringify(nextCharacters) !== JSON.stringify(characters) ||
    JSON.stringify(nextDesigns) !== JSON.stringify(designs)

  return {
    characters: nextCharacters,
    designs: nextDesigns,
    migrated,
    missing: [...missing],
    changed,
  }
}

/** 本地相对路径 / dataURL / http URL / 项目媒体 URL → 可直接给方舟的 image 字段 */
export function resolveRef(ref, appRoot) {
  if (ref.startsWith('data:') || ref.startsWith('http')) return ref
  const pm = parseProjectMediaUrl(ref)
  const file = pm
    ? resolveProjectMediaPath(appRoot, pm.name, pm.file)
    : path.join(appRoot, 'public', String(ref).split('?')[0].replace(/^\//, ''))
  if (!fs.existsSync(file)) throw new Error(`参考图不存在：${ref}`)
  const size = fs.statSync(file).size
  if (size > MAX_REF_BYTES) throw new Error(`参考图超过 30MB：${ref}`)
  const buf = fs.readFileSync(file)
  const ext = path.extname(file).slice(1) || 'png'
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
}

export { MAX_REF_BYTES }
