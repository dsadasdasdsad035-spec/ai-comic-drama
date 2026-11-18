/**
 * 技能包保真：0 字节文件不得被丢弃、「记录在但目录不在」必须可辨识。
 *
 * 这两点都是「看起来一切正常」的静默失败：
 * - 空文件被解压阶段跳过，磁盘结构与 zip 不一致，而规格要求完全一致；
 * - 修复前装的记录只有正文、没有安装目录，回执与「本包本来就没有附件」完全相同。
 * 所以断言必须打到磁盘与回执字段，而不是只看函数返回值非空。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { parseSkillPackage } from '../server/skillZip.mjs'
import {
  hasInstalledSkillDir,
  installedSkillDir,
  installedSkillsDir,
  listSkillAttachments,
} from '../server/skills.mjs'
import { writeInstalledSkill } from '../server/skillStore.mjs'
import { parseSkillRecords } from '../src/skills/validate'
import { skillSummaryRow } from '../src/agent/stageTools'
import type { SkillTextRecord } from '../src/skills/types'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fidelity-'))
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fidelity-state-'))
process.env.SB_STATE_ROOT = STATE

const SKILL_ID = 'fidelity-fixture'
const EMPTY_PATHS = ['references/.keep', 'scripts/__init__.py', 'config.yaml']

function fixtureZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(`---\nname: ${SKILL_ID}\ndescription: 保真验收\n---\n正文\n`),
    'references/guide.md': strToU8('# 指南\n完整内容\n'),
    // 三个 0 字节文件：占位符、包初始化、空配置
    'references/.keep': new Uint8Array(0),
    'scripts/__init__.py': new Uint8Array(0),
    'config.yaml': new Uint8Array(0),
    // 垃圾文件与目录条目仍然要被排除
    '__MACOSX/._SKILL.md': strToU8('junk'),
    '.DS_Store': strToU8('junk'),
  })
}

await check('0 字节文件进入解析结果', () => {
  const { files } = parseSkillPackage(Buffer.from(fixtureZip()))
  const paths = files.map((f) => f.path).sort()
  for (const p of EMPTY_PATHS) {
    assert.ok(paths.includes(p), `缺失 ${p}`)
    const f = files.find((x) => x.path === p)!
    assert.equal(f.data.length, 0, `${p} 应为 0 字节`)
  }
})

await check('目录条目与系统垃圾文件仍被排除', () => {
  const { files } = parseSkillPackage(Buffer.from(fixtureZip()))
  const paths = files.map((f) => f.path)
  assert.ok(!paths.some((p) => p.includes('__MACOSX')), 'MACOSX 未排除')
  assert.ok(!paths.some((p) => p.endsWith('.DS_Store')), '.DS_Store 未排除')
  assert.ok(!paths.some((p) => p.endsWith('/')), '目录条目未排除')
})

await check('解析条目数与 zip 内有效文件数一致', () => {
  const { files } = parseSkillPackage(Buffer.from(fixtureZip()))
  // SKILL.md + guide.md + 3 个空文件
  assert.equal(files.length, 5, files.map((f) => f.path).join('、'))
})

await check('0 字节文件真实落盘且大小为 0', () => {
  const root = path.join(TMP, 'root-a')
  fs.mkdirSync(root, { recursive: true })
  const { files } = parseSkillPackage(Buffer.from(fixtureZip()))
  writeInstalledSkill(root, SKILL_ID, files)
  for (const p of EMPTY_PATHS) {
    const full = path.join(installedSkillDir(root, SKILL_ID), p)
    assert.ok(fs.existsSync(full), `${p} 未落盘`)
    assert.equal(fs.statSync(full).size, 0, `${p} 大小应为 0`)
  }
})

await check('附件清单列出 0 字节文件且 bytes 为 0', () => {
  const root = path.join(TMP, 'root-a')
  const list = listSkillAttachments(root, SKILL_ID)
  const byPath = new Map(list.map((a) => [a.path, a.bytes]))
  for (const p of EMPTY_PATHS) {
    assert.ok(byPath.has(p), `清单缺 ${p}：${[...byPath.keys()].join('、')}`)
    assert.equal(byPath.get(p), 0, `${p} bytes 应为 0`)
  }
  assert.ok(!byPath.has('SKILL.md'), 'SKILL.md 不应进附件清单')
})

await check('空 SKILL.md 仍被拒绝', () => {
  const zip = zipSync({
    'SKILL.md': new Uint8Array(0),
    'references/guide.md': strToU8('内容'),
  })
  assert.throws(
    () => parseSkillPackage(Buffer.from(zip)),
    (e: Error) => /SKILL\.md 为空/.test(e.message),
    '未拒绝空 SKILL.md',
  )
})

await check('只有空目录的 zip 仍被拒绝', () => {
  // fflate 允许只有目录条目的 zip：解压 filter 全部排除后应报「没有可用文件」
  const zip = zipSync({ 'pkg/empty/': new Uint8Array(0) })
  assert.throws(
    () => parseSkillPackage(Buffer.from(zip)),
    (e: Error) => /没有可用文件/.test(e.message),
    '未拒绝只有空目录的 zip',
  )
})

await check('hasInstalledSkillDir：目录存在为真', () => {
  const root = path.join(TMP, 'root-a')
  assert.equal(hasInstalledSkillDir(root, SKILL_ID), true)
})

await check('hasInstalledSkillDir：目录不存在为假', () => {
  const root = path.join(TMP, 'root-a')
  assert.equal(hasInstalledSkillDir(root, 'never-installed'), false)
})

await check('hasInstalledSkillDir：同名文件占位也算缺失', () => {
  const root = path.join(TMP, 'root-b')
  fs.mkdirSync(installedSkillsDir(root), { recursive: true })
  fs.writeFileSync(path.join(installedSkillsDir(root), 'file-as-dir'), 'not a dir')
  assert.equal(hasInstalledSkillDir(root, 'file-as-dir'), false)
})

function recordOf(id: string, filesMissing?: boolean): SkillTextRecord {
  return {
    id,
    text: `---\nname: ${id}\ndescription: 验收\n---\n正文\n`,
    builtinText: '',
    source: 'skillhub',
    ...(filesMissing ? { filesMissing: true } : {}),
  }
}

await check('装载期透传 filesMissing 到 Skill', () => {
  const out = parseSkillRecords([recordOf('marked', true), recordOf('normal')])
  assert.equal(out.skills.get('marked')?.filesMissing, true)
  assert.equal(out.skills.get('normal')?.filesMissing, undefined)
})

await check('skillSummaryRow 对缺失技能输出 filesMissing', () => {
  const out = parseSkillRecords([recordOf('marked', true), recordOf('normal')])
  const marked = skillSummaryRow(out.skills.get('marked')!)
  const normal = skillSummaryRow(out.skills.get('normal')!)
  assert.equal((marked as { filesMissing?: boolean }).filesMissing, true)
  assert.equal((normal as { filesMissing?: boolean }).filesMissing, undefined)
})

await check('缺失技能仍可解析出正文（不阻断读取）', () => {
  const out = parseSkillRecords([recordOf('marked', true)])
  const skill = out.skills.get('marked')!
  assert.ok(skill.text.includes('正文'))
  assert.equal(skill.profile, 'agent-pack')
})

fs.rmSync(TMP, { recursive: true, force: true })
fs.rmSync(STATE, { recursive: true, force: true })

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 技能包保真全部通过')
process.exit(bad ? 1 : 0)
