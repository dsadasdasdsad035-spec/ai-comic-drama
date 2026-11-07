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
})
const lib = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
)
check(
  '五个工作台的动作清单',
  Object.keys(lib.WORKBENCH_BUILTIN_KEYS).sort().join(',') ===
    'assets,characters,prompts,script,shots',
)
check(
  '角色、素材各有两个范围',
  lib.WORKBENCH_BUILTIN_KEYS.characters.length === 2 &&
    lib.WORKBENCH_BUILTIN_KEYS.assets.length === 2 &&
    lib.WORKBENCH_BUILTINS[lib.WORKBENCH_BUILTIN_KEYS.characters[1]].scope === 'script' &&
    lib.WORKBENCH_BUILTINS[lib.WORKBENCH_BUILTIN_KEYS.assets[1]].scope === 'script',
)
check(
  '剧本/镜头动作范围',
  lib.WORKBENCH_BUILTINS.generate_episodes.scope === 'script' &&
    lib.WORKBENCH_BUILTINS.split_shots.scope === 'episode' &&
    !('prompts' in lib.WORKBENCH_BUILTIN_KEYS),
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
  tools.map((t) => t.name).sort().join(',') === 'read_shots,submit_shots',
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

// ---- 临时 dev server + mock provider ----
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
  logline: '一只义体手臂牵出旧案。',
  episodes: [
    { no: 1, title: '雨夜', hook: '义体', scenes: [{ no: 1, slug: 'SC01', place: '夜市', time: '夜', beats: '回收人推车穿过夜市，摊主推过义体手臂，回收人低头端详。', characters: ['陈默'], intensity: 7, tone: '压抑' }] },
    { no: 2, title: '仓库', hook: '新线索', scenes: [{ no: 1, slug: 'SC02', place: '仓库', time: '夜', beats: '仓库对峙。', characters: ['陈默'], intensity: 6, tone: '紧张' }] },
  ],
  characters: [
    { name: '陈默', role: '主角', look_cn: '瘦脸，短黑发，深色风衣', look_en: 'a lean man with short black hair, dark trench coat', palette: '暗红 + 铁灰', keywords: ['左眉疤'] },
  ],
  shots,
  designs: [],
}
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
settings.stageModels = {
  ...(settings.stageModels || {}),
  script: 'mock-text',
  character: 'mock-text',
  asset: 'mock-text',
  shot: 'mock-text',
  prompt: 'mock-text',
}
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const shotPayload = {
  shots: shots.map((s) => ({
    no: s.no,
    scene_no: 1,
    scene_slug: 'SC01',
    seconds: 3,
    size: '中景',
    move: '固定',
    desc: s.desc,
    dialogue: [],
    cast: [],
  })),
}
const PAYLOADS = {
  script: {
    logline: '新的一版',
    episodes: [
      { no: 1, title: '新一集', hook: '钩子', scenes: [{ no: 1, slug: 'SC01', place: '夜市', time: '夜', beats: '改写后的第一集。', characters: ['陈默'], intensity: 7 }] },
      { no: 2, title: '新二集', hook: '反转', scenes: [{ no: 1, slug: 'SC02', place: '仓库', time: '夜', beats: '改写后的第二集。', characters: ['陈默'], intensity: 6 }] },
    ],
  },
  character: {
    characters: [
      { name: '林岚', role: '反派', look_cn: '长发，银色义肢左手，黑色皮衣', look_en: 'a woman with long hair, silver prosthetic left hand, black leather jacket', palette: '银 + 黑', keywords: ['银色义肢'] },
    ],
  },
  asset: {
    scenes: [{ name: '雨夜街口', refs: ['E01-S01'], summary_cn: '霓虹雨夜的街口', prompt_en: 'rainy neon street corner, no people', keywords: ['霓虹'] }],
    props: [],
  },
  shot: shotPayload,
  prompt: {
    shots: shots.map((s) => ({
      no: s.no,
      keyframe_prompt: `mock keyframe ${s.no}`,
      video_prompt: `mock video ${s.no}`,
    })),
  },
  shotB: {
    shots: [
      { no: 'S01', scene_no: 1, scene_slug: 'SC01', seconds: 3, size: '中景', move: '固定', desc: 'B 项目镜头 1', dialogue: [], cast: [] },
      { no: 'S02', scene_no: 1, scene_slug: 'SC01', seconds: 3, size: '中景', move: '固定', desc: 'B 项目镜头 2', dialogue: [], cast: [] },
    ],
  },
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let active = ''
  let delayMs = 0
  let textCalls = 0
  let projectVariant = 'A'
  let lastTextBody = null
  await page.route('**/api/text', async (route) => {
    textCalls++
    lastTextBody = route.request().postDataJSON()
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    const payload =
      active === 'shot' && projectVariant === 'B'
        ? PAYLOADS.shotB
        : PAYLOADS[active] || { content: 'ok' }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, json: payload, text: '', model: 'mock', modelKey: 'mock-text', modelLabel: 'Mock Text' }),
      })
    } catch {
      /* 请求已被取消 */
    }
  })

  const openView = async (nav, attr) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.getByRole('button', { name: nav, exact: true }).click()
    await page.locator(`[data-${attr}-chat]`).waitFor({ timeout: 15000 })
    await page.getByLabel(`${attr} 技能聊天输入`).waitFor({ timeout: 15000 })
  }
  const runAction = async (attr, label) => {
    await page.locator(`[data-${attr}-chat] [data-chat-builtins] button`, { hasText: label }).first().click()
  }
  const waitReceipt = async (attr, n = 1) => {
    await page.locator(`[data-${attr}-chat] [data-chat-builtin-receipt]`).nth(n - 1).waitFor({ timeout: 20000 })
  }
  const cardTexts = async (attr) =>
    page.locator(`[data-${attr}-chat] [data-chat-tool="builtin_action"]`).allInnerTexts()

  // 镜头表：chat-first，无页内梗概/拆镜与内置拆镜
  await openView('镜头表', 'shots')
  check('无页内梗概条', (await page.locator('.wb-gen').count()) === 0)
  check('主区无拆镜按钮', (await page.getByRole('button', { name: '拆镜', exact: true }).count()) === 0)
  check('镜头表无内置拆镜键', lib.WORKBENCH_BUILTIN_KEYS.shots.length === 0)
  const shotChatEmpty = await page.locator('[data-shots-chat] [data-chat-empty]').innerText()
  check('空态指向 Agent', /Agent|拆镜|镜头/.test(shotChatEmpty), shotChatEmpty.replace(/\n/g, ' ').slice(0, 120))
  check('Agent 面板默认可见', await page.locator('[data-shots-chat]').isVisible())
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-shots.png') })

  // 剧本
  await openView('剧本', 'script')
  active = 'script'
  await runAction('script', '分集')
  await waitReceipt('script')
  check('剧本动作回执', (await cardTexts('script')).some((t) => t.includes('生成 2 集')))
  check('剧本草稿替换为 2 集', (await page.locator('.sb-ep').count()) === 2)
  check('剧本回执标明全剧', (await cardTexts('script')).some((t) => t.includes('全剧')))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(700)
  const savedScript = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project
  check(
    '剧本动作结果可保存',
    (savedScript.episodes || []).some((e) => e.title === '新一集'),
    (savedScript.episodes || []).map((e) => e.title).join(','),
  )
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-script.png') })

  // 角色：全剧范围 + 本地草稿合并 + 自动落库
  await openView('角色', 'characters')
  await page.getByRole('button', { name: '+ 新建角色' }).click()
  await page.waitForTimeout(300)
  check('本地未保存角色已加入', (await page.locator('.char-name', { hasText: '新角色2' }).count()) > 0)
  active = 'character'
  await runAction('characters', '从全剧拆角色')
  await waitReceipt('characters')
  check('角色动作回执', (await cardTexts('characters')).some((t) => t.includes('拆出 1 个角色')))
  check('角色卡写入林岚', (await page.locator('.char-name', { hasText: '林岚' }).count()) > 0)
  check('角色卡保留陈默', (await page.locator('.char-name', { hasText: '陈默' }).count()) > 0)
  check('角色卡保留本地新角色', (await page.locator('.char-name', { hasText: '新角色2' }).count()) > 0)
  check('角色回执标明全剧', (await cardTexts('characters')).some((t) => t.includes('全剧')))
  await page.waitForTimeout(1600)
  const afterChar = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project
  check('角色约 1 秒后自动落库', (afterChar.characters || []).some((c) => c.name === '林岚'))
  check('本地新角色随整表落库', (afterChar.characters || []).some((c) => c.name === '新角色2'))
  await page.locator('button.btn-ghost', { hasText: '从本集拆角色' }).click()
  await page.waitForTimeout(1000)
  check('角色顶部按钮结果一致', (await page.locator('.char-name').count()) === 3)
  check('角色顶部按钮不新增聊天回执', (await cardTexts('characters')).length === 1)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-characters.png') })

  // 素材：全剧范围 + 立即落库
  await openView('素材', 'assets')
  active = 'asset'
  await runAction('assets', '从全剧拆')
  await waitReceipt('assets')
  check('素材动作回执', (await cardTexts('assets')).some((t) => t.includes('拆出 1 个素材')))
  check('素材卡写入雨夜街口', (await page.getByText('雨夜街口').count()) > 0)
  check('素材回执标明全剧', (await cardTexts('assets')).some((t) => t.includes('全剧')))
  const afterAsset = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project
  check('素材立即落库', (afterAsset.designs || []).some((d) => d.name === '雨夜街口'))
  // 无设定图时该按钮是强调样式（btn primary），有图才变 btn-ghost；按文案找才稳。
  // 上沿与板内各有一个同名按钮，取第一个（上沿）。
  await page.getByRole('button', { name: '从本集拆', exact: true }).first().click()
  await page.waitForTimeout(900)
  check('素材顶部按钮结果一致', (await page.getByText('雨夜街口').count()) > 0)
  check('素材顶部按钮不新增聊天回执', (await cardTexts('assets')).length === 1)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-assets.png') })

  check('镜头表无生成提示词顶栏按钮', (await page.getByRole('button', { name: '生成提示词', exact: true }).count()) === 0)

  // 项目隔离：A/B 各跑一次动作，切换后回执不串
  const NAME_B = `${NAME}-b`
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
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME_B)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.locator('[data-shots-chat]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  check('B 项目镜头表数据', (await page.locator('.wb-table').innerText()).includes('B 项目镜头'))
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(900)
  const aTable = await page.locator('.wb-table').innerText()
  check('切换回 A 不串 B 镜头', aTable.includes('回收人') && !aTable.includes('B 项目镜头 2'), aTable.slice(0, 120))
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-isolation.png') })

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  console.log('textCalls', textCalls)
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
