/**
 * 专家编译器测试（第 5 组）。
 *
 * 覆盖：soul → persona、toolIds → preset 工具子集、技能白名单根、
 * 内置 id 保护、镜像到宿主配置目录、preset id ↔ 专家名映射。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  ALWAYS_ON_TOOLS,
  SKILL_READ_TOOLS,
  compileExpertPreset,
  expertIdFromPreset,
  expertNameForPreset,
  expertsPatchPath,
  mirrorExpertSources,
  presetIdForExpert,
  readCompiledExperts,
  resolveSkillWhitelist,
  resolveToolSubset,
  syncExpertSkillRoot,
  writeExpertsPatch,
} from '../server/dsh-experts.mjs'
import { listAllExperts, mergeCustomExperts, saveCustomExperts } from '../server/experts.mjs'
import { dbPath } from '../server/db.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-experts-'))
// 专家的自定义项存在设置库：测试要开真库，而不是绕开持久化去验内存结构。
// dbPath 会打开模块级单例连接，后续 getSetting/setSetting 才有库可用。
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

const registeredNames = [
  'read_source',
  'read_shots',
  'submit_shots',
  'generate_keyframe',
  'read_skill',
  'read_skill_text',
  'read_skill_file',
  'list_installed_skills',
  'list_experts',
]

await check('soul 编译成 complete persona（不叠加默认说明）', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'demo', name: '演示', soul: '你是演示专家。', toolIds: ['read_source'], skillIds: [] },
    registeredNames,
  })
  const persona = preset.plugins.find((p) => p.name === '@deepseek-ai/dsh-persona')
  assert.ok(persona, '没有 persona 行')
  assert.equal(persona.config.prefix, '你是演示专家。')
  assert.equal(persona.config.complete, true, 'persona 必须是完整系统提示词')
})

await check('toolIds 收窄成真实工具，并只补上 list_experts', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'demo', name: '演示', soul: 'x', toolIds: ['read_source', 'no_such_tool'], skillIds: [] },
    registeredNames,
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  assert.ok(gate, '没有专家闸门插件')
  // list_installed_skills 不再被强制注入：未勾选就不在可见集里
  assert.deepEqual(gate.config.toolIds.sort(), ['list_experts', 'read_source'].sort())
  assert.ok(!gate.config.toolIds.includes('list_installed_skills'), 'list_installed_skills 不该被强制注入')
  for (const name of ALWAYS_ON_TOOLS) assert.ok(gate.config.toolIds.includes(name))
})

await check('专家勾选 list_installed_skills 时才进可见集', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'demo', name: '演示', soul: 'x', toolIds: ['read_source', 'list_installed_skills'], skillIds: [] },
    registeredNames,
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  assert.ok(gate.config.toolIds.includes('list_installed_skills'), '勾选了却不生效')
})

await check('不在 toolIds 的工具不会进白名单', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'demo', name: '演示', soul: 'x', toolIds: ['read_source'], skillIds: [] },
    registeredNames,
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  assert.ok(!gate.config.toolIds.includes('submit_shots'))
  assert.ok(!gate.config.toolIds.includes('generate_keyframe'))
})

await check('技能白名单：普通列表只留真实存在的 id', async () => {
  const r = resolveSkillWhitelist(['short-drama', 'ghost-skill'], ['short-drama', 'other'])
  assert.equal(r.wildcard, false)
  assert.deepEqual(r.ids, ['short-drama'])
})

await check('技能白名单：* 视为全部', async () => {
  const r = resolveSkillWhitelist(['*'], ['b', 'a'])
  assert.equal(r.wildcard, true)
  assert.deepEqual(r.ids, ['a', 'b'])
})

await check('野生 * 时 preset 不写 skillIds（等于不额外限制）', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'demo', name: '演示', soul: 'x', toolIds: [], skillIds: ['*'] },
    registeredNames,
    skillIds: ['*'],
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  assert.equal(gate.config.skillIds, undefined, '通配时不该写死白名单')
})

await check('per-expert 技能根只挂白名单内的技能', async () => {
  const expert = listAllExperts().find((e) => e.id === 'expert-omni-custom') || { id: 'root-test', skillIds: ['short-drama'] }
  const info = syncExpertSkillRoot({ dshHome: TMP, expert: { ...expert, id: 'root-test' }, root: ROOT })
  const entries = fs.readdirSync(info.dir)
  assert.ok(entries.length > 0, '技能根是空的')
  if (!info.wildcard) {
    for (const id of entries) assert.ok(info.ids.includes(id), `根里出现了白名单外的技能：${id}`)
  }
  // 软链指向真实技能目录，改 SKILL.md 后能立刻读到
  const first = entries[0]
  const p = path.join(info.dir, first)
  assert.ok(fs.existsSync(path.join(p, 'SKILL.md')), `${first} 下没有 SKILL.md`)
})

await check('patch 文件是 insert 层且含全部专家 preset', async () => {
  const result = writeExpertsPatch({ dshHome: TMP, root: ROOT, registeredNames })
  const file = expertsPatchPath(TMP)
  assert.ok(fs.existsSync(file))
  const doc = parseYaml(fs.readFileSync(file, 'utf8'))
  assert.ok(Array.isArray(doc) && Array.isArray(doc[0].insert), '必须是 insert 层')
  const ids = doc[0].insert.map((row) => row.config.id)
  const expected = listAllExperts().map((e) => presetIdForExpert(e.id))
  assert.deepEqual(ids.sort(), expected.sort())
  assert.equal(result.compiled.length, expected.length)
})

await check('镜像目录含 manifest 与 soul', async () => {
  writeExpertsPatch({ dshHome: TMP, root: ROOT, registeredNames })
  const dir = path.join(TMP, 'experts', 'compiled', 'expert-omni')
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')))
  const soul = fs.readFileSync(path.join(dir, 'soul.md'), 'utf8')
  const builtinSoul = fs.readFileSync(path.join(ROOT, 'experts', 'expert-omni', 'soul.md'), 'utf8')
  assert.equal(soul, builtinSoul, 'soul 内容与源文件不一致')
})

await check('过期专家目录被清理', async () => {
  const stale = path.join(TMP, 'experts', 'compiled', 'stale-expert')
  fs.mkdirSync(stale, { recursive: true })
  fs.writeFileSync(path.join(stale, 'manifest.json'), '{}')
  mirrorExpertSources({ dshHome: TMP, experts: listAllExperts() })
  assert.ok(!fs.existsSync(stale), '过期目录没清理')
})

await check('preset id 与专家 id 双向映射稳定', async () => {
  assert.equal(presetIdForExpert('expert-omni'), 'expert-expert-omni')
  assert.equal(expertIdFromPreset('expert-expert-omni'), 'expert-omni')
  assert.equal(expertIdFromPreset('standard'), '')
})

await check('会话按 preset id 查到专家显示名', async () => {
  writeExpertsPatch({ dshHome: TMP, root: ROOT, registeredNames })
  const rows = readCompiledExperts(TMP)
  const first = rows[0]
  assert.equal(expertNameForPreset(TMP, first.presetId), first.name)
  assert.equal(expertNameForPreset(TMP, 'standard'), '')
})

await check('内置 id 写入被拒绝', async () => {
  const builtinId = listAllExperts().find((e) => e.source === 'builtin').id
  assert.throws(() => saveCustomExperts([{ id: builtinId, name: 'x', soul: 'y' }]), /不能覆盖内置专家/)
  assert.throws(() => mergeCustomExperts([{ id: builtinId, name: 'x', soul: 'y' }]), /不能覆盖内置专家/)
})

await check('自定义专家保存后再次读取仍在', async () => {
  const id = 'custom-persist-test'
  saveCustomExperts([{ id, name: '持久化测试', soul: '你是测试专家。', skillIds: ['short-drama'], toolIds: ['read_source'] }])
  const again = listAllExperts().find((e) => e.id === id)
  assert.ok(again, '自定义专家读不回来')
  assert.equal(again.soul, '你是测试专家。')
  // 写进宿主配置目录后，preset 里能看到它
  writeExpertsPatch({ dshHome: TMP, root: ROOT, registeredNames })
  const doc = parseYaml(fs.readFileSync(expertsPatchPath(TMP), 'utf8'))
  assert.ok(doc[0].insert.some((row) => row.config.id === presetIdForExpert(id)))
  saveCustomExperts([])
})

await check('技能根是链接而不是快照：改 SKILL.md 立刻可见', async () => {
  // 造一个临时技能包，挂进专家根，再改文件 —— 通过链接读到的必须是新内容
  const skillsRoot = path.join(TMP, 'hot-root')
  const pkg = path.join(skillsRoot, 'skills', 'hot-skill')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'SKILL.md'), '---\nname: hot-skill\ndescription: 热更测试\n---\n\n旧正文\n')
  const info = syncExpertSkillRoot({
    dshHome: path.join(TMP, 'hot-dsh'),
    expert: { id: 'hot-expert', skillIds: ['hot-skill'] },
    root: skillsRoot,
  })
  const linked = path.join(info.dir, 'hot-skill', 'SKILL.md')
  assert.match(fs.readFileSync(linked, 'utf8'), /旧正文/)
  fs.writeFileSync(path.join(pkg, 'SKILL.md'), '---\nname: hot-skill\ndescription: 热更测试\n---\n\n新正文\n')
  assert.match(fs.readFileSync(linked, 'utf8'), /新正文/, '读到的是旧快照，说明挂载用了复制')
})

await check('专家包往返：新结构导入后 persona 与技能都在', async () => {
  const { expertToZipBuffer, expertsFromZipBuffer } = await import('../server/expertZip.mjs')
  const source = {
    id: 'roundtrip-expert',
    name: '往返测试',
    description: '往返',
    soul: '你是往返测试专家。',
    skillIds: ['short-drama'],
    toolIds: ['read_source', 'submit_shots'],
  }
  const [back] = expertsFromZipBuffer(expertToZipBuffer(source))
  assert.equal(back.id, source.id)
  assert.equal(back.soul, source.soul)
  assert.deepEqual(back.skillIds, source.skillIds)
  assert.deepEqual(back.toolIds, source.toolIds)
})

await check('旧格式包（persona 字段 + skills/tools 键）可导入', async () => {
  const { expertsFromZipBuffer } = await import('../server/expertZip.mjs')
  const { strToU8, zipSync } = await import('fflate')
  const legacy = zipSync({
    'legacy-expert/manifest.json': strToU8(
      JSON.stringify({
        id: 'legacy-expert',
        name: '旧包专家',
        persona: '你是从旧包导入的专家。',
        skills: ['short-drama'],
        tools: ['read_source'],
      }),
    ),
  })
  const [row] = expertsFromZipBuffer(Buffer.from(legacy))
  assert.equal(row.soul, '你是从旧包导入的专家。')
  assert.deepEqual(row.skillIds, ['short-drama'])
  assert.deepEqual(row.toolIds, ['read_source'])
})

await check('旧格式包（persona.md 文件）可导入', async () => {
  const { expertsFromZipBuffer } = await import('../server/expertZip.mjs')
  const { strToU8, zipSync } = await import('fflate')
  const legacy = zipSync({
    'legacy2/manifest.json': strToU8(JSON.stringify({ id: 'legacy2', name: '旧包二' })),
    'legacy2/persona.md': strToU8('你是第二份旧包的专家。'),
  })
  const [row] = expertsFromZipBuffer(Buffer.from(legacy))
  assert.equal(row.soul, '你是第二份旧包的专家。')
})

await check('自定义专家保存在宿主配置目录（文件形式）', async () => {
  const { statePath } = await import('../server/paths.mjs')
  const { setSetting } = await import('../server/db.mjs')
  const id = 'file-store-test'
  saveCustomExperts([{ id, name: '文件存储', soul: '你是文件存储专家。', skillIds: [], toolIds: [] }])
  const dir = statePath(process.cwd(), 'dsh', 'experts', id)
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), '没有 manifest.json')
  assert.equal(fs.readFileSync(path.join(dir, 'soul.md'), 'utf8'), '你是文件存储专家。')
  // 重开设置 = 重新读盘：不依赖任何内存状态
  assert.ok(listAllExperts().some((e) => e.id === id))
  // 删掉后列表里也不该再有
  saveCustomExperts([])
  assert.ok(!listAllExperts().some((e) => e.id === id))
  assert.ok(!fs.existsSync(dir), '删除后目录还在')
})

await check('旧设置库里的自定义专家会搬迁到宿主配置目录', async () => {
  const { statePath } = await import('../server/paths.mjs')
  const { setSetting } = await import('../server/db.mjs')
  const id = 'legacy-migrate-test'
  const dir = statePath(process.cwd(), 'dsh', 'experts', id)
  fs.rmSync(dir, { recursive: true, force: true })
  setSetting('creativeExperts', [{ id, name: '旧专家', soul: '你是旧专家。', skillIds: [], toolIds: [] }])
  setSetting('creativeExpertsMigrated', false)
  const found = listAllExperts().find((e) => e.id === id)
  assert.ok(found, '搬迁后列表里没有旧专家')
  assert.equal(found.soul, '你是旧专家。')
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), '没有落成文件')
  saveCustomExperts([])
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n专家编译器测试全部通过')
process.exit(0)
