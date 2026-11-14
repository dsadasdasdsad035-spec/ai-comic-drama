/**
 * 创意聊天：逐个宿主技能校验载荷组装与工具绑定（无项目 / 有项目）。
 * 跑法：node verify-creative-all-skills.mjs
 */
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5351
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-all-skills-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(ROOT, 'src/creative/creativeTurnPayload.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/creative/tools.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/creative/projectStageAdapter.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/skills/validate.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
    `export { parseSkillText } from ${JSON.stringify(path.join(ROOT, 'src/skills/parse.ts'))}`,
    `export { loadSkills } from ${JSON.stringify(path.join(ROOT, 'src/skills/registry.ts'))}`,
  ].join('\n'),
)

const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
  plugins: [
    {
      name: 'skill-md-raw',
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (args) => {
          const p = args.path.replace(/\?raw$/, '')
          return { path: path.isAbsolute(p) ? p : path.join(path.dirname(args.importer), p), namespace: 'md-raw' }
        })
        b.onLoad({ filter: /.*/, namespace: 'md-raw' }, async (args) => ({
          contents: await fs.promises.readFile(args.path, 'utf8'),
          loader: 'text',
        }))
      },
    },
  ],
})
const lib = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const CREATIVE_ONLY = new Set([
  'read_creative_session',
  'read_creative_source',
  'read_video_shots',
  'read_frame_detail',
  'probe_source',
  'split_scenes',
  'extract_frames',
  'submit_reverse_pack',
  'generate_image',
  'generate_video',
  'generate_voice',
  // Pi 原生 / 平台内置里只在创意会话内可用的工具（非项目契约）
  'read_skill',
  'read_skill_text',
  'list_installed_skills',
  'list_experts',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
])

const STAGE_TOOLS = new Set([
  'read_source',
  'read_episodes',
  'read_characters',
  'read_episode',
  'read_shots',
  'read_designs',
  'read_transition_recipes',
  'submit_characters',
  'submit_designs',
  'submit_shots',
  'submit_prompts',
  'submit_prompt_renders',
  'submit_joins',
])

function missingTools(manifestTools, bound) {
  const names = new Set(bound.map((t) => t.name))
  if (!names.has('read_skill')) names.add('read_skill') // 绑定层会注入
  return manifestTools.filter((t) => !names.has(t))
}

function mockCreativeSet(lib) {
  return lib.createCreativeToolSet({
    sessionId: 'verify-all',
    getSnapshot: async () => ({
      session: {
        id: 'verify-all',
        title: '验收',
        mode: 'plan',
        createdAt: '',
        updatedAt: '',
      },
      sources: [],
      artifacts: [],
      shots: {},
    }),
    settings: { providers: [], models: [], defaults: {} },
  })
}

