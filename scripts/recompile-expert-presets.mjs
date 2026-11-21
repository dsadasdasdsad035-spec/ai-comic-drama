/**
 * 本地重编译创意专家 preset（等同设置页保存后的 writeExpertsPatch 路径）。
 *
 * 跑法：`node scripts/recompile-expert-presets.mjs`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { ensureStateDir } from '../server/paths.mjs'
import { StudioToolBridge } from '../server/studio-tool-bridge.mjs'
import {
  compileExpertPreset,
  expertsPatchPath,
  presetIdForExpert,
  readCompiledExperts,
  syncExpertSkillRoot,
  writeExpertsPatch,
} from '../server/dsh-experts.mjs'
import { listAllExperts } from '../server/experts.mjs'
import { listSkillFiles } from '../server/skills.mjs'
import { dbPath } from '../server/db.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = ensureStateDir(ROOT, 'dsh')
dbPath(ROOT)

const bridge = new StudioToolBridge({
  root: ROOT,
  baseUrl: 'http://127.0.0.1:0',
  internalToken: 'local-recompile',
  log: () => {},
})

const catalog = await bridge.catalog('', 1)
const registeredNames = catalog.map((t) => String(t.name))
console.log(`[recompile] 工具桥登记 ${registeredNames.length} 个工具（含别名）`)
console.log(`[recompile] 含 submit_prompts: ${registeredNames.includes('submit_prompts')}`)
console.log(`[recompile] 含 submit_shot_prompts 别名: ${registeredNames.includes('submit_shot_prompts')}`)

const result = writeExpertsPatch({
  dshHome,
  root: ROOT,
  registeredNames,
  log: (line) => console.log(line),
})

console.log(`[recompile] patch: ${result.file}`)
console.log(`[recompile] written: ${result.written}`)
console.log(`[recompile] signature: ${result.signature.slice(0, 80)}…`)
for (const row of result.compiled) {
  console.log(`  - ${row.id}: tools=${row.tools} skills=${row.skills} fp=${row.fingerprint.slice(0, 12)}…`)
}

const GHOST = [
  'read_transition_video_inputs',
  'read_transition_recipes',
  'attach_transition_refs',
  'set_transition_audio',
]
const MUST = ['submit_prompts', 'publish_shot_clip_frame', 'link_prev_shot_tail_frame']

const omni = listAllExperts().find((e) => e.id === 'expert-omni')
if (!omni) throw new Error('找不到 expert-omni')

const available = listSkillFiles(ROOT).skills.map((s) => s.id)
const rootInfo = syncExpertSkillRoot({ dshHome, expert: omni, root: ROOT, available })
const preset = compileExpertPreset({
  expert: omni,
  registeredNames,
  skillRoot: rootInfo.dir,
  skillIds: rootInfo.ids,
})
const gate = preset.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
const toolIds = gate?.config?.toolIds ?? []
const ghosts = GHOST.filter((n) => toolIds.includes(n))
const missing = MUST.filter((n) => !toolIds.includes(n))
if (ghosts.length) {
  console.error(`❌ 全能专家 preset 仍含幽灵工具：${ghosts.join('、')}`)
  process.exitCode = 1
}
if (missing.length) {
  console.error(`❌ 全能专家 preset 缺工具：${missing.join('、')}`)
  process.exitCode = 1
}
if (!process.exitCode) {
  console.log(`✅ expert-omni preset 工具闸门：${toolIds.length} 项，无转场幽灵，含 submit_prompts / 成片工具`)
}

const doc = parseYaml(fs.readFileSync(expertsPatchPath(dshHome), 'utf8'))
const omniPresetId = presetIdForExpert('expert-omni')
const row = doc[0]?.insert?.find((r) => r.config?.id === omniPresetId)
if (!row) throw new Error('patch 里找不到 omni preset')
const patchGate = row.config.plugins.find((p) => p.name === 'dsh-plugin-creative-expert')
console.log(`✅ patch 已写入 ${path.relative(ROOT, expertsPatchPath(dshHome))}`)

const jsonRows = readCompiledExperts(dshHome)
console.log(`✅ creative-experts.json 共 ${jsonRows.length} 条`)