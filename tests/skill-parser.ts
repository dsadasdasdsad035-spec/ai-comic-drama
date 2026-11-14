import assert from 'node:assert/strict'
import { classifySkillProfile, tryAgentPackSkill } from '../src/skills/agentPack'
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
    stage: 'shot',
    runtime: 'tools',
    tools: '[read_source]',
    inputs: '[a]',
    output: 'shots-v1',
    contracts: '[shots-v1]',
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
  assert.deepEqual(s.manifest.contracts, ['shots-v1'])
})

check('contracts 缺省时等于 output', () => {
  const s = parseSkillText('demo', skillText({ contracts: '[shots-v1]' }))
  assert.deepEqual(s.manifest.contracts, ['shots-v1'])
})

check('缺 frontmatter 报错', () => {
  assert.throws(() => parseSkillText('demo', '## 角色与约束\nx\n## 任务\ny'), /frontmatter/)
})

check('SkillHub 风格：description 多行与 metadata 块不报 frontmatter 行错误', () => {
  const text = [
    '---',
    'name: demo',
    'description: |',
    '  第一行说明',
    '  第二行说明',
    'allowed-tools:',
    '  - Read',
    'metadata:',
    '  version: 9.9',
    'stage: shot',
    'runtime: tools',
    'tools: [read_source]',
    'inputs: [a]',
    'output: shots-v1',
    'version: 1',
    '---',
    '## 角色与约束',
    '你是测试角色。',
    '',
    '## 任务',
    '任务：{{input:a}}',
    '',
  ].join('\n')
  const s = parseSkillText('demo', text)
  assert.ok(s.manifest.description.includes('第一行说明'))
  assert.ok(s.manifest.description.includes('第二行说明'))
})

check('tools 多行列表写法', () => {
  const text = skillText().replace(
    'tools: [read_source]',
    'tools:\n  - read_source\n  - read_episode',
  )
  const s = parseSkillText('demo', text)
  assert.deepEqual(s.manifest.tools, ['read_source', 'read_episode'])
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

// 旧字面量仍要能加载：用户已保存的技能覆盖里写的是 json-tools。
check('旧 runtime(json-tools) 归一化为 tools', () => {
  const parsed = parseSkillText('demo', skillText({ runtime: 'json-tools' }))
  assert.equal(parsed.manifest.runtime, 'tools')
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
    () => parseSkillText('demo', skillText({ contracts: '[shots-v1, shots-v1]' })),
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

const AGENT_PACK_TEXT = [
  '---',
  'name: agent-demo',
  'description: |',
  '  SkillHub 风格说明',
  'allowed-tools:',
  '  - Read',
  '  - Bash',
  '---',
  '## agent-demo',
  '按文档操作。',
  '',
].join('\n')

check('Agent 包分类', () => {
  assert.equal(classifySkillProfile('agent-demo', AGENT_PACK_TEXT, 'upload'), 'agent-pack')
})

check('工作台 zip 安装被拒绝', () => {
  assert.throws(() => classifySkillProfile('demo', skillText(), 'upload'), /工作台形态/)
})

check('Agent 包装载进技能表', () => {
  const r = parseSkillRecords([record('agent-demo', AGENT_PACK_TEXT, 'upload', AGENT_PACK_TEXT)])
  assert.ok(r.skills.has('agent-demo'))
  assert.equal(r.skills.get('agent-demo')?.profile, 'agent-pack')
  assert.ok(tryAgentPackSkill(record('agent-demo', AGENT_PACK_TEXT, 'upload')))
})

check('重复 id 只保留第一个并报错', () => {
  const r = parseSkillRecords([
    record('agent-demo', AGENT_PACK_TEXT, 'upload'),
    record('agent-demo', AGENT_PACK_TEXT, 'upload'),
  ])
  assert.equal(r.skills.size, 1)
  assert.ok(r.issues.some((x) => x.message.includes('重复')))
})

check('工作台形态不进入技能表', () => {
  const r = parseSkillRecords([record('demo', skillText({ contracts: '[nope-v1]' }))])
  assert.equal(r.skills.size, 0)
  assert.ok(r.issues.some((x) => x.message.includes('工作台形态')))
})

check('legacy scene3d 内置可加载', () => {
  const text = [
    '---',
    'name: scene3d',
    'description: 预演导演（测试夹具）',
    'stage: sceneCode',
    'runtime: scene3d',
    'tools: [read_skill]',
    'inputs: []',
    'output: scene3d-code-v1',
    'contracts: [scene3d-code-v1]',
    'version: 1',
    '---',
    '## 角色与约束',
    '导演。',
    '',
    '## 任务',
    '按用户描述完成场景。',
    '',
  ].join('\n')
  const r = parseSkillRecords([record('scene3d', text, 'builtin', text)])
  assert.ok(r.skills.has('scene3d'), r.issues.map((x) => x.message).join('；'))
})

check('工作台 override 不装载', () => {
  const text = skillText()
  const r = parseSkillRecords([record('demo', text, 'override', text)])
  assert.equal(r.skills.size, 0)
  assert.ok(r.issues.some((x) => x.message.includes('工作台形态')))
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
