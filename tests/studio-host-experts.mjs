/**
 * 真实宿主加载专家 preset 的集成测试。
 *
 * 只证明两件靠桩证明不了的事：
 * 1. 我们生成的 insert patch 能被宿主接受（preset 真出现在合成配置里）；
 * 2. 闸门插件与技能根在宿主里真的被解析到（缺包会挂在 pending，而不是静默可用）。
 *
 * 依赖本机已安装 `@deepseek-ai/dsh`；未安装时跳过。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeExpertsPatch, expertsPatchPath } from '../server/dsh-experts.mjs'
import { installCreativeToolsBundle, profileDir } from '../server/dsh-bundle.mjs'
import { writeStudioProfile } from '../server/studio-profile.mjs'
import { isDshInstalled } from '../server/creative-host.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

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

if (!isDshInstalled(ROOT)) {
  console.log('⚠️  跳过真实宿主专家 preset 测试：未安装 @deepseek-ai/dsh')
  process.exit(0)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-host-experts-'))
const dshHome = path.join(TMP, 'dsh')
const registeredNames = ['read_source', 'read_shots', 'submit_shots', 'read_skill', 'list_experts', 'list_installed_skills']

writeStudioProfile({
  dshHome,
  gatewayBaseUrl: 'http://127.0.0.1:5999/v1',
  models: [{ id: 'sb/default', key: 'default' }],
  defaultModelId: 'sb/default',
})
installCreativeToolsBundle({ dshHome, root: ROOT })
const { compiled } = writeExpertsPatch({ dshHome, root: ROOT, registeredNames })

await check('编译出了至少一个专家 preset', async () => {
  assert.ok(compiled.length >= 1, '没有编译结果')
})

let dump = ''
try {
  dump = execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '--profile', 'web', '--patch', expertsPatchPath(dshHome), '--dump-config'],
    { cwd: ROOT, env: { ...process.env, DSH_HOME: dshHome }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (e) {
  dump = `${e?.stdout || ''}${e?.stderr || ''}`
}

await check('宿主接受专家 patch（无 patch 报错）', async () => {
  assert.ok(!/patch: entry .* not found/.test(dump), `patch 被拒绝：\n${dump.slice(0, 800)}`)
})

await check('每个专家都出现在合成配置里', async () => {
  for (const row of compiled) {
    assert.ok(dump.includes(`id: ${row.presetId}`), `缺少 preset ${row.presetId}`)
    assert.ok(dump.includes(`name: ${row.name}`), `缺少 preset 名称 ${row.name}`)
  }
})

await check('preset 内含 persona、时间、压缩与专家闸门', async () => {
  assert.ok(dump.includes('@deepseek-ai/dsh-persona'), '没有 persona 行')
  assert.ok(dump.includes('dsh-plugin-creative-expert'), '没有专家闸门行')
  assert.ok(dump.includes("complete: true"), 'persona 不是完整系统提示词')
  assert.ok(dump.includes('@deepseek-ai/dsh-time-context'), '没有时间上下文')
  assert.ok(dump.includes('@deepseek-ai/dsh-compaction-basic'), '没有自动压缩')
})

await check('per-expert 技能根已生成并被挂载', async () => {
  const first = compiled[0]
  const root = path.join(dshHome, 'experts', first.id, 'skills')
  assert.ok(fs.existsSync(root), `技能根不存在：${root}`)
  assert.ok(dump.includes(root), 'patch 里没有技能根路径')
})

await check('闸门插件文件已装进 profile', async () => {
  const p = path.join(profileDir(dshHome), 'node_modules', 'dsh-plugin-creative-expert', 'index.js')
  assert.ok(fs.existsSync(p), `闸门插件没装：${p}`)
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n真实宿主专家 preset 测试全部通过')
process.exit(0)
