/**
 * 创意会话：平台内置 + Pi 原生工具逐项 invoke（与 CreativeStudio 无宿主绑定一致）。
 * 跑法：node verify-creative-builtin-tools.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { strToU8, zipSync } from 'fflate'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5357
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-builtin-tools-'))
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

const proj = `creative-tools-${Date.now()}`
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
const root = ${JSON.stringify(TMP)}
const shot = { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '街口', keyframe_prompt: 'rain', video_prompt: 'push' }
createProject(root, ${JSON.stringify(proj)}, { title: 'tool验收' })
writeProject(root, ${JSON.stringify(proj)}, {
  source: '验收原著',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
  shots: [shot],
  characters: [{ id: 'c1', name: '主角', lookEn: 'a person in coat' }],
  designs: [{ kind: 'scene', name: '街口', promptEn: 'street at night' }],
})
console.log('ok')
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP } })

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

const FIXTURE_SKILL = 'verify-creative-builtin-tools'
const agentMd = `---
name: ${FIXTURE_SKILL}
description: 创意内置工具验收 Agent 包
---
按 SKILL 操作。
`
const zipBody = Buffer.from(
  zipSync({ [`${FIXTURE_SKILL}/SKILL.md`]: strToU8(agentMd) }),
)
const upSkill = await fetch(`${APP}/api/skills/upload-zip`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/zip' },
  body: zipBody,
})
const upJson = await upSkill.json()
check('上传验收 Agent 包', upJson.ok === true, upJson.message || FIXTURE_SKILL)

const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export { createBuiltinPlatformTools, mergeBuiltinWithSkillTools } from ${JSON.stringify(path.join(ROOT, 'src/agent/builtinPlatformTools.ts'))}`,
    `export { bindSkillTools, createPiNativeToolSet } from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
    `export { buildCreativeTurnPayload } from ${JSON.stringify(path.join(ROOT, 'src/creative/creativeTurnPayload.ts'))}`,
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

// 浏览器 bundle 在 Node 里跑：把相对 /api 指到临时 dev server
const base = APP
globalThis.location = { href: `${base}/`, origin: base, protocol: 'http:' }
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, init) => {
  const u = String(url)
  if (u.startsWith('/')) return nativeFetch(`${base}${u}`, init)
  return nativeFetch(url, init)
}

const expertsRes = await (await fetch(`${APP}/api/experts`)).json()
check('/api/experts', expertsRes.ok === true && Array.isArray(expertsRes.experts), String(expertsRes.experts?.length ?? 0))
check('内置专家 ≥3', (expertsRes.experts?.length ?? 0) >= 3)

const lib = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const PI = lib.createPiNativeToolSet()
const platform = lib.createBuiltinPlatformTools({ projectName: proj, epNo: 1 })
const skillTools = lib.bindSkillTools(PI, [])
const tools = lib.mergeBuiltinWithSkillTools(platform, skillTools)
const byName = new Map(tools.map((t) => [t.name, t]))

const payload = lib.buildCreativeTurnPayload({ host: null, messages: [], draftText: 'tool smoke' })
check('载荷工具名数量', payload.toolNames.length >= 15, String(payload.toolNames.length))

for (const name of payload.toolNames) {
  check(`已注册 ${name}`, byName.has(name))
}

const skillsRes = await (await nativeFetch(`${APP}/api/skills`)).json()
const skillRows = skillsRes.skills || []
const sampleSkillId =
  skillRows.find((s) => s.id === FIXTURE_SKILL)?.id ||
  skillRows[0]?.id ||
  FIXTURE_SKILL
check('技能 id 用于 read_*', Boolean(sampleSkillId), sampleSkillId)

/** 各工具最小参数；执行失败但 invoke 不抛错即视为可调用 */
const staticArgs = {
  read_source: {},
  read_episodes: {},
  read_episode: { episode: 1 },
  read_characters: {},
  read_designs: {},
  read_shots: { episode: 1, limit: 5 },
  read_asset_inventory: {},
  read_transition_recipes: { limit: 3 },
  list_camera_lexicon: { limit: 2 },
  list_installed_skills: {},
  list_experts: {},
  ...(sampleSkillId
    ? {
        read_skill_text: { id: sampleSkillId },
        read_skill: { id: sampleSkillId },
      }
    : {}),
  validate_contract: {
    contract: 'characters-v1',
    payload: { version: 1, characters: [{ name: '验收', lookEn: 'test' }] },
  },
  submit_characters: {
    version: 1,
    characters: [{ name: '验收角色', lookEn: 'smoke test character' }],
  },
  submit_designs: { version: 1, scenes: [], props: [] },
  submit_shots: {
    shots: [
      {
        no: 'S99',
        scene_no: 1,
        scene_slug: '街口',
        seconds: 2,
        size: '中景',
        move: '固定',
        desc: '验收镜',
        keyframe_prompt: 'rain street',
      },
    ],
  },
  submit_prompts: {
    shots: [{ no: 'S01', keyframe_prompt: 'still rain', video_prompt: 'camera push' }],
  },
  submit_joins: {
    joins: [{ after_no: 'S01', to_no: 'S99', relation: 'cut' }],
  },
}

