import assert from 'node:assert/strict'
import { composeSkillBody, parseSkillText } from '../src/skills/parse'
import { parseSkillRecords } from '../src/skills/validate'
import type { SkillTextRecord } from '../src/skills/types'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const skillText = (over: Record<string, string> = {}, task = '任务：{{input:a}}') => {
  const f: Record<string, string> = {
    name: 'demo',
    description: '一个用于测试的技能，描述足够长',
    stage: 'script',
    runtime: 'json-tools',
    tools: '[read_source]',
    inputs: '[a]',
    output: 'script-v1',
    contracts: '[script-v1]',
    version: '1',
    ...over,
  }
  return [
    '---',
    ...Object.entries(f).map(([k, v]) => `${k}: ${v}`),
    '---',
    '## 角色与约束',
    '你是测试角色。',
    '',
    '## 任务',
    task,
    '',
  ].join('\n')
}

check('合法技能可解析', () => {
  const s = parseSkillText('demo', skillText())
  assert.equal(s.manifest.name, 'demo')
  assert.equal(s.role, '你是测试角色。')
  assert.equal(s.task, '任务：{{input:a}}')
  assert.deepEqual(s.manifest.contracts, ['script-v1'])
})

check('contracts 缺省时等于 output', () => {
  const s = parseSkillText('demo', skillText({ contracts: '[script-v1]' }))
  assert.deepEqual(s.manifest.contracts, ['script-v1'])
})

check('缺 frontmatter 报错', () => {
  assert.throws(() => parseSkillText('demo', '## 角色与约束\nx\n## 任务\ny'), /frontmatter/)
})

check('缺 name 报错', () => {
  assert.throws(() => parseSkillText('demo', skillText({ name: '' })), /name/)
})

check('name 与目录不一致报错', () => {
  assert.throws(() => parseSkillText('other', skillText()), /必须与目录 id/)
})

check('未知 stage 报错', () => {
  assert.throws(() => parseSkillText('demo', skillText({ stage: 'nope' })), /未知环节/)
})

check('creative 环节可解析', () => {
  const s = parseSkillText(
    'demo',
    skillText({
      stage: 'creative',
      tools: '[read_video_shots]',
      output: 'reverse-v1',
      contracts: '[reverse-v1]',
    }),
  )
  assert.equal(s.manifest.stage, 'creative')
})

check('未知 runtime 报错', () => {
  assert.throws(() => parseSkillText('demo', skillText({ runtime: 'nope' })), /未知运行时/)
})

check('未知占位符报错', () => {
  assert.throws(
    () => parseSkillText('demo', skillText({}, '任务：{{input:b}}')),
    /未在 inputs 声明/,
  )
})

check('声明了但未使用的输入报错', () => {
  assert.throws(
    () => parseSkillText('demo', skillText({ inputs: '[a, b]' })),
    /没有在任务模板中使用/,
  )
})

check('重复契约报错', () => {
  assert.throws(
    () => parseSkillText('demo', skillText({ contracts: '[script-v1, script-v1]' })),
    /重复/,
  )
})

check('缺少任务段报错', () => {
  const text = skillText().replace('## 任务', '## 别的东西')
  assert.throws(() => parseSkillText('demo', text), /缺少「## 任务」段/)
})

check('composeSkillBody 可被重新解析', () => {
  const s = parseSkillText('demo', skillText())
  const body = composeSkillBody(s.role, s.task)
  const text = skillText().replace(/## 角色与约束[\s\S]*$/, body)
  const again = parseSkillText('demo', text)
  assert.equal(again.role, s.role)
  assert.equal(again.task, s.task)
})

const record = (id: string, text: string, source: 'builtin' | 'override' = 'builtin', builtinText?: string): SkillTextRecord => ({
  id,
  text,
  builtinText: builtinText ?? text,
  source,
})

check('重复 id 只保留第一个并报错', () => {
  const r = parseSkillRecords([record('demo', skillText()), record('demo', skillText())])
  assert.equal(r.skills.size, 1)
  assert.ok(r.issues.some((x) => x.message.includes('重复')))
})

check('未知契约被拒绝', () => {
  const r = parseSkillRecords([record('demo', skillText({ contracts: '[nope-v1]' }))])
  assert.equal(r.skills.size, 0)
  assert.ok(r.issues.some((x) => x.message.includes('未知契约')))
})

check('未知工具被拒绝', () => {
  const r = parseSkillRecords([record('demo', skillText({ tools: '[nope]' }))])
  assert.equal(r.skills.size, 0)
  assert.ok(r.issues.some((x) => x.message.includes('未知工具')))
})

check('坏的用户覆盖退回内置并报错', () => {
  const builtin = skillText()
  const broken = builtin.replace('## 任务', '## 错的任务')
  const r = parseSkillRecords([record('demo', broken, 'override', builtin)])
  assert.equal(r.skills.size, 1)
  assert.equal(r.skills.get('demo')?.source, 'builtin')
  assert.ok(r.issues.some((x) => x.message.includes('已退回内置')))
})

check('只读写技能不需要注册写工具', () => {
  const text = skillText({ tools: '[read_source]' })
  const r = parseSkillRecords([record('demo', text)])
  const skill = r.skills.get('demo')
  assert.ok(skill)
  assert.deepEqual(skill?.manifest.tools, ['read_source'])
  assert.ok(!skill?.manifest.tools.some((t) => t.startsWith('submit_')))
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
