/**
 * 工作台聊天内置动作验收：动作清单/范围、按钮与聊天一致性、取消、
 * 回执持久化、模型工具边界。跑法：node verify-workbench-builtin-actions.mjs
 */
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5327
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-builtin-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-builtin-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/workbench-chat-builtin-actions/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---- 纯函数：动作清单、范围、可用性、线程摘要、工具边界 ----
const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/workbenchChat.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/threads.ts'))}`,
  ].join('\n') + '\n',
)
const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
  // 技能注册表用 Vite 的 `?raw` 内联 SKILL.md；esbuild 没有默认 loader
  loader: { '.md': 'text' },
})
const lib = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
)
check(
  '四个工作台的动作清单',
  Object.keys(lib.WORKBENCH_BUILTIN_KEYS).sort().join(',') === 'assets,characters,prompt-refine,shots',
)
check(
  '镜头表仅拆镜内置动作',
  lib.WORKBENCH_BUILTIN_KEYS.shots?.join(',') === 'split_shots',
)
check(
  '角色、素材无一键拆解内置动作',
  lib.WORKBENCH_BUILTIN_KEYS.characters.length === 0 && lib.WORKBENCH_BUILTIN_KEYS.assets.length === 0,
)
check(
  '镜头动作范围',
  lib.WORKBENCH_BUILTINS.split_shots.scope === 'episode' && !('prompts' in lib.WORKBENCH_BUILTIN_KEYS),
)
const fakeAction = {
  key: 'x',
  label: '测试动作',
  disabled: () => ({ disabled: true, reason: '缺少输入' }),
  run: async () => lib.builtinFailure('x', '失败'),
}
check('动作可用性返回原因', lib.builtinAvailability(fakeAction).reason === '缺少输入')
check('动态 label 解析', lib.builtinLabel({ ...fakeAction, label: () => '动态' }) === '动态')
check('失败结果带可读错误', lib.builtinFailure('x', '坏了', { cancelled: true }).cancelled === true)

const adapter = {
  surface: 'shots',
  skillId: 'shotlist',
  stage: 'shot',
  artifact: 'shots',
  writeTool: 'submit_shots',
  writeContract: 'shots-v1',
  threadKey: { project: 'x', surface: 'shots' },
  inputs: () => ({}),
  ownDraft: () => [],
  projectSnapshot: async () => ({ source: '', episodes: [], shots: [] }),
  applyDraft: () => ({ ok: true, summary: '' }),
}
const set = lib.createStageToolSet(adapter)
check('工具集没有 run_builtin', !set.byName.has('run_builtin'))
check('写工具仍是 submit_shots', set.submit?.name === 'submit_shots')
const tools = lib.bindSkillTools(set, [
  { skill: { id: 'fake', manifest: { tools: ['read_shots', 'submit_shots', 'run_builtin'] } }, mode: 'host' },
])
check(
  '技能里未实现的 run_builtin 被跳过',
  tools.map((t) => t.name).sort().join(',') === 'read_shots,read_skill,submit_shots',
  tools.map((t) => t.name).join(','),
)
const transcript = lib.threadTranscript([
  {
    id: 'm1',
    role: 'assistant',
    status: 'complete',
    parts: [
      {
        type: 'builtin',
        id: 'b1',
        actionKey: 'split_shots',
        label: '拆镜',
        scope: 'episode',
        status: 'done',
        result: { ok: true, action: 'split_shots', summary: '拆出 6 镜', counts: { shots: 6 } },
      },
    ],
  },
])
check('线程摘要包含内置动作', transcript.includes('[拆镜] 拆出 6 镜'), transcript)
check('线程摘要不含整份产物', !transcript.includes('镜头 6'), transcript)

// ---- 临时 dev server + mock provider：画布拆镜助手（镜头表已下线） ----
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()
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
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

