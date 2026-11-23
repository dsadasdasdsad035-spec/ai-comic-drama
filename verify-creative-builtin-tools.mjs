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
// 31 镜、每镜带长视频提示词：一集序列化后超过读预算，逼出游标续读
const shots = Array.from({ length: 31 }, (_, i) => {
  const no = 'S' + String(i + 1).padStart(2, '0')
  return {
    id: 'E01-' + no,
    episode: 1,
    no,
    seconds: 3,
    size: '中景',
    desc: '街口 ' + no,
      keyframe_prompt: 'rain ' + no,
      video_prompt: i === 0 ? 'push' : 'push ' + no + ' ' + '运镜描述'.repeat(400),
      ...(i === 0
        ? {
            transition_out: {
              to: 'E01-S02',
              mode: 'generated',
              generated: { prompt: '雨里推近到下一镜', targetSeconds: 2, inheritRefs: true },
            },
          }
        : {}),
    }
})
createProject(root, ${JSON.stringify(proj)}, { title: 'tool验收' })
writeProject(root, ${JSON.stringify(proj)}, {
  source: '验收原著',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
  shots,
  characters: [{ id: 'c1', name: '主角', look_cn: '穿外套的人', look_en: 'a person in coat' }],
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
check('内置专家可用', (expertsRes.experts || []).some((e) => e.id === 'expert-omni'), JSON.stringify((expertsRes.experts || []).map((e) => e.id)))

const lib = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const PI = lib.createPiNativeToolSet()
const platform = lib.createBuiltinPlatformTools({ projectName: proj, epNo: 1 })
const skillTools = lib.bindSkillTools(PI, [])
const tools = lib.mergeBuiltinWithSkillTools(platform, skillTools)
const byName = new Map(tools.map((t) => [t.name, t]))

// 工具清单不再从已删除的前端载荷模块取：直接看合并后的工具集合，
// 这正是宿主经工具桥注册到的那份（`server/studio-tool-bridge.mjs`）。
const toolNames = tools.map((t) => t.name)
check('工具数量', toolNames.length >= 15, String(toolNames.length))

for (const name of toolNames) {
  check(`已注册 ${name}`, byName.has(name))
}

const skillsRes = await (await nativeFetch(`${APP}/api/skills`)).json()
const skillRows = skillsRes.skills || []
const sampleSkillId =
  skillRows.find((s) => s.id === FIXTURE_SKILL)?.id ||
  skillRows[0]?.id ||
  FIXTURE_SKILL
check('技能 id 用于 read_*', Boolean(sampleSkillId), sampleSkillId)

/**
 * 每个工具的验收规格：`args` 是最小参数，`expect` 声明期望结果。
 * - `expect: 'ok'`：必须真的成功；返回 ok:false 判为意外失败。
 * - `expect: 'fail'`：必须失败，且 `reason` 要能匹配到失败原因。
 *   fail-closed（缺确认通道、缺成本通道、工位不支持、目标不存在）属于预期失败；
 *   原因对不上说明失败路径变了，同样判失败。
 * 缺 `expect` 或 `fail` 缺 `reason` 直接判规格缺失，不允许「跑通不抛错就算过」。
 */
const toolSpecs = {
  // ---- 只读 ----
  read_source: { args: {}, expect: 'ok' },
  read_episodes: { args: {}, expect: 'ok' },
  read_episode: { args: { episode: 1 }, expect: 'ok' },
  read_characters: { args: {}, expect: 'ok' },
  read_designs: { args: {}, expect: 'ok' },
  read_shots: { args: { episode: 1, limit: 5 }, expect: 'ok' },
  read_shot_detail: { args: { episode: 1, no: 'S01' }, expect: 'ok' },
  read_shot_video_prompt: { args: { episode: 1, no: 'S01' }, expect: 'ok' },
  read_shot_video_inputs: { args: { episode: 1, no: 'S01' }, expect: 'ok' },
  read_asset_inventory: { args: {}, expect: 'ok' },
  list_camera_lexicon: { args: { limit: 2 }, expect: 'ok' },
  list_installed_skills: { args: {}, expect: 'ok' },
  list_experts: { args: {}, expect: 'ok' },
  ...(sampleSkillId
    ? {
        read_skill_text: { args: { id: sampleSkillId }, expect: 'ok' },
        read_skill: { args: { id: sampleSkillId }, expect: 'ok' },
      }
    : {
        read_skill_text: { expect: 'skip', skip: '没有已安装技能' },
        read_skill: { expect: 'skip', skip: '没有已安装技能' },
      }),
  get_camera_lexicon: { args: { key: 'push' }, expect: 'ok' },

  // ---- 写回 ----
  submit_episodes: {
    args: {
      episodes: [
        {
          no: 1,
          title: '验收集',
          scenes: [{ slug: '街口', place: '街口', time: '夜', beats: '验收场次' }],
        },
      ],
    },
    expect: 'ok',
  },
  submit_characters: {
    args: {
      version: 1,
      characters: [{ name: '验收角色', lookEn: 'smoke test character' }],
    },
    expect: 'ok',
  },
  submit_designs: { args: { version: 1, scenes: [], props: [] }, expect: 'ok' },
  submit_shots: {
    args: {
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
    expect: 'ok',
  },
  submit_prompts: {
    args: { shots: [{ no: 'S01', keyframe_prompt: 'still rain', video_prompt: 'camera push' }] },
    expect: 'ok',
  },
  submit_joins: {
    args: { joins: [{ after_no: 'S01', to_no: 'S99', relation: 'cut' }] },
    expect: 'ok',
  },
  submit_assets: {
    args: { assets: [{ title: '验收素材', kind: 'image', url: '/project-assets/none.png' }] },
    expect: 'fail',
    reason: /项目媒体|项目素材|不存在|找不到/,
  },

  // ---- 需要破坏性动作确认通道：本脚本 ctx 没有 confirm，必须 fail-closed ----
  create_project: { args: { name: 'verify-created-project' }, expect: 'fail', reason: /确认/ },
  update_project_meta: { args: { style: '验收画风' }, expect: 'fail', reason: /确认/ },
  delete_shots: { args: { nos: ['S01'] }, expect: 'fail', reason: /确认/ },

  // ---- 生成类：本脚本 ctx 没有 askCost，必须 fail-closed 而不是真的发请求 ----
  generate_keyframe: {
    // 全部镜头都有视频提示词，工位判为出片；首帧工具在这个工位不可用
    args: { no: 'S01' },
    expect: 'fail',
    reason: /工位|出片/,
  },
  // 统一拼装先判阻塞：该镜没有任何连线参考，出片在成本确认之前就被拒
  generate_clip: { args: { no: 'S01' }, expect: 'fail', reason: /连线|参考图|成本确认|确认通道/ },
  generate_voice: { args: { no: 'S01', text: '验收台词' }, expect: 'fail', reason: /成本确认|确认通道/ },
  generate_character_views: { args: { character: '验收' }, expect: 'fail', reason: /找不到角色/ },
  generate_expression_sheet: { args: { character: '验收' }, expect: 'fail', reason: /找不到角色/ },

  // ---- 素材/画布动作：缺画布与角色落库通道，同样 fail-closed ----
  link_shot_refs: {
    args: { no: 'S01', kind: 'character', names: ['验收'] },
    expect: 'fail',
    reason: /找不到角色/,
  },
  set_character_visual: {
    args: { character: '验收', target: 'image', url: '/project-assets/none.png' },
    expect: 'fail',
    reason: /找不到角色/,
  },

  publish_shot_clip_frame: {
    args: { no: 'S01', role: 'head' },
    expect: 'fail',
    reason: /成片|clip|视频|没有/,
  },
  link_prev_shot_tail_frame: {
    args: { no: 'S02' },
    expect: 'fail',
    reason: /成片|上一镜|视频|没有/,
  },

  // 包内文件读取：验收包只有 SKILL.md，读它必须成功（路径越界另有单测）
  read_skill_file: { args: { id: FIXTURE_SKILL, path: 'SKILL.md' }, expect: 'ok' },

  // ---- 提示词案例库：全局作用域，未选项目也必须能用 ----
  // 列表与词表在空库下也必须 ok（空列表 + 可读提示），所以固定参数即可；
  // 单条钻取的 id 必须来自列表返回的行（见下方动态规格）。
  list_prompt_cases: { args: { pageSize: 3 }, expect: 'ok' },
  read_prompt_case_facets: { args: {}, expect: 'ok' },
}

let lexiconKey = ''
try {
  const lex = await byName.get('list_camera_lexicon').invoke({ limit: 1 })
  const rows = lex?.entries
  if (Array.isArray(rows) && rows.length && rows[0]?.key) lexiconKey = String(rows[0].key)
} catch {
  /* 下面按规格缺失处理 */
}
// 运镜 key 必须来自 catalog，不能写死
toolSpecs.set_shot_camera_lexicon = lexiconKey
  ? { args: { no: 'S01', entry: lexiconKey }, expect: 'ok' }
  : { expect: 'skip', skip: 'list_camera_lexicon 没有返回任何条目' }
if (lexiconKey) toolSpecs.get_camera_lexicon = { args: { key: lexiconKey }, expect: 'ok' }

// read_asset_detail 的 key 必须来自 inventory 返回的行，不能写死
let assetDetailArgs = null
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
  /* 下面按规格缺失处理 */
}
toolSpecs.read_asset_detail = assetDetailArgs
  ? { args: assetDetailArgs, expect: 'ok' }
  : { expect: 'skip', skip: 'read_asset_inventory 没有返回任何可钻取的条目' }

// get_prompt_case 的 id 必须来自列表返回的行，不能写死；案例库为空时整条跳过
let promptCaseArgs = null
try {
  const list = byName.get('list_prompt_cases')
  const r = list ? await list.invoke({ pageSize: 1 }) : null
  const first = Array.isArray(r?.cases) ? r.cases[0] : null
  if (first?.id) promptCaseArgs = { id: String(first.id) }
} catch {
  /* 下面按规格缺失处理 */
}
toolSpecs.get_prompt_case = promptCaseArgs
  ? { args: promptCaseArgs, expect: 'ok' }
  : { expect: 'skip', skip: '提示词案例库为空（先导入或反推一条再验）' }

const results = []

/** 从工具返回里取失败原因文本，供预期失败的 reason 匹配 */
const failText = (rec) => {
  const parts = [
    rec?.error,
    rec?.message,
    ...(Array.isArray(rec?.errors) ? rec.errors.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []),
  ]
  const text = parts.filter(Boolean).join('；')
  return text || 'ok:false（没有给出原因）'
}

for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
  const spec = toolSpecs[tool.name]
  if (!spec || !spec.args) {
    if (spec?.expect === 'skip') {
      console.log(`⏭️  调用 ${tool.name} | 跳过：${spec.skip || '不适用'}`)
      results.push({ name: tool.name, status: 'skip', hint: spec.skip || '' })
    } else if (spec) {
      check(`调用 ${tool.name}`, false, '声明了期望但没给参数')
      results.push({ name: tool.name, status: 'no-spec', hint: '没给参数' })
    } else {
      check(`调用 ${tool.name}`, false, '未配置验收规格（缺 args / expect）')
      results.push({ name: tool.name, status: 'no-spec', hint: '未配置验收规格' })
    }
    continue
  }
  if (spec.expect !== 'ok' && spec.expect !== 'fail') {
    check(`调用 ${tool.name}`, false, `期望未声明（expect=${String(spec.expect)}）`)
    results.push({ name: tool.name, status: 'no-spec', hint: '期望未声明' })
    continue
  }
  if (spec.expect === 'fail' && !(spec.reason instanceof RegExp)) {
    check(`调用 ${tool.name}`, false, '预期失败必须给出可匹配的 reason')
    results.push({ name: tool.name, status: 'no-spec', hint: '预期失败缺 reason' })
    continue
  }
  try {
    const out = await tool.invoke(spec.args)
    const rec = out && typeof out === 'object' ? out : { ok: true, value: out }
    const businessOk = rec.ok !== false
    if (spec.expect === 'ok') {
      if (businessOk) {
        check(`调用 ${tool.name}`, true, 'ok')
        results.push({ name: tool.name, status: 'ok', hint: 'ok' })
      } else {
        const hint = failText(rec)
        check(`调用 ${tool.name}`, false, `预期成功但失败：${hint}`)
        results.push({ name: tool.name, status: 'unexpected-fail', hint })
      }
      continue
    }
    if (businessOk) {
      check(`调用 ${tool.name}`, false, '预期失败但真的执行了（可能已落库或已发起请求）')
      results.push({ name: tool.name, status: 'unexpected-ok', hint: '预期失败却成功' })
      continue
    }
    const hint = failText(rec)
    if (spec.reason.test(hint)) {
      check(`调用 ${tool.name}`, true, `预期失败：${hint}`)
      results.push({ name: tool.name, status: 'expected-fail', hint })
    } else {
      check(`调用 ${tool.name}`, false, `失败原因不符（期望 ${spec.reason}）：${hint}`)
      results.push({ name: tool.name, status: 'unexpected-fail', hint })
    }
  } catch (e) {
    check(`调用 ${tool.name}`, false, (e && e.message) || String(e))
    results.push({ name: tool.name, status: 'throw', hint: (e && e.message) || String(e) })
  }
}

const missingInPayload = toolNames.filter((n) => !byName.has(n))
if (missingInPayload.length) {
  check('清单里的工具均已绑定', false, missingInPayload.join(', '))
}

// --- 分镜续读：同一集连续两次读到不同镜头，nextCursor 最终消失 ---
{
  const readShotsTool = byName.get('read_shots')
  if (!readShotsTool) {
    check('read_shots 可续读', false, '工具缺失')
  } else {
    try {
      const round1 = await readShotsTool.invoke({ episode: 1 })
      const ids1 = (round1?.shots || []).map((s) => String(s.id || ''))
      check(
        '首次读取按整条截断并给出 nextCursor',
        round1?.truncated === true && Boolean(round1?.nextCursor) && ids1.length > 0,
        `returned=${ids1.length} total=${round1?.total}`,
      )
      const round2 = await readShotsTool.invoke({ episode: 1, cursor: round1?.nextCursor })
      const ids2 = (round2?.shots || []).map((s) => String(s.id || ''))
      const overlap = ids2.filter((id) => ids1.includes(id))
      check('续读拿到的是另一批镜头（不重复）', ids2.length > 0 && overlap.length === 0, `round2=${ids2.length}`)

      const seen = new Set([...ids1, ...ids2])
      let cursor = round2?.nextCursor
      let rounds = 2
      while (cursor && rounds < 20) {
        const next = await readShotsTool.invoke({ episode: 1, cursor })
        for (const s of next?.shots || []) seen.add(String(s.id || ''))
        cursor = next?.nextCursor
        rounds++
      }
      check('续读到尾不再给游标且覆盖全部镜头', !cursor && seen.size === 31, `covered=${seen.size}/${round1?.total}`)
      const detailed = await byName.get('read_shot_detail').invoke({ shotId: [...seen][30] })
      check('钻取工具能按 shotId 取到全集里的最后一镜', detailed?.ok === true, String(detailed?.shotId || detailed?.error || ''))
    } catch (e) {
      check('read_shots 可续读', false, (e && e.message) || String(e))
    }
  }
}

// --- 2.1 运镜库：结构、limit 与按 key 取到的条目一致 ---
{
  const listTool = byName.get('list_camera_lexicon')
  const getTool = byName.get('get_camera_lexicon')
  const all = await listTool.invoke({})
  const allRows = Array.isArray(all?.entries) ? all.entries : []
  check('运镜库返回非空条目', allRows.length > 2, `entries=${allRows.length}`)
  const badRow = allRows.find((e) => !e?.key || !e?.cn)
  check('运镜库每项都带 key 与中文名', !badRow, badRow ? JSON.stringify(badRow) : '')
  const limited = await listTool.invoke({ limit: 2 })
  const limitedRows = Array.isArray(limited?.entries) ? limited.entries : []
  check('运镜库 limit 生效', limitedRows.length === 2, `entries=${limitedRows.length}`)
  const one = await getTool.invoke({ key: lexiconKey })
  const sameRow = allRows.find((e) => e.key === lexiconKey)
  check(
    '按 key 取到的条目与列表里同名项一致',
    one?.ok === true && one?.entry?.key === lexiconKey && one?.entry?.cn === sameRow?.cn,
    `${String(one?.entry?.cn)} vs ${String(sameRow?.cn)}`,
  )
  const ghost = await getTool.invoke({ key: '__not-in-catalog__' })
  check(
    '未知运镜 key 返回可读失败',
    ghost?.ok === false && /__not-in-catalog__/.test(String(ghost?.error || '')),
    String(ghost?.error || ''),
  )
}

// --- 2.2 专家与技能目录：非空结构 + 默认专家 ---
{
  const ex = await byName.get('list_experts').invoke({})
  const rows = Array.isArray(ex?.experts) ? ex.experts : []
  check('专家列表非空', rows.length > 0 && ex?.count === rows.length, `count=${ex?.count}`)
  const badExpert = rows.find((e) => !e?.id || !e?.name)
  check('专家项都带 id 与可读名称', !badExpert, badExpert ? JSON.stringify(badExpert) : '')
  check(
    '专家列表含默认全能专家',
    rows.some((e) => e.id === 'expert-omni'),
    rows.map((e) => e.id).join(','),
  )

  const sk = await byName.get('list_installed_skills').invoke({})
  const skills = Array.isArray(sk?.skills) ? sk.skills : []
  check('技能列表非空且 count 一致', skills.length > 0 && sk?.count === skills.length, `count=${sk?.count}`)
  const badSkill = skills.find((s) => !s?.id || !s?.name)
  check('技能项都带 id 与可读名称', !badSkill, badSkill ? JSON.stringify(badSkill) : '')
  check(
    '技能列表含刚上传的 Agent 包',
    skills.some((s) => s.id === FIXTURE_SKILL),
    skills.map((s) => s.id).slice(0, 8).join(','),
  )
}

// --- 2.3 技能正文：取得到、含标识，且不存在的 id 是失败而不是空正文 ---
{
  const r = await byName.get('read_skill_text').invoke({ id: sampleSkillId })
  const text = String(r?.text || '')
  check(
    '技能正文可取且含技能标识',
    r?.ok === true && text.length > 50 && text.includes(sampleSkillId),
    `len=${text.length}`,
  )
  const ghost = await byName.get('read_skill_text').invoke({ id: '__no-such-skill__' })
  check(
    '不存在的技能 id 返回可读失败',
    ghost?.ok === false && /__no-such-skill__/.test(String(ghost?.error || '')),
    String(ghost?.error || ''),
  )
}

/** 走 HTTP 重读项目，确认写回真的落库（而不是只改了内存快照） */
const readProjectNow = async () => {
  const res = await nativeFetch(`${APP}/api/project?name=${encodeURIComponent(proj)}`)
  const j = await res.json()
  if (!j?.ok) throw new Error(j?.message || `GET /api/project 失败：HTTP ${res.status}`)
  return j.project || {}
}

// --- 2.4 submit_assets：合法项目内图片写回，越界地址整批拒绝且不改库 ---
{
  const rel = 'verify-asset.png'
  const dir = path.join(TMP, proj, 'assets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, rel), Buffer.from('89504e470d0a1a0a', 'hex'))
  const url = `/project-assets/${proj}/${rel}`
  const before = (await readProjectNow()).assets || []

  const ok = await byName.get('submit_assets').invoke({
    assets: [{ title: '验收素材', kind: 'image', url }],
  })
  check('submit_assets 成功写回', ok?.ok === true && ok?.counts?.added === 1, ok?.error || ok?.summary || '')
  const after = (await readProjectNow()).assets || []
  check(
    '素材卡落到项目且 url 一致',
    after.length === before.length + 1 && after.some((a) => String(a?.url || '') === url),
    `before=${before.length} after=${after.length}`,
  )

  const denied = await byName.get('submit_assets').invoke({
    assets: [{ title: '项目外素材', kind: 'image', url: '/project-assets/another-project/x.png' }],
  })
  const afterDenied = (await readProjectNow()).assets || []
  check(
    '项目外地址整批拒绝',
    denied?.ok === false && /项目媒体/.test(String(denied?.error || '')),
    String(denied?.error || ''),
  )
  check('拒绝后素材数量不变', afterDenied.length === after.length, `${after.length} → ${afterDenied.length}`)
}

// --- 2.5 submit_prompts：提示词真的写进镜头 ---
{
  const ok = await byName.get('submit_prompts').invoke({
    shots: [{ no: 'S02', keyframe_prompt: 'smoke-keyframe', video_prompt: 'smoke-video' }],
  })
  check('submit_prompts 应用一镜', ok?.ok === true && ok?.counts?.patched === 1, ok?.error || ok?.summary || '')
  const shot = ((await readProjectNow()).shots || []).find((s) => String(s?.no) === 'S02')
  check(
    '提示词写回落到镜头字段',
    String(shot?.keyframe_prompt || '') === 'smoke-keyframe' &&
      String(shot?.video_prompt || '') === 'smoke-video',
    `kf=${String(shot?.keyframe_prompt)} vp=${String(shot?.video_prompt)}`,
  )

  // 镜号不存在时按 mergePromptDraft 语义计入 missing 并保持项目不变，
  // 不是整体失败：Agent 可以一次提交整集，个别镜号对不上不该让整批回滚。
  const snapshot = JSON.stringify((await readProjectNow()).shots || [])
  const ghostShot = await byName.get('submit_prompts').invoke({
    shots: [{ no: 'S777', keyframe_prompt: 'x', video_prompt: 'y' }],
  })
  check(
    '不存在的镜号计入 missing 且不写库',
    ghostShot?.ok === true && ghostShot?.counts?.missing === 1 && ghostShot?.counts?.patched === 0,
    ghostShot?.summary || ghostShot?.error || '',
  )
  check('镜号对不上时项目镜头未被改动', JSON.stringify((await readProjectNow()).shots || []) === snapshot)
}

// --- 2.6 submit_joins：硬切清掉前一镜接缝，生成转场写入 mode=generated ---
{
  const first = await byName.get('submit_joins').invoke({
    joins: [{ after_no: 'S03', to_no: 'S04', relation: 'transition', generated: { prompt: '种子转场' } }],
  })
  const seeded = ((await readProjectNow()).shots || []).find((s) => String(s?.no) === 'S03')
  check(
    '生成转场写到前一镜 transition_out',
    first?.ok === true && first?.counts?.generated === 1 && seeded?.transition_out?.mode === 'generated',
    first?.error || first?.summary || '',
  )

  const second = await byName.get('submit_joins').invoke({
    joins: [
      { after_no: 'S03', to_no: 'S04', relation: 'cut' },
      { after_no: 'S05', to_no: 'S06', relation: 'transition', generated: { prompt: '验收转场' } },
    ],
  })
  const shots = (await readProjectNow()).shots || []
  const s3 = shots.find((s) => String(s?.no) === 'S03')
  const s5 = shots.find((s) => String(s?.no) === 'S05')
  const s6 = shots.find((s) => String(s?.no) === 'S06')
  check(
    '一条硬切 + 一条生成转场都被应用',
    second?.ok === true && second?.counts?.cuts === 1 && second?.counts?.generated === 1,
    second?.error || second?.summary || '',
  )
  check('硬切把前一镜 transition_out 清空', s3?.transition_out === null, JSON.stringify(s3?.transition_out))
  check(
    '生成转场写在后一镜对应的前一镜上且指向正确目标',
    s5?.transition_out?.mode === 'generated' && String(s5?.transition_out?.to || '') === String(s6?.id || ''),
    `mode=${String(s5?.transition_out?.mode)} to=${String(s5?.transition_out?.to)} want=${String(s6?.id)}`,
  )
}

// --- 2.7 submit_characters：锚点必须真的落库；同名重复提交不崩、不丢、不覆盖 ---
{
  // 逐项 invoke 已用驼峰载荷提交过「验收角色」，先读回确认锚点没被清成空串
  const chars1 = (await readProjectNow()).characters || []
  const first = chars1.find((c) => String(c?.name || '') === '验收角色')
  check(
    'submit_characters 的英文锚点落到项目里',
    Boolean(first) && String(first?.look_en || '') === 'smoke test character',
    JSON.stringify(first ?? null),
  )
  check(
    '落库角色只有蛇形字段',
    Boolean(first) && 'look_cn' in first && !('lookEn' in first),
    Object.keys(first || {}).join(','),
  )
  const seededEn = String(chars1.find((c) => String(c?.name || '') === '主角')?.look_en || '')
  check('种子角色的锚点可读回', seededEn === 'a person in coat', `look_en=${seededEn}`)

  // 同名重复提交：必须成功，且保留已有锚点、不动其他角色
  const again = await byName.get('submit_characters').invoke({
    characters: [{ name: '验收角色', look_en: 'should not overwrite' }],
  })
  const chars2 = (await readProjectNow()).characters || []
  const second = chars2.find((c) => String(c?.name || '') === '验收角色')
  check('同名角色重复提交成功', again?.ok === true, again?.error || again?.summary || '')
  check(
    '重复提交不覆盖已有锚点',
    String(second?.look_en || '') === 'smoke test character',
    `look_en=${String(second?.look_en)}`,
  )
  check(
    '重复提交不动其他角色锚点',
    String(chars2.find((c) => String(c?.name || '') === '主角')?.look_en || '') === seededEn,
  )

  // 新角色带中英文锚点：读回必须一致（防「提交成功但锚点没保存」）
  const added = await byName.get('submit_characters').invoke({
    characters: [{ name: '验收幼猫', look_cn: '白色幼猫', look_en: 'a small white kitten' }],
  })
  const chars3 = (await readProjectNow()).characters || []
  const cat = chars3.find((c) => String(c?.name || '') === '验收幼猫')
  check('新增角色提交成功', added?.ok === true, added?.error || added?.summary || '')
  check(
    '新增角色的中英文锚点读回一致',
    String(cat?.look_cn || '') === '白色幼猫' && String(cat?.look_en || '') === 'a small white kitten',
    `cn=${String(cat?.look_cn)} en=${String(cat?.look_en)}`,
  )
}

// --- 2.8 写回模式与宿主刷新：局部写回不标孤儿、写回成功才通知宿主 ---
{
  const readProjectNow = async () => (await (await fetch(`${APP}/api/project?name=${proj}`)).json()).project || {}
  let refreshed = 0
  const hosted = lib.createBuiltinPlatformTools({
    projectName: proj,
    epNo: 1,
    onProjectDataChanged: () => {
      refreshed++
    },
  })
  const hostedTools = new Map(lib.mergeBuiltinWithSkillTools(hosted, skillTools).map((t) => [t.name, t]))

  const before = ((await readProjectNow()).shots || []).length
  const added = await hostedTools.get('submit_shots').invoke({
    shots: [
      { no: 'S97', scene_no: 1, scene_slug: '街口', seconds: 2, size: '中景', move: '固定', desc: '刷新验收一' },
      { no: 'S98', scene_no: 1, scene_slug: '街口', seconds: 2, size: '中景', move: '固定', desc: '刷新验收二' },
      { no: 'S96', scene_no: 1, scene_slug: '街口', seconds: 2, size: '中景', move: '固定', desc: '刷新验收三' },
    ],
  })
  const after = (await readProjectNow()).shots || []
  check('submit_shots 三镜写回成功', added?.ok === true, added?.error || added?.summary || '')
  check('镜头数按提交增量增加', after.length === before + 3, `${before} -> ${after.length}`)
  check('写回成功后通知宿主刷新一次', refreshed === 1, `refreshed=${refreshed}`)
  const orphanAfterSubmit = after.filter((s) => s?.orphan === true)
  check(
    '整表写回不误标孤儿（其余镜头全部随快照提交）',
    orphanAfterSubmit.length === 0,
    orphanAfterSubmit.map((s) => String(s.id || s.no)).join(','),
  )

  // 单镜写回（link_shot_refs 同一通道）不得给其他镜头打标记
  const linked = await hostedTools.get('link_shot_refs').invoke({ no: 'S96', kind: 'character', names: ['主角'] })
  const afterLink = (await readProjectNow()).shots || []
  check('link_shot_refs 写回成功', linked?.ok === true, linked?.error || linked?.summary || '')
  const orphanAfterLink = afterLink.filter((s) => s?.orphan === true)
  check(
    '局部写回不给其他镜头打孤儿标记',
    orphanAfterLink.length === 0,
    orphanAfterLink.map((s) => String(s.id || s.no)).join(','),
  )
  check('局部写回保留其他镜头', afterLink.length === after.length, `${afterLink.length}/${after.length}`)
  check('每次写回成功都通知宿主', refreshed === 2, `refreshed=${refreshed}`)
}

console.log('\n--- 汇总 ---')
const byStatus = (s) => results.filter((r) => r.status === s)
const okList = byStatus('ok')
const expectedFail = byStatus('expected-fail')
const skipped = byStatus('skip')
const unexpected = results.filter((r) =>
  ['unexpected-fail', 'unexpected-ok', 'throw', 'no-spec'].includes(r.status),
)
console.log(`工具总数 ${tools.length}（逐项 invoke ${results.length}）`)
console.log(`通过 ${okList.length}；预期失败 ${expectedFail.length}；跳过 ${skipped.length}；意外失败 ${unexpected.length}`)
if (expectedFail.length) {
  console.log(`预期失败明细：${expectedFail.map((r) => `${r.name}（${r.hint.slice(0, 60)}）`).join('；')}`)
}
if (skipped.length) console.log(`跳过明细：${skipped.map((r) => `${r.name}（${r.hint}）`).join('；')}`)
if (unexpected.length) {
  console.log(`意外失败明细：${unexpected.map((r) => `${r.name}[${r.status}]（${r.hint.slice(0, 80)}）`).join('；')}`)
}
// 未在规格表里声明期望的工具同样算漏测：清单与规格表必须一一对应
const uncovered = tools.filter((t) => !toolSpecs[t.name]).map((t) => t.name)
if (uncovered.length) console.log(`未声明规格：${uncovered.join(', ')}`)

child.kill()
process.exit(bad > 0 || unexpected.length > 0 ? 1 : 0)