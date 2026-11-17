/**
 * 技能文件读取：只把 SKILL.md 等正文当数据，不执行。
 *
 * 两个根：
 * - `<appRoot>/skills/<id>/`：随代码分发的内置包，只读；
 * - `<stateRoot>/installed-skills/<id>/`：市场安装与上传的包，可写。
 *
 * 解析顺序是「安装优先、内置回落」，且是逐文件回落：安装目录缺某个文件时才看内置目录。
 * 路径只允许落在该技能自己的目录内，挡掉 ../、绝对路径和符号链接逃逸。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveStateRoot, statePath } from './paths.mjs'
import { MAX_READABLE_FILE_BYTES } from './skillZip.mjs'

export const MAX_SKILL_BYTES = 64 * 1024

/** 读包内单个文件的字节上限：与安装期校验同源，超限直接失败，不截断（半份引用比读不到更危险） */
export const MAX_SKILL_FILE_BYTES = MAX_READABLE_FILE_BYTES

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function safeSkillId(id) {
  const v = String(id ?? '').trim()
  if (!ID_RE.test(v)) throw new Error(`技能 id 不合法：${v || '(空)'}`)
  return v
}

/** 内置技能根：随代码分发 */
export function skillsDir(appRoot) {
  return path.join(appRoot, 'skills')
}

/** 安装技能根：可写状态根下；不叫 skills/ 是为了避免 dev 模式写进被 git 跟踪的目录 */
export function installedSkillsDir(appRoot) {
  return statePath(appRoot, 'installed-skills')
}

export function installedSkillDir(appRoot, id) {
  return path.join(installedSkillsDir(appRoot), safeSkillId(id))
}

/**
 * 解析某技能该用哪个目录：安装目录存在就用它，否则回落到内置目录。
 * 两个都不存在时返回 null，由调用方决定错误文案。
 */
export function resolveSkillDir(appRoot, id) {
  const safe = safeSkillId(id)
  const installed = path.join(installedSkillsDir(appRoot), safe)
  if (isDir(installed)) return { dir: installed, source: 'installed' }
  const builtin = path.join(skillsDir(appRoot), safe)
  if (isDir(builtin)) return { dir: builtin, source: 'builtin' }
  return null
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 把 SKILL.md 拆成 frontmatter 和正文；frontmatter 由内置文件拥有，用户只改正文。 */
export function splitSkillText(text) {
  const raw = String(text || '')
  const m = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/)
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: '', body: raw }
}

export function withBuiltinFrontmatter(builtinText, body) {
  return splitSkillText(builtinText).frontmatter + String(body || '')
}

/**
 * 在给定技能目录里定位一个相对路径的文件。
 * realpath 校验必须落在该目录内：挡掉 `..` 与符号链接两种逃逸。
 */
function resolveInsideDir(dir, relPath) {
  const rel = String(relPath ?? '').replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!rel) throw new Error('缺少文件路径')
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw new Error(`文件路径不合法：${relPath}`)

  const target = path.resolve(dir, rel)
  const back = path.relative(dir, target)
  if (!back || back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`文件路径不合法：${relPath}`)
  }

  let realDir
  let realFile
  try {
    realDir = fs.realpathSync(dir)
    realFile = fs.realpathSync(target)
  } catch {
    throw new Error(`文件不存在：${rel}`)
  }
  const escaped = path.relative(realDir, realFile)
  if (!escaped || escaped.startsWith('..') || path.isAbsolute(escaped)) {
    throw new Error(`文件路径不合法：${relPath}`)
  }
  return realFile
}

/** 读某技能目录下的 SKILL.md 正文；找不到技能目录时抛错。 */
export function readSkillFile(appRoot, id) {
  const safe = safeSkillId(id)
  const hit = resolveSkillDir(appRoot, safe)
  if (!hit) throw new Error(`技能文件不存在：${safe}`)
  const file = resolveInsideDir(hit.dir, 'SKILL.md')
  const st = fs.statSync(file)
  if (!st.isFile()) throw new Error(`技能路径不是文件：${safe}`)
  if (st.size > MAX_SKILL_BYTES) {
    throw new Error(`技能文件超过 ${MAX_SKILL_BYTES} 字节：${safe}`)
  }
  return fs.readFileSync(file, 'utf8')
}

/**
 * 读技能包内单个文件（references/scripts/assets 等）。
 * 逐文件回落：安装目录有就用安装目录，没有才看内置目录。
 * @returns {{ text: string, bytes: number, path: string, source: 'installed' | 'builtin' }}
 */
export function readSkillSubFile(appRoot, id, relPath) {
  const safe = safeSkillId(id)

  const candidates = []
  const installed = path.join(installedSkillsDir(appRoot), safe)
  if (isDir(installed)) candidates.push({ dir: installed, source: 'installed' })
  const builtin = path.join(skillsDir(appRoot), safe)
  if (isDir(builtin)) candidates.push({ dir: builtin, source: 'builtin' })
  if (!candidates.length) throw new Error(`技能不存在：${safe}`)

  for (const c of candidates) {
    let file
    try {
      file = resolveInsideDir(c.dir, relPath)
    } catch (e) {
      // 「路径不合法」直接上抛（不能因为一个根没这个文件就绕过校验）；
      // 只有「文件不存在」才允许继续找下一个根。
      if (String(e?.message || '').startsWith('文件不存在')) continue
      throw e
    }
    const st = fs.statSync(file)
    if (!st.isFile()) continue
    if (st.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `文件 ${relPath} 超过 ${Math.floor(MAX_SKILL_FILE_BYTES / 1024)}KB 上限（${Math.ceil(st.size / 1024)}KB）`,
      )
    }
    return {
      text: fs.readFileSync(file, 'utf8'),
      bytes: st.size,
      path: String(relPath).replace(/\\/g, '/'),
      source: c.source,
    }
  }

  const have = listSkillAttachments(appRoot, safe)
    .map((a) => a.path)
    .join('、')
  throw new Error(`文件不存在：${relPath}${have ? `（该包现有文件：${have}）` : '（该包无附加文件）'}`)
}

/**
 * 列出某技能的附加文件（不含 SKILL.md），相对路径 + 字节数，按路径排序。
 * 逐文件合并两个根：安装目录优先，同名路径不重复列出。
 */
export function listSkillAttachments(appRoot, id) {
  const safe = safeSkillId(id)
  const seen = new Map()

  const installed = path.join(installedSkillsDir(appRoot), safe)
  if (isDir(installed)) collectFiles(installed, '', seen, SAFE_ATTACHMENT_SKIP)
  const builtin = path.join(skillsDir(appRoot), safe)
  if (isDir(builtin)) collectFiles(builtin, '', seen, SAFE_ATTACHMENT_SKIP)

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** 附件清单要跳过的东西：SKILL.md 本身已在正文位，系统垃圾文件不入清单 */
const SAFE_ATTACHMENT_SKIP = new Set(['SKILL.md', '.DS_Store'])

function collectFiles(dir, prefix, out, skip) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (skip.has(entry.name)) continue
    if (entry.name === '__MACOSX') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, rel, out, skip)
      continue
    }
    if (!entry.isFile()) continue // 符号链接及设备文件一律不进清单
    if (out.has(rel)) continue // 安装目录已提供该路径，不重复
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    out.set(rel, { path: rel, bytes: st.size })
  }
}

/**
 * 内置目录 + 市场安装；同 id 时安装记录覆盖磁盘条目（仅 API 层有效，不写回 skills/）。
 * @param {Array<{ id: string, text: string, provider?: string, slug?: string, namespace?: string, version?: string, meta?: object }>} installs
 */
export function mergeSkillCatalog(diskSkills, installs) {
  const byId = new Map()
  for (const s of diskSkills) {
    byId.set(s.id, { id: s.id, text: s.text, source: 'builtin' })
  }
  for (const inst of installs || []) {
    byId.set(inst.id, {
      id: inst.id,
      text: inst.text,
      source: inst.provider === 'upload' ? 'upload' : 'skillhub',
      skillhub: {
        slug: inst.slug || '',
        namespace: inst.namespace || '',
        version: inst.version || '',
        homepage: inst.meta?.homepage || '',
        name: inst.meta?.name || '',
      },
    })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * 列出磁盘上的技能：安装目录与内置目录都扫，同 id 以安装目录为准。
 * 每个条目带附件清单与计数，让「本包无附加文件」是可见状态而不是静默缺失。
 */
export function listSkillFiles(appRoot) {
  const errors = []
  const ids = new Set()

  for (const dir of [installedSkillsDir(appRoot), skillsDir(appRoot)]) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在不是错误：安装根可能还没建
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      ids.add(entry.name)
    }
  }

  if (!ids.size) {
    const dir = skillsDir(appRoot)
    return { skills: [], errors: [{ id: '*', message: `技能目录不存在：${dir}` }] }
  }

  const skills = []
  for (const id of [...ids].sort()) {
    try {
      const text = readSkillFile(appRoot, id)
      const attachments = listSkillAttachments(appRoot, id)
      skills.push({ id, text, attachments, fileCount: attachments.length })
    } catch (e) {
      errors.push({ id, message: e?.message || String(e) })
    }
  }
  return { skills, errors }
}

/** 确保安装根存在（启动时调用一次，避免首次安装与并发读互相等目录） */
export function ensureInstalledSkillsDir(appRoot) {
  fs.mkdirSync(installedSkillsDir(appRoot), { recursive: true })
  return installedSkillsDir(appRoot)
}

/** 诊断用：当前状态根，便于错误信息说明落盘位置 */
export function installedSkillsRoot(appRoot) {
  return resolveStateRoot(appRoot)
}
