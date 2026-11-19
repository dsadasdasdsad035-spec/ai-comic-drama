#!/usr/bin/env node
/**
 * 清理已从仓库移除的小说系内置技能：删 skill_installs / overrides / installed-skills 目录，
 * 并重编专家技能根（仅当发现残留时写 patch）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dbPath,
  deleteSkillInstall,
  deleteSkillOverride,
  getSkillInstall,
  getSkillOverride,
  listSkillInstalls,
} from '../server/db.mjs'
import { removeInstalledSkill } from '../server/skillStore.mjs'
import { installedSkillDir } from '../server/skills.mjs'
import { writeExpertsPatch } from '../server/dsh-experts.mjs'

const REMOVED_SKILL_IDS = [
  'character-refs',
  'novel-art',
  'novel-characters',
  'novel-outline',
  'novel-script',
  'novel-staging',
  'novel-storyboard',
]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function purgeOne(appRoot, id, log) {
  let changed = false
  if (getSkillInstall(id)) {
    removeInstalledSkill(appRoot, id)
    deleteSkillInstall(id)
    log.push(`已卸载 DB 记录并删除目录：${id}`)
    changed = true
  } else if (fs.existsSync(installedSkillDir(appRoot, id))) {
    removeInstalledSkill(appRoot, id)
    log.push(`已删除孤儿安装目录：${id}`)
    changed = true
  }
  if (getSkillOverride(id)) {
    deleteSkillOverride(id)
    log.push(`已删除技能正文覆盖：${id}`)
    changed = true
  }
  return changed
}

async function loadRegisteredToolNames() {
  const { builtinPlatformToolNames } = await import('../src/agent/builtinPlatformTools.ts')
  return builtinPlatformToolNames()
}

async function main() {
  dbPath(ROOT)
  const log = []
  let any = false
  for (const id of REMOVED_SKILL_IDS) {
    any = purgeOne(ROOT, id, log) || any
  }

  const remaining = listSkillInstalls().map((x) => x.id)
  const removedLeft = REMOVED_SKILL_IDS.filter((id) => remaining.includes(id))

  if (!any) {
    console.log('未发现 7 个已移除技能的 DB 记录、覆盖或 installed-skills 目录。')
  } else {
    for (const line of log) console.log(line)
  }

  if (removedLeft.length) {
    console.error('仍有安装记录未删掉：', removedLeft.join('、'))
    process.exit(1)
  }

  const registeredNames = await loadRegisteredToolNames()
  const dshHome = path.join(ROOT, 'dsh')
  const patch = writeExpertsPatch({ dshHome, root: ROOT, registeredNames, log: () => {} })
  if (patch.written) {
    console.log('已重编专家 patch（技能根已同步）。请重启 DSH 宿主。')
  } else {
    console.log('专家 patch 无需更新。')
  }
  console.log(`当前已安装技能（DB）：${remaining.join(', ') || '(无)'}`)
}

main().catch((e) => {
  console.error(e?.message || e)
  process.exit(1)
})