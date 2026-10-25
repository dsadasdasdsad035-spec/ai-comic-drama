import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_RULES, SCRIPT_BASE, scriptSys, storyboardSys } from '../src/skills/legacyPrompts'
import { planLegacySkillOverrides } from '../src/skills/migrationPlan'
import { parseSkillText } from '../src/skills/parse'
import type { RulePack } from '../src/api'
import type { Skill } from '../src/skills/types'

const root = process.cwd()
const skillIds = ['script', 'character', 'asset', 'shotlist', 'prompt', 'scene3d']
const skills = new Map<string, Skill>(
  skillIds.map((id) => {
    const text = fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8')
    return [id, parseSkillText(id, text, 'builtin')]
  }),
)

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

const customRules = (key: keyof typeof DEFAULT_RULES, patch: Partial<RulePack>): Record<string, RulePack> => ({
  ...DEFAULT_RULES,
  [key]: { ...DEFAULT_RULES[key], ...patch },
})

check('默认规则包不生成覆盖', () => {
  assert.deepEqual(planLegacySkillOverrides(DEFAULT_RULES, skills), [])
})

check('自定义剧本规则生成 script 覆盖', () => {
  const rules = customRules('script', { text: DEFAULT_RULES.script.text + '\n自定义剧本规则' })
  const list = planLegacySkillOverrides(rules, skills)
  assert.equal(list.length, 1)
  assert.equal(list[0].skillId, 'script')
  assert.ok(list[0].body.includes('自定义剧本规则'))
})

check('迁移覆盖的角色层逐字等于旧 SYS', () => {
  const rules = customRules('script', { text: DEFAULT_RULES.script.text + '\n自定义剧本规则' })
  const body = planLegacySkillOverrides(rules, skills)[0].body
  const text = fs.readFileSync(path.join(root, 'skills', 'script', 'SKILL.md'), 'utf8')
  const full = text.replace(/## 角色与约束[\s\S]*$/, body)
  const again = parseSkillText('script', full, 'override')
  assert.equal(again.role, scriptSys(rules))
  assert.equal(again.task, skills.get('script')!.task)
})

check('停用规则包只保留 BASE', () => {
  const rules = customRules('script', { enabled: false })
  const body = planLegacySkillOverrides(rules, skills)[0].body
  assert.ok(body.includes(SCRIPT_BASE))
  assert.ok(!body.includes('【场景要素提取'))
  assert.equal(scriptSys(rules), SCRIPT_BASE)
})

check('自定义拆镜规则生成 shotlist 覆盖', () => {
  const rules = customRules('shot', { text: '自定义拆镜规则' })
  const list = planLegacySkillOverrides(rules, skills)
  assert.equal(list.length, 1)
  assert.equal(list[0].skillId, 'shotlist')
  assert.equal(scriptSys(rules), scriptSys(DEFAULT_RULES))
  const text = fs.readFileSync(path.join(root, 'skills', 'shotlist', 'SKILL.md'), 'utf8')
  const full = text.replace(/## 角色与约束[\s\S]*$/, list[0].body)
  const again = parseSkillText('shotlist', full, 'override')
  assert.equal(again.role, storyboardSys(rules))
})

check('自定义角色/素材/提示词规则分别映射', () => {
  const cases: [keyof typeof DEFAULT_RULES, string][] = [
    ['character', 'character'],
    ['asset', 'asset'],
    ['prompt', 'prompt'],
  ]
  for (const [key, skillId] of cases) {
    const rules = customRules(key, { text: `自定义-${key}` })
    const list = planLegacySkillOverrides(rules, skills)
    assert.equal(list.length, 1)
    assert.equal(list[0].skillId, skillId)
    assert.ok(list[0].body.includes(`自定义-${key}`))
  }
})

check('同一输入计划幂等', () => {
  const rules = customRules('script', { text: 'X' })
  assert.deepEqual(planLegacySkillOverrides(rules, skills), planLegacySkillOverrides(rules, skills))
})

check('缺少对应技能时跳过而不是写坏覆盖', () => {
  const onlyScript = new Map<string, Skill>([['script', skills.get('script')!]])
  const rules = customRules('asset', { text: 'X' })
  assert.deepEqual(planLegacySkillOverrides(rules, onlyScript), [])
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
