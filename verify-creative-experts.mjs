/**
 * 创意专家：API、专家载荷、工具白名单与 read_skill 限制。
 * 跑法：node verify-creative-experts.mjs
 */
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5358
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-experts-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  console.error('dev server 启动失败')
  process.exit(1)
}

const expertsRes = await (await fetch(`${APP}/api/experts`)).json()
check('GET /api/experts', expertsRes.ok === true, String(expertsRes.experts?.length ?? 0))
const builtins = (expertsRes.experts || []).filter((e) => e.source === 'builtin')
check('内置仅 1 个专家', builtins.length === 1, builtins.map((e) => e.id).join(','))

const omni = expertsRes.experts?.find((e) => e.id === 'expert-omni')
check('全能专家 manifest', Boolean(omni), omni?.name || '')
check('全能专家名称', omni?.name === '全能专家', omni?.name || '')
check(
  '内置专家含图标地址',
  expertsRes.experts?.every((e) => e.source !== 'builtin' || String(e.iconUrl || '').includes('/icon')),
)
check(
  '全能专家图像描述',
  Boolean(String(omni?.imageDescription || '').trim()),
  omni?.imageDescription || '',
)
const iconRes = await fetch(`${APP}/api/experts/expert-omni/icon`)
check('GET 专家图标', iconRes.ok && (iconRes.headers.get('content-type') || '').includes('svg'))

const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export { createBuiltinPlatformTools } from ${JSON.stringify(path.join(ROOT, 'src/agent/builtinPlatformTools.ts'))}`,
    `export { createPiNativeToolSet } from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
    `export { buildCreativeTurnPayload, buildExpertSystem, interpolateExpertSoul } from ${JSON.stringify(path.join(ROOT, 'src/creative/creativeTurnPayload.ts'))}`,
    `export { buildCreativeExpertTools, expertToolNames } from ${JSON.stringify(path.join(ROOT, 'src/creative/expertTools.ts'))}`,
  ].join('\n'),
)

const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'error',
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
})

globalThis.location = { href: `${APP}/`, origin: APP, protocol: 'http:' }
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, init) => {
  const u = String(url)
  if (u.startsWith('/')) return nativeFetch(`${APP}${u}`, init)
  return nativeFetch(url, init)
}

const lib = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const expert = omni
const proj = '专家验收项目'
const ep = 3

const system = lib.buildExpertSystem(expert, { projectName: proj, epNo: ep })
check('system 不含通用创意壳', !system.includes('list_installed_skills 发现'))
check('system 含 soul 正文', system.includes('全流程'))
check('占位符全能专家模板', lib.interpolateExpertSoul(expert.soul, { projectName: proj, epNo: ep, expert }).length > 0)

const payload = lib.buildCreativeTurnPayload({
  host: null,
  expert,
  projectName: proj,
  epNo: ep,
  messages: [],
  draftText: 'hi',
})
check('载荷含 list_experts', payload.toolNames.includes('list_experts'))
check('全能专家含 list_installed_skills', payload.toolNames.includes('list_installed_skills'))
check('载荷含 read_shots', payload.toolNames.includes('read_shots'))
check('载荷含 submit_characters', payload.toolNames.includes('submit_characters'))

const PI = lib.createPiNativeToolSet()
const listExperts = PI.byName.get('list_experts')
const platform = lib.createBuiltinPlatformTools({ projectName: proj, epNo: ep })
const tools = lib.buildCreativeExpertTools(expert, platform, [], listExperts)
const byName = new Map(tools.map((t) => [t.name, t]))
check('运行时工具数', tools.length === payload.toolNames.length, String(tools.length))

check('内置全能专家挂全部技能（*）', Array.isArray(omni?.skillIds) && omni.skillIds.includes('*'))
check('system 占位符展示全部技能', system.includes('全部已安装技能'))

const readText = byName.get('read_skill_text')
if (readText) {
  const denied = await readText.run({ id: 'not-installed-skill-id' })
  check('read_skill_text 通配下不再报白名单拒绝', !String(denied?.error || '').includes('专家不允许读取技能'))
} else {
  check('read_skill_text 存在于专家工具集', false)
}

const importBody = {
  version: 1,
  experts: [
    {
      id: 'expert-verify-import',
      name: '导入验收',
      description: 'verify script',
      soul: '导入专家 soul',
      skillIds: [],
      toolIds: ['read_source', 'list_installed_skills'],
    },
  ],
}
const importPut = await fetch(`${APP}/api/experts`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    experts: [
      ...(expertsRes.experts || [])
        .filter((e) => e.source === 'custom')
        .map(({ id, name, description, soul, skillIds, toolIds }) => ({
          id,
          name,
          description,
          soul,
          skillIds,
          toolIds,
        })),
      ...importBody.experts,
    ],
  }),
})
const importJson = await importPut.json()
check('导入自定义专家', importJson.ok === true)
check(
  '导入后可读到',
  importJson.experts?.some((e) => e.id === 'expert-verify-import'),
  String(importJson.experts?.length),
)

const { expertToZipBuffer, expertsBundleToZipBuffer } = await import(path.join(ROOT, 'server', 'expertZip.mjs'))
const zipBuf = expertToZipBuffer({
  id: 'expert-zip-verify',
  name: 'Zip验收',
  description: 'roundtrip',
  soul: 'zip soul {{projectName}}',
  skillIds: [],
  toolIds: ['read_source'],
})
const zipImp = await fetch(`${APP}/api/experts/import-zip`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/zip' },
  body: zipBuf,
})
const zipImpJson = await zipImp.json()
check('zip 导入', zipImpJson.ok === true)
check('zip 导入 id', zipImpJson.experts?.some((e) => e.id === 'expert-zip-verify'))
const zipExport = await fetch(`${APP}/api/experts/expert-omni/export-zip`)
check('zip 导出内置', zipExport.ok && zipExport.headers.get('content-type')?.includes('zip'))
check('zip 导出字节', (await zipExport.arrayBuffer()).byteLength > 50)

const multiZip = expertsBundleToZipBuffer([
  {
    id: 'expert-zip-a',
    name: 'A',
    description: '',
    soul: 'soul a',
    skillIds: [],
    toolIds: ['read_source'],
  },
  {
    id: 'expert-zip-b',
    name: 'B',
    description: '',
    soul: 'soul b read_shots',
    skillIds: [],
    toolIds: ['read_shots'],
  },
])
const multiImp = await fetch(`${APP}/api/experts/import-zip`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/zip' },
  body: multiZip,
})
const multiJson = await multiImp.json()
check('多专家 zip 导入', multiJson.ok === true && multiJson.imported === 2)

const hintEntry = path.join(TMP, 'hints.ts')
fs.writeFileSync(
  hintEntry,
  `export { soulToolsMissingFromWhitelist } from ${JSON.stringify(path.join(ROOT, 'src/creative/expertSoulHints.ts'))}`,
)
const hintOut = await build({
  entryPoints: [hintEntry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'error',
})
const hintLib = await import(
  'data:text/javascript;base64,' + Buffer.from(hintOut.outputFiles[0].text).toString('base64')
)
const missing = hintLib.soulToolsMissingFromWhitelist('先 read_shots 再 submit_shots', ['read_source'], [
  'read_source',
  'read_shots',
  'submit_shots',
])
check('soul 工具弱提示含 read_shots', missing.includes('read_shots'), missing.join(','))
check('soul 工具弱提示含 submit_shots', missing.includes('submit_shots'), missing.join(','))

child.kill()
console.log('\n--- 汇总 ---')
if (bad) process.exit(1)
console.log('创意专家验收通过')