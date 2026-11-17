/**
 * 技能包落盘：把解压出的全部条目写到 `<stateRoot>/installed-skills/<id>/`。
 *
 * 写入顺序（见 design 决策 5）：
 *   校验 → 写临时目录 → 旧目录改名为 .bak → 临时目录 rename 为正式目录 → 删 .bak
 * 任何一步失败都回滚到旧目录，保证「要么全新，要么全旧」，不出现正文与附件来自不同批次。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureInstalledSkillsDir, installedSkillDir, safeSkillId } from './skills.mjs'

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    /* 尽力清理；失败不该掩盖原始错误 */
  }
}

/**
 * 把 files 写到 `installed-skills/<id>/`。
 * @param {string} appRoot
 * @param {string} id
 * @param {Array<{ path: string, data: Uint8Array }>} files 已由 skillZip 归一化并校验过
 * @returns {{ dir: string, fileCount: number, totalBytes: number }}
 */
export function writeInstalledSkill(appRoot, id, files) {
  const safe = safeSkillId(id)
  if (!Array.isArray(files) || !files.length) throw new Error('技能包没有可落盘的文件')
  if (!files.some((f) => /^SKILL\.md$/i.test(f.path))) throw new Error('技能包缺少 SKILL.md')

  ensureInstalledSkillsDir(appRoot)
  const target = installedSkillDir(appRoot, safe)
  const parent = path.dirname(target)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmp = path.join(parent, `.tmp-${safe}-${stamp}`)
  const bak = path.join(parent, `.bak-${safe}-${stamp}`)

  let totalBytes = 0
  try {
    for (const f of files) {
      const rel = String(f.path || '')
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) {
        throw new Error(`技能包内含非法路径：${rel}`)
      }
      const full = path.join(tmp, rel)
      const back = path.relative(tmp, full)
      if (!back || back.startsWith('..') || path.isAbsolute(back)) {
        throw new Error(`技能包内含非法路径：${rel}`)
      }
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, Buffer.from(f.data))
      totalBytes += f.data.length
    }
  } catch (e) {
    rmrf(tmp)
    throw e
  }

  // 校验阶段已全部通过，这里只做替换
  let hadOld = false
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, bak)
      hadOld = true
    }
  } catch (e) {
    rmrf(tmp)
    throw new Error(`技能目录无法替换：${(e && e.message) || e}`)
  }

  try {
    fs.renameSync(tmp, target)
  } catch (e) {
    // 回滚：把旧目录放回原位
    if (hadOld) {
      try {
        fs.renameSync(bak, target)
      } catch {
        /* 回滚也失败时保留 .bak，至少数据还在 */
      }
    }
    rmrf(tmp)
    throw new Error(`技能目录写入失败：${(e && e.message) || e}`)
  }

  if (hadOld) rmrf(bak)
  return { dir: target, fileCount: files.length, totalBytes }
}

/** 删除某技能的安装目录；不存在时静默返回 false */
export function removeInstalledSkill(appRoot, id) {
  const target = installedSkillDir(appRoot, id)
  if (!fs.existsSync(target)) return false
  fs.rmSync(target, { recursive: true, force: true })
  return true
}