const shots = Array.from({ length: 6 }, (_, i) => ({
  id: `E01-S0${i + 1}`,
  episode: 1,
  no: `S0${i + 1}`,
  scene_no: 1,
  scene_slug: 'SC01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `镜头 ${i + 1}`,
  dialogue: [],
  cast: [],
  keyframe_prompt: '',
  video_prompt: '',
}))
const SEED = {
  source: '雨夜，回收人接过一只义体手臂。',
  style: '近未来科幻写实',
  aspect: '16:9',
  episodes: [
    { no: 1, title: '雨夜', hook: '义体', scenes: [{ no: 1, slug: 'SC01', place: '夜市', time: '夜', beats: '回收人推车穿过夜市。', characters: ['陈默'], intensity: 7, tone: '压抑' }] },
    { no: 2, title: '仓库', hook: '新线索', scenes: [{ no: 1, slug: 'SC02', place: '仓库', time: '夜', beats: '仓库对峙。', characters: ['陈默'], intensity: 6, tone: '紧张' }] },
  ],
  characters: [
    { name: '陈默', role: '主角', look_cn: '瘦脸，短黑发，深色风衣', look_en: 'a lean man with short black hair, dark trench coat', palette: '暗红 + 铁灰', keywords: ['左眉疤'] },
  ],
  shots,
  designs: [],
}
const NAME_B = `${NAME}-b`
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(SEED),
})
await api(`/api/project?name=${encodeURIComponent(NAME_B)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME_B, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME_B)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...SEED,
    source: 'B 项目的雨夜。',
    shots: [{ ...shots[0], desc: 'B 项目镜头', keyframe_prompt: '', video_prompt: '' }],
  }),
})
const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-text'),
  { id: 'mock-text', label: 'Mock Text', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'mock-text'),
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock-text', model: 'mock-text' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text' }
settings.stageModels = { ...(settings.stageModels || {}), shot: 'mock-text' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let textCalls = 0
  await page.route('**/api/text', async (route) => {
    textCalls++
    let reply
    if (textCalls === 1) {
      reply = {
        text: '提交分镜草稿',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_shot',
            name: 'submit_shots',
            arguments: JSON.stringify({
              shots: [
                {
                  no: 'S01',
                  scene_no: 1,
                  scene_slug: 'SC01',
                  seconds: 3,
                  size: '中景',
                  move: '固定',
                  desc: 'A 项目写回',
                  dialogue: [],
                  cast: [],
                },
              ],
            }),
          },
        ],
      }
    } else {
      reply = { text: '动作完成', finishReason: 'stop', toolCalls: [] }
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, modelLabel: 'Mock Text', ...reply }),
      })
    } catch {
      /* 请求已被取消 */
    }
  })

  const shotNodes = () => page.locator('.react-flow__node').filter({ has: page.locator('.shot') })
  const nodeCount = () => shotNodes().count()
  const waitNodes = (n) =>
    page.waitForFunction(
      (want) => document.querySelectorAll('.react-flow__node .shot').length === want,
      n,
      { timeout: 30000 },
    )
  const openProject = async (name, want, episode = 1) => {
    // 经概览再进画布，避免同页切项目时 boardPhase 仍停在上一项目的 canvas
    await page.goto(`${APP}/#/p/${encodeURIComponent(name)}/overview`, { waitUntil: 'networkidle' })
    await page.goto(`${APP}/#/p/${encodeURIComponent(name)}/board`, { waitUntil: 'networkidle' })
    await page.locator(`[data-board-ep="${episode}"]`).click()
    await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 20000 })
    await waitNodes(want)
  }

  await openProject(NAME, 6)
  check('画布只显示当前项目镜头', (await nodeCount()) === 6, String(await nodeCount()))
  check('画布无拆镜助手', (await page.getByRole('button', { name: '拆镜助手', exact: true }).count()) === 0)
  check('画布无分镜聊天挂载', (await page.locator('[data-shots-chat]').count()) === 0)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-shots.png') })

  // 项目隔离：A/B 切换后画布只显示各自镜头
  await openProject(NAME_B, 1)
  check('切到 B 只剩 B 的镜头', (await nodeCount()) === 1, String(await nodeCount()))
  await openProject(NAME, 6)
  await page.waitForTimeout(800)
  const aAfter = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots
  const idsAfter = await shotNodes().evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
  check('切回 A 恢复 6 镜', (await nodeCount()) === 6, `${idsAfter.join(',')} | 项目 ${aAfter.map((s) => s.id).join(',')}`)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-isolation.png') })

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  console.log('textCalls', textCalls)
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)