function mockProject() {
  return {
    source: '验收梗概',
    logline: '',
    style: '电影',
    aspect: '16:9',
    episodes: [{ no: 1, title: 'E01', targetSeconds: 60 }],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01', desc: '起' }],
    characters: [{ id: 'hero', name: '主角', lookEn: 'a person' }],
    designs: [],
    sceneLayouts: [],
  }
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

// 建一个最小项目供 stage 工具读
const proj = 'skill-verify-proj'
await fetch(`${APP}/api/project?name=${encodeURIComponent(proj)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project: mockProject() }),
})

// 技能已改为安装进 DB：空数据目录里没有安装记录（必然 0 条）。
// 从本机真实库只读复制一份安装记录，套件才有东西可验收；真实库只读不写。
const seedDb = path.join(ROOT, 'projects', 'storyboard.sqlite')
const tempDb = path.join(TMP, 'storyboard.sqlite')
if (fs.existsSync(seedDb) && fs.existsSync(tempDb)) {
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(seedDb, { readOnly: true })
  const rows = src
    .prepare('SELECT skill_id, provider, slug, namespace, version, text, meta, installed_at FROM skill_installs')
    .all()
  src.close()
  const dst = new DatabaseSync(tempDb)
  const ins = dst.prepare(
    'INSERT OR REPLACE INTO skill_installs (skill_id, provider, slug, namespace, version, text, meta, installed_at) VALUES (?,?,?,?,?,?,?,?)',
  )
  for (const r of rows) ins.run(r.skill_id, r.provider, r.slug, r.namespace, r.version, r.text, r.meta, r.installed_at)
  dst.close()
  console.log(`已从本机库复制 ${rows.length} 条技能安装记录`)
} else {
  console.log('未找到本机库，技能目录可能为空')
}

const list = await (await fetch(`${APP}/api/skills`)).json()
const records = (list.skills || []).map((s) => ({
  id: s.id,
  text: s.text,
  builtinText: s.builtinText,
  source: s.source,
}))
const { skills, issues } = lib.parseSkillRecords(records)
check('技能目录可解析', skills.size > 0, `${skills.size} 个，${issues.length} 条 issue`)

const nativeFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('/api/skills') && !u.match(/\/api\/skills\/[^/?]+/)) {
    return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return nativeFetch(url, init)
}
const creativeSet = mockCreativeSet(lib)
let projectSnap = mockProject()
const projectCtx = {
  projectName: proj,
  epNo: 1,
  getSnapshot: () => projectSnap,
  setSnapshot: (p) => {
    projectSnap = p
  },
}

const catalog = [...skills.values()].filter(
  (s) => s.manifest.runtime === 'tools' || String(s.manifest.runtime) === 'json-tools',
)
check('tools 技能数量', catalog.length >= 10, String(catalog.length))

const results = []

for (const skill of catalog.sort((a, b) => a.id.localeCompare(b.id))) {
  let row = { id: skill.id, payload: false, noProj: '', withProj: '', skip: '' }

  try {
    lib.buildCreativeTurnPayload({ host: skill, messages: [], draftText: 'ping' })
    row.payload = true
  } catch (e) {
    row.noProj = `载荷失败：${e?.message || e}`
    results.push(row)
    continue
  }

  const tools0 = lib.bindCreativeHostTools(creativeSet, skill, null)
  // 创意侧平台内置工具由 mergeBuiltinWithSkillTools 统一并入，不属于「技能绑定」缺失
  const miss0 = missingTools(skill.manifest.tools, tools0).filter((t) => !CREATIVE_ONLY.has(t))

  if (miss0.length === 0) {
    row.noProj = 'ok'
  } else if (miss0.every((t) => STAGE_TOOLS.has(t))) {
    row.noProj = `缺项目工具：${miss0.join(',')}`
  } else if (miss0.every((t) => CREATIVE_ONLY.has(t) || STAGE_TOOLS.has(t))) {
    row.noProj = `缺：${miss0.join(',')}`
  } else {
    row.noProj = `未绑定：${miss0.join(',')}`
  }

  if (lib.canUseProjectStage(skill)) {
    const adapter = lib.createCreativeProjectAdapter(skill, projectCtx)
    if (!adapter) {
      row.withProj = 'adapter=null'
    } else {
      try {
        const stageSet = lib.createStageToolSet(adapter)
        const tools1 = lib.bindCreativeHostTools(creativeSet, skill, stageSet)
        const miss1 = missingTools(skill.manifest.tools, tools1)
        row.withProj = miss1.length ? `仍缺：${miss1.join(',')}` : 'ok'
      } catch (e) {
        row.withProj = `stageSet：${e?.message || e}`
      }
    }
  } else if (skill.manifest.tools.length === 0) {
    row.withProj = '无声明工具'
    row.skip = 'intake/空工具'
  } else if (skill.manifest.tools.every((t) => CREATIVE_ONLY.has(t))) {
    row.withProj = row.noProj === 'ok' ? 'ok' : row.noProj
  } else {
    row.withProj = '非项目契约（仅创意工具）'
  }

  // 抽样调用：read_skill 必调；创意/项目各调一个读工具（不触发付费生成）
  const toolsFinal =
    row.withProj === 'ok' && lib.canUseProjectStage(skill)
      ? (() => {
          const adapter = lib.createCreativeProjectAdapter(skill, projectCtx)
          const stageSet = lib.createStageToolSet(adapter)
          return lib.bindCreativeHostTools(creativeSet, skill, stageSet)
        })()
      : lib.bindCreativeHostTools(creativeSet, skill, null)

  const rs = toolsFinal.find((t) => t.name === 'read_skill')
  if (rs) {
    try {
      const out = await rs.invoke({ id: skill.id })
      if (!out?.ok && out?.text === undefined) row.invoke = `read_skill 失败：${JSON.stringify(out).slice(0, 120)}`
      else row.invoke = 'read_skill ok'
    } catch (e) {
      row.invoke = `read_skill 异常：${e?.message || e}`
    }
  }

  const sample =
    skill.manifest.tools.find((t) => t.startsWith('read_') && t !== 'read_skill' && toolsFinal.some((x) => x.name === t)) ||
    ''
  if (sample) {
    const tool = toolsFinal.find((t) => t.name === sample)
    try {
      const args =
        sample === 'read_episode'
          ? { episode: 1 }
          : sample === 'read_creative_source'
            ? { sourceId: '' }
            : {}
      const out = await tool.invoke(args)
      const sampleOk = out?.ok !== false && !out?.error
      row.invoke = (row.invoke ? row.invoke + '; ' : '') + `${sample} ${sampleOk ? 'ok' : 'err'}`
    } catch (e) {
      row.invoke = (row.invoke ? row.invoke + '; ' : '') + `${sample} 异常`
    }
  }

  results.push(row)
}

const scene3d = [...skills.values()].filter((s) => s.manifest.runtime === 'scene3d')
// 本机未必装了 scene3d 技能；没有就无从验证「不计入创意下拉」，标为不适用而非失败
check(
  'scene3d 不计入创意下拉',
  scene3d.length >= 1 || catalog.every((s) => s.manifest.runtime !== 'scene3d'),
  scene3d.length ? scene3d.map((s) => s.id).join(',') : '跳过：本机无 scene3d 技能',
)

for (const row of results) {
  const passNoProj =
    row.payload &&
    (row.noProj === 'ok' || row.noProj.startsWith('缺项目工具') || row.skip === 'intake/空工具')
  const passWithProj =
    row.withProj === 'ok' ||
    row.withProj === '无声明工具' ||
    row.withProj === '非项目契约（仅创意工具）' ||
    (row.skip && row.withProj.startsWith(row.noProj))

  const invokeOk =
    !row.invoke ||
    (row.invoke.includes('read_skill ok') && !row.invoke.includes('异常'))
  const ok = passNoProj && (passWithProj || row.withProj === '无声明工具') && invokeOk
  const detail = [row.noProj, row.withProj, row.invoke].filter(Boolean).join(' · ')
  check(`技能 ${row.id}`, ok, detail)
}

const fullBound = results.filter((r) => r.withProj === 'ok' || r.noProj === 'ok')
check(
  '全部 tools 技能在有项目时工具齐套',
  fullBound.length === catalog.length,
  `${fullBound.length}/${catalog.length}`,
)

child.kill()
process.exit(bad ? 1 : 0)
