/**
 * 技能包文件：单文件读取的边界、工具清单收敛、专家白名单。
 *
 * 单文件读取的边界全都落在 server/skills.mjs 里（越界、符号链接、缺失、超限），
 * 所以这里直接用临时目录构造磁盘布局来测真实实现，而不是 mock 出一份行为。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSkillSubFile, listSkillAttachments, MAX_SKILL_FILE_BYTES } from '../server/skills.mjs'
import { SKILL_ID_READ_TOOLS, SKILL_READ_TOOL_NAMES, KNOWN_TOOL_IDS } from '../src/skills/tools'
import { wrapSkillReadForExpert } from '../src/creative/expertTools'
import { defineTool } from '../src/agent/tool'
import { z } from 'zod'

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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-files-'))
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-files-state-'))
process.env.SB_STATE_ROOT = STATE

const ID = 'unit-fixture'
const KEY = 'unit-key' // 内置目录里放一个「不该被读到」的文件，用来验证逃逸拦截

fs.mkdirSync(path.join(ROOT, 'skills', ID, 'references'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'skills', ID, 'SKILL.md'), '---\nname: unit-fixture\n---\n正文\n')
fs.writeFileSync(path.join(ROOT, 'skills', ID, 'references', 'guide.md'), '# 指南\n完整内容\n')
fs.writeFileSync(path.join(ROOT, 'skills', KEY), 'SECRET')

await check('读取包内文件成功', () => {
  const got = readSkillSubFile(ROOT, ID, 'references/guide.md')
  assert.equal(got.text, '# 指南\n完整内容\n')
  assert.equal(got.path, 'references/guide.md')
  assert.equal(got.source, 'builtin')
  assert.ok(got.bytes > 0)
})

await check('越界路径被拒绝且不读内容', () => {
  for (const p of ['../unit-key', '../../etc/passwd', '/etc/passwd', 'references/../../unit-key']) {
    assert.throws(
      () => readSkillSubFile(ROOT, ID, p),
      (e: Error) => /不合法|不存在/.test(e.message) && !e.message.includes('SECRET'),
      `未拒绝：${p}`,
    )
  }
})

await check('符号链接逃逸被拒绝', () => {
  const link = path.join(ROOT, 'skills', ID, 'references', 'escape.md')
  try {
    fs.symlinkSync(path.join(ROOT, 'skills', KEY), link)
  } catch {
    // 无符号链接权限的环境：跳过而不是假通过
    console.log('   （环境不支持 symlink，跳过）')
    return
  }
  assert.throws(
    () => readSkillSubFile(ROOT, ID, 'references/escape.md'),
    (e: Error) => /不合法|不存在/.test(e.message),
  )
  // 附件清单也不能把它当成正常文件带出去
  assert.ok(!listSkillAttachments(ROOT, ID).some((f) => f.path === 'references/escape.md'))
})

await check('文件不存在时返回现有文件清单', () => {
  assert.throws(
    () => readSkillSubFile(ROOT, ID, 'references/nope.md'),
    (e: Error) => e.message.includes('不存在') && e.message.includes('references/guide.md'),
  )
})

await check('超过单文件上限直接失败不截断', () => {
  const big = path.join(ROOT, 'skills', ID, 'references', 'big.md')
  fs.writeFileSync(big, 'x'.repeat(MAX_SKILL_FILE_BYTES + 1024))
  assert.throws(
    () => readSkillSubFile(ROOT, ID, 'references/big.md'),
    (e: Error) => e.message.includes('超过') && !e.message.includes('xxxx'),
  )
})

await check('技能 id 非法被拒绝', () => {
  assert.throws(() => readSkillSubFile(ROOT, '../x', 'SKILL.md'), /id 不合法/)
})

await check('技能读工具清单只有一个来源', () => {
  // 四处消费方共用常量：新增工具只改 src/skills/tools.ts
  assert.deepEqual([...SKILL_ID_READ_TOOLS], ['read_skill', 'read_skill_text', 'read_skill_file'])
  for (const n of SKILL_READ_TOOL_NAMES) assert.ok(KNOWN_TOOL_IDS.has(n), `${n} 未登记为已知工具`)
  assert.ok(SKILL_READ_TOOL_NAMES.includes('list_installed_skills'))
})

function fakeFileTool(onRun: () => void) {
  return defineTool({
    name: 'read_skill_file',
    description: '测试用',
    schema: z.object({ id: z.string(), path: z.string() }),
    run: async () => {
      onRun()
      return { ok: true }
    },
  })
}

await check('专家白名单拦截非名单技能', async () => {
  let ran = 0
  const wrapped = wrapSkillReadForExpert(fakeFileTool(() => ran++), ['other-skill'])
  const r = (await wrapped.run({ id: 'unit-fixture', path: 'references/guide.md' })) as { ok: boolean; error?: string }
  assert.equal(r.ok, false)
  assert.ok(String(r.error).includes('不允许'), String(r.error))
  assert.equal(ran, 0, '被拒时不应真正读文件')
})

await check('专家白名单放行名单内技能与通配', async () => {
  let ran = 0
  const listed = wrapSkillReadForExpert(fakeFileTool(() => ran++), ['unit-fixture'])
  const r1 = (await listed.run({ id: 'unit-fixture', path: 'references/guide.md' })) as { ok: boolean }
  assert.equal(r1.ok, true)
  const wildcard = wrapSkillReadForExpert(fakeFileTool(() => ran++), ['*'])
  const r2 = (await wildcard.run({ id: 'anything', path: 'a.md' })) as { ok: boolean }
  assert.equal(r2.ok, true)
  assert.equal(ran, 2)
})

fs.rmSync(ROOT, { recursive: true, force: true })
fs.rmSync(STATE, { recursive: true, force: true })

console.log(bad ? `\n❌ ${bad} 个断言失败` : '\n✅ 技能包文件测试通过')
process.exit(bad ? 1 : 0)
