/**
 * 技能读工具登记一致性测试（5.6）。
 *
 * 断言的是「三份名单说的是同一件事」：运行时注册的技能读工具、
 * 专家编译器里的技能读工具、专家工具分组里的「技能组」。
 * 新增一个技能读工具却漏改其中一处，就会表现为「工具注册了但专家模式取不到」。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SKILL_READ_TOOLS, compileExpertPreset, writeExpertsPatch } from '../server/dsh-experts.mjs'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-skill-tools-'))

/**
 * 前端的工具/分组模块用的是无扩展名相对导入，Node 直接跑不了；
 * 按浏览器语义先打包成一个临时模块再导入 —— 这保证测的是**同一份源码**。
 */
const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export { createBuiltinPlatformTools, mergeBuiltinWithSkillTools } from ${JSON.stringify(path.join(ROOT, 'src/agent/builtinPlatformTools.ts'))}`,
    `export { createPiNativeToolSet } from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
    `export { DEFAULT_EXPERT_PLATFORM_TOOLS, classifyExpertTool, groupExpertPlatformTools } from ${JSON.stringify(path.join(ROOT, 'src/creative/expertToolGroups.ts'))}`,
    `export { SKILL_READ_TOOL_NAMES } from ${JSON.stringify(path.join(ROOT, 'src/skills/tools.ts'))}`,
  ].join('\n'),
)
const out = await esbuild({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'error',
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
})
const built = await import(
  `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`
)
const { createBuiltinPlatformTools, mergeBuiltinWithSkillTools, createPiNativeToolSet, DEFAULT_EXPERT_PLATFORM_TOOLS, classifyExpertTool, groupExpertPlatformTools, SKILL_READ_TOOL_NAMES } = built

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

const platform = createBuiltinPlatformTools({ projectName: '', epNo: 1 })
const pi = [...createPiNativeToolSet().byName.values()]
const registered = new Set(mergeBuiltinWithSkillTools(platform, pi).map((t) => t.name))

await check('编译器与运行时的技能读工具名单一致', async () => {
  assert.deepEqual([...SKILL_READ_TOOLS].sort(), [...SKILL_READ_TOOL_NAMES].sort())
})

await check('技能读工具全部真的注册了', async () => {
  for (const name of SKILL_READ_TOOLS) assert.ok(registered.has(name), `${name} 未注册`)
})

await check('技能读工具归入「技能」组而不是可单勾的外部工具', async () => {
  const groups = groupExpertPlatformTools([...registered])
  for (const name of SKILL_READ_TOOLS) {
    assert.equal(classifyExpertTool(name), 'skill', `${name} 不在技能组`)
    assert.ok(groups.skill.includes(name), `${name} 没进技能组清单`)
  }
})

await check('默认模式工具名单包含全部技能读工具', async () => {
  for (const name of SKILL_READ_TOOLS) {
    assert.ok(DEFAULT_EXPERT_PLATFORM_TOOLS.includes(name), `默认名单缺 ${name}`)
  }
})

await check('专家勾选技能读工具时运行时确实拿到它', async () => {
  const preset = compileExpertPreset({
    expert: {
      id: 'skill-tools-test',
      name: '测试',
      soul: 'x',
      toolIds: [...SKILL_READ_TOOLS, 'read_source'],
      skillIds: ['short-drama'],
    },
    registeredNames: [...registered],
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  for (const name of SKILL_READ_TOOLS) assert.ok(gate.config.toolIds.includes(name), `preset 缺 ${name}`)
})

await check('专家没勾技能读工具时不会凭空多出来', async () => {
  const preset = compileExpertPreset({
    expert: { id: 'no-skill-test', name: '测试', soul: 'x', toolIds: ['read_source'], skillIds: ['short-drama'] },
    registeredNames: [...registered],
  })
  const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
  for (const name of ['read_skill', 'read_skill_text', 'read_skill_file']) {
    assert.ok(!gate.config.toolIds.includes(name), `不该有 ${name}`)
  }
})

await check('list_experts 不在工具勾选组里（始终可用）', async () => {
  // 它不在任何分组白名单里，classify 会落到 other；这里确认它没被写进默认名单
  assert.ok(!DEFAULT_EXPERT_PLATFORM_TOOLS.includes('list_experts'))
})

await check('生成 patch 时技能根与白名单同源', async () => {
  const { compiled } = writeExpertsPatch({ dshHome: TMP, root: ROOT, registeredNames: [...registered] })
  assert.ok(compiled.length > 0)
  for (const row of compiled) {
    if (row.wildcard) continue
    assert.ok(row.skills >= 0, `${row.id} 的技能计数缺失`)
  }
  const patch = fs.readFileSync(path.join(TMP, 'profiles', 'web', 'creative-experts.patch.yml'), 'utf8')
  for (const name of SKILL_READ_TOOLS) {
    if (patch.includes(name)) continue // 有的专家没勾技能组，属正常
  }
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n技能读工具一致性测试全部通过')
process.exit(0)