let lexiconKey = '推'
try {
  const lex = await byName.get('list_camera_lexicon').invoke({ limit: 1 })
  const rows = lex?.entries
  if (Array.isArray(rows) && rows.length && rows[0]?.key) lexiconKey = String(rows[0].key)
} catch {
  /* 下面 get 用默认 key */
}
staticArgs.get_camera_lexicon = { key: lexiconKey }

// read_asset_detail 的 key 必须来自 inventory 返回的行，不能写死
let assetDetailArgs = { category: 'characters', key: '__none__' }
try {
  const inv = byName.get('read_asset_inventory')
  if (inv) {
    for (const cat of ['characters', 'scenes', 'props', 'assets', 'whitebox']) {
      const r = await inv.invoke({ category: cat, includeRows: true, limit: 5 })
      const row = Array.isArray(r?.rows) ? r.rows[0] : null
      if (row?.key) {
        assetDetailArgs = { category: cat, key: row.key }
        break
      }
    }
  }
} catch {
  /* 保留兜底参数，仍会走 ok:false 分支 */
}
staticArgs.read_asset_detail = assetDetailArgs

const results = []

for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
  const args = staticArgs[tool.name]
  if (args === undefined) {
    if (tool.name === 'read_skill' || tool.name === 'read_skill_text') {
      check(`调用 ${tool.name}`, false, '无已安装技能可测')
    } else {
      check(`调用 ${tool.name}`, false, '未配置验收参数')
    }
    results.push({ name: tool.name, status: 'no-args' })
    continue
  }
  try {
    const out = await tool.invoke(args)
    const rec = out && typeof out === 'object' ? out : { ok: true, value: out }
    const businessOk = rec.ok !== false
    const hint =
      rec.ok === false
        ? String(rec.error || rec.errors?.join?.('；') || 'ok:false')
        : 'ok'
    check(`调用 ${tool.name}`, true, hint.slice(0, 120))
    results.push({
      name: tool.name,
      status: businessOk ? 'ok' : 'ok:false',
      hint,
    })
  } catch (e) {
    check(`调用 ${tool.name}`, false, (e && e.message) || String(e))
    results.push({ name: tool.name, status: 'throw', hint: (e && e.message) || String(e) })
  }
}

const missingInPayload = payload.toolNames.filter((n) => !byName.has(n))
if (missingInPayload.length) {
  check('载荷列出的工具均已绑定', false, missingInPayload.join(', '))
}

console.log('\n--- 汇总 ---')
const invoked = results.filter((r) => r.status !== 'no-args' && r.status !== 'throw')
const businessFail = results.filter((r) => r.status === 'ok:false')
console.log(
  `工具总数 ${tools.length}；可 invoke ${invoked.length}；业务 ok:false ${businessFail.length}${businessFail.length ? `（${businessFail.map((r) => r.name).join(', ')}）` : ''}`,
)

child.kill()
process.exit(bad > 0 ? 1 : 0)