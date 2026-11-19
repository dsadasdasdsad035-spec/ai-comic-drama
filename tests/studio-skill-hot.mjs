/**
 * 技能集合变更后的专家技能根同步（dsh-tool-bridge 的「技能从文件系统包发现并可热加载」
 * 与 creative-experts 的「技能集合变更后专家预设自动重建」）。
 *
 * 旧实现有两个静默失效：
 * 1. 技能上传/卸载的路由根本不触发同步——新装技能即使重启宿主也不出现，
 *    得再保存一次专家设置才生效；
 * 2. 技能根是删掉重建——窗口期内技能全部不可见，监听器看到一次大批量事件。
 *
 * 跑法：`node tests/studio-skill-hot.mjs`
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { syncExpertSkillRoot, resolveSkillWhitelist } from '../server/dsh-experts.mjs'
import { listSkillFiles } from '../server/skills.mjs'
import { dbPath } from '../server/db.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hot-'))
process.env.SB_STATE_ROOT = TMP
dbPath(TMP)

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

/** 造一个假技能根：不依赖仓库里到底装了哪些技能，用例才可复现 */
function makeSkillRoot(ids) {
  const root = fs.mkdtempSync(path.join(TMP, 'skills-'))
  for (const id of ids) {
    const dir = path.join(root, 'skills', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${id}\n---\n\n# ${id}\n`, 'utf8')
  }
  return root
}

/** 技能根目录下的条目名（不含隐藏的临时目录） */
function entries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

const root = makeSkillRoot(['alpha', 'beta', 'gamma'])
const dshHome = path.join(TMP, 'dsh')
const available = listSkillFiles(root).skills.map((s) => s.id)
assert.ok(available.includes('alpha'), '假技能根应被 listSkillFiles 识别')

await check('白名单内的技能被挂进根', () => {
  const base = path.join(dshHome, 'experts', 'e1', 'skills')
  const r = syncExpertSkillRoot({
    dshHome,
    root,
    expert: { id: 'e1', skillIds: ['alpha', 'beta'] },
  })
  assert.deepEqual(entries(base), ['alpha', 'beta'])
  assert.equal(r.linked, 2)
  assert.equal(r.removed, 0)
  assert.equal(r.wildcard, false)
})

await check('白名单收窄只删多余项，不动仍在白名单的条目', () => {
  const base = path.join(dshHome, 'experts', 'e1', 'skills')
  const before = fs.lstatSync(path.join(base, 'alpha'))
  const r = syncExpertSkillRoot({ dshHome, root, expert: { id: 'e1', skillIds: ['alpha'] } })
  assert.deepEqual(entries(base), ['alpha'])
  assert.equal(r.linked, 0, '没有新增就不该重建已有条目')
  assert.equal(r.removed, 1, '应只移除 beta')
  // 已在白名单里的软链不该被替换（inode/时间戳保持）
  const after = fs.lstatSync(path.join(base, 'alpha'))
  assert.equal(after.ino, before.ino, '已有条目必须是原地保留，而不是删掉重建')
})

await check('白名单扩大只补缺失项', () => {
  const base = path.join(dshHome, 'experts', 'e1', 'skills')
  const r = syncExpertSkillRoot({ dshHome, root, expert: { id: 'e1', skillIds: ['alpha', 'gamma'] } })
  assert.deepEqual(entries(base), ['alpha', 'gamma'])
  assert.equal(r.linked, 1, '只应补 gamma')
})

await check('通配白名单覆盖新增技能', () => {
  const base = path.join(dshHome, 'experts', 'wild', 'skills')
  syncExpertSkillRoot({ dshHome, root, expert: { id: 'wild', skillIds: ['*'] } })
  assert.deepEqual(entries(base), ['alpha', 'beta', 'gamma'])

  // 新增一个技能后，通配专家应能覆盖到它
  const added = path.join(root, 'skills', 'delta')
  fs.mkdirSync(added, { recursive: true })
  fs.writeFileSync(path.join(added, 'SKILL.md'), '---\nname: delta\n---\n\n# delta\n', 'utf8')
  const r = syncExpertSkillRoot({ dshHome, root, expert: { id: 'wild', skillIds: ['*'] } })
  assert.deepEqual(entries(base), ['alpha', 'beta', 'delta', 'gamma'])
  assert.equal(r.linked, 1, '通配下只应补新增的 delta')
  assert.equal(r.wildcard, true)
})

await check('卸载技能后从全部专家移除', () => {
  const base = path.join(dshHome, 'experts', 'wild', 'skills')
  fs.rmSync(path.join(root, 'skills', 'gamma'), { recursive: true, force: true })
  const r = syncExpertSkillRoot({ dshHome, root, expert: { id: 'wild', skillIds: ['*'] } })
  assert.ok(!entries(base).includes('gamma'), '已卸载的技能必须从根里消失')
  assert.equal(r.removed, 1)
})

await check('同步过程中技能根不为空且无临时残留', () => {
  const base = path.join(dshHome, 'experts', 'e2', 'skills')
  syncExpertSkillRoot({ dshHome, root, expert: { id: 'e2', skillIds: ['alpha', 'beta'] } })
  // 收窄再扩大：整个过程结束后不该留下 `.<id>.tmp`
  syncExpertSkillRoot({ dshHome, root, expert: { id: 'e2', skillIds: ['alpha'] } })
  syncExpertSkillRoot({ dshHome, root, expert: { id: 'e2', skillIds: ['alpha', 'beta'] } })
  assert.deepEqual(entries(base), ['alpha', 'beta'])
  const all = fs.readdirSync(base)
  assert.ok(!all.some((n) => n.includes('.tmp')), `不应残留临时目录：${all.join(', ')}`)
})

await check('白名单外的技能不出现', () => {
  const base = path.join(dshHome, 'experts', 'e3', 'skills')
  syncExpertSkillRoot({ dshHome, root, expert: { id: 'e3', skillIds: ['alpha'] } })
  assert.deepEqual(entries(base), ['alpha'])
  assert.ok(!entries(base).includes('beta'), '白名单外必须连目录都不出现')
})

await check('白名单过滤掉磁盘上不存在的 id', () => {
  const wl = resolveSkillWhitelist(['alpha', 'ghost'], available)
  assert.deepEqual(wl.ids, ['alpha'], '不存在的 id 不能进根')
  const base = path.join(dshHome, 'experts', 'e4', 'skills')
  const r = syncExpertSkillRoot({ dshHome, root, expert: { id: 'e4', skillIds: ['alpha', 'ghost'] } })
  assert.deepEqual(entries(base), ['alpha'])
  assert.equal(r.linked, 1)
})

if (bad > 0) {
  console.error(`\n❌ 技能热同步测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 技能热同步测试全部通过')
