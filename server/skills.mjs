/**
 * 技能文件读取：只把 SKILL.md 当数据，不执行。
 * 路径只允许 skills/<id>/SKILL.md，挡掉 ../、绝对路径和符号链接逃逸。
 */
import fs from 'node:fs'
import path from 'node:path'

export const MAX_SKILL_BYTES = 64 * 1024
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function safeSkillId(id) {
  const v = String(id ?? '').trim()
  if (!ID_RE.test(v)) throw new Error(`技能 id 不合法：${v || '(空)'}`)
  return v
}

export function skillsDir(appRoot) {
  return path.join(appRoot, 'skills')
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

export function readSkillFile(appRoot, id) {
  const safe = safeSkillId(id)
  const dir = skillsDir(appRoot)
  const file = path.join(dir, safe, 'SKILL.md')
  let realDir
  let realFile
  try {
    realDir = fs.realpathSync(dir)
    realFile = fs.realpathSync(file)
  } catch {
    throw new Error(`技能文件不存在：${safe}`)
  }
  if (realFile !== path.join(realDir, safe, 'SKILL.md') || !realFile.startsWith(realDir + path.sep)) {
    throw new Error(`技能路径不合法：${safe}`)
  }
  const st = fs.statSync(realFile)
  if (!st.isFile()) throw new Error(`技能路径不是文件：${safe}`)
  if (st.size > MAX_SKILL_BYTES) {
    throw new Error(`技能文件超过 ${MAX_SKILL_BYTES} 字节：${safe}`)
  }
  return fs.readFileSync(realFile, 'utf8')
}

export function listSkillFiles(appRoot) {
  const dir = skillsDir(appRoot)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { skills: [], errors: [{ id: '*', message: `技能目录不存在：${dir}` }] }
  }
  const skills = []
  const errors = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
    try {
      skills.push({ id: entry.name, text: readSkillFile(appRoot, entry.name) })
    } catch (e) {
      errors.push({ id: entry.name, message: e?.message || String(e) })
    }
  }
  skills.sort((a, b) => a.id.localeCompare(b.id))
  return { skills, errors }
}
