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
  '剧本/镜头/提示词动作范围',
  lib.WORKBENCH_BUILTINS.generate_episodes.scope === 'script' &&
    lib.WORKBENCH_BUILTINS.split_shots.scope === 'episode' &&
    lib.WORKBENCH_BUILTINS.generate_prompts.scope === 'episode',
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

  // 镜头表：空态动作、禁用原因、执行、按钮一致性
  await openView('镜头表', 'shots')
  const shotEmpty = await page.locator('[data-shots-chat] [data-chat-builtins]').innerText()
  check('镜头表空态有拆镜', shotEmpty.includes('拆镜'), shotEmpty.replace(/\n/g, ' | '))
  const brief = page.getByPlaceholder(/本集内容/)
  const briefValue = await brief.inputValue()
  await brief.fill('')
  await page.waitForTimeout(200)
  const disabledBtn = page.locator('[data-shots-chat] [data-chat-builtins] button', { hasText: '拆镜' })
  check('缺少 brief 时动作禁用', await disabledBtn.isDisabled())
  check(
    '禁用原因可读',
    String(await disabledBtn.getAttribute('title')).includes('先写本集内容'),
    String(await disabledBtn.getAttribute('title')),
  )
  await brief.fill(briefValue)
  await page.waitForTimeout(200)
  const longBrief = '过渡镜头内容。'.repeat(400)
  await brief.fill(longBrief)
  await page.waitForTimeout(200)

  active = 'shot'
  await runAction('shots', '拆镜')
  await waitReceipt('shots')
  const shotCards = await cardTexts('shots')
  check('镜头聊天动作生成回执', shotCards.some((t) => t.includes('拆出 6 镜')), shotCards.join(' / '))
  check(
    '大 brief 完整 inline 发送',
    String(lastTextBody?.prompt || '').includes('过渡镜头内容') &&
      String(lastTextBody?.prompt || '').length > 2500,
    `prompt ${String(lastTextBody?.prompt || '').length} 字`,
  )
  check('镜头表结果 6 镜', (await page.locator('table.wb-table tbody tr').count()) === 6)
  check('首轮后头部仍有内置动作入口', (await page.locator('[data-shots-chat] select[aria-label="运行内置动作"]').count()) === 1)

  // 顶部按钮走同一宿主，不新增聊天回执
  await page.getByRole('button', { name: '拆镜', exact: true }).click()
  await page.waitForTimeout(900)
  check('顶部按钮结果一致', (await page.locator('table.wb-table tbody tr').count()) === 6)
  check('顶部按钮不新增聊天回执', (await cardTexts('shots')).length === 1)
  await page.getByRole('button', { name: '保存到 project.json', exact: true }).click()
  await page.waitForTimeout(700)
  const savedShots = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots
  check('镜头动作结果可保存', (savedShots || []).length === 6)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-shots.png') })

  // 取消：运行中禁用发送/顶部按钮，取消后草稿不变
  delayMs = 4000
  await page.locator('[data-shots-chat] select[aria-label="运行内置动作"]').selectOption('split_shots')
  const shotStop = page.locator('[data-shots-chat] button', { hasText: '停止 拆镜' })
  await shotStop.waitFor({ timeout: 5000 })
  check('动作运行中顶部按钮禁用', await page.locator('.wb-genbtn').isDisabled())
  check('动作运行中聊天输入禁用', await page.getByLabel('shots 技能聊天输入').isDisabled())
  await shotStop.click()
  await page.waitForTimeout(900)
  const cancelledCard = (await cardTexts('shots')).at(-1) || ''
  check('取消回执显示已取消', cancelledCard.includes('已取消'), cancelledCard.slice(0, 160))
  check('取消后镜头草稿不变', (await page.locator('table.wb-table tbody tr').count()) === 6)
  delayMs = 0

  // 线程持久化：刷新后回执仍在
  await page.waitForTimeout(900)
  await openView('镜头表', 'shots')
  await page.waitForTimeout(1200)
  const restored = await cardTexts('shots')
  check('刷新后回执仍在', restored.length >= 2, `cards=${restored.length}`)
  check('刷新后保留动作摘要', restored.some((t) => t.includes('拆出 6 镜')), restored.join(' / ').slice(0, 200))

  // 剧本
  await openView('剧本', 'script')
  active = 'script'
  await runAction('script', '分集')
  await waitReceipt('script')
  check('剧本动作回执', (await cardTexts('script')).some((t) => t.includes('生成 2 集')))
  check('剧本草稿替换为 2 集', (await page.locator('.sb-ep').count()) === 2)
  check('剧本回执标明全剧', (await cardTexts('script')).some((t) => t.includes('全剧')))
  await page.getByRole('button', { name: /重新生成分集|生成分集/ }).first().click()
  await page.waitForTimeout(700)
  check('剧本顶部按钮结果一致', (await page.locator('.sb-ep').count()) === 2)
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

  // 提示词：分批 + 取消不落半份
  await openView('提示词', 'prompts')
  await page.locator('.wb-field', { hasText: '每批' }).locator('select').selectOption('3')
  active = 'prompt'
  await runAction('prompts', '生成提示词')
  await waitReceipt('prompts')
  const promptValues = await page.locator('table textarea').evaluateAll((els) => els.map((e) => e.value))
  check('提示词动作写入当前集', promptValues.includes('mock keyframe S01') && promptValues.includes('mock keyframe S06'), promptValues.slice(0, 6).join(' / '))
  check('提示词回执包含 2 批', (await cardTexts('prompts')).some((t) => t.includes('2/2 批')))
  check('提示词回执标明当前集', (await cardTexts('prompts')).some((t) => t.includes('当前集')))
  await page.getByRole('button', { name: '生成提示词', exact: true }).click()
  await page.waitForTimeout(1200)
  const topPromptValues = await page.locator('table textarea').evaluateAll((els) => els.map((e) => e.value))
  check('提示词顶部按钮结果一致', topPromptValues.includes('mock keyframe S01') && topPromptValues.includes('mock keyframe S06'))
  check('提示词顶部按钮不新增聊天回执', (await cardTexts('prompts')).length === 1)
  await page.getByRole('button', { name: '保存到 project.json', exact: true }).click()
  await page.waitForTimeout(700)
  const savedPrompts = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots
  check(
    '提示词动作结果可保存',
    (savedPrompts || []).some((s) => s.keyframe_prompt === 'mock keyframe S01'),
    (savedPrompts || []).slice(0, 2).map((s) => s.keyframe_prompt).join(' / '),
  )
  const beforeCancel = topPromptValues.slice()

  delayMs = 4000
  await page.locator('[data-prompts-chat] select[aria-label="运行内置动作"]').selectOption('generate_prompts')
  const promptStop = page.locator('[data-prompts-chat] button', { hasText: '停止 生成提示词' })
  await promptStop.waitFor({ timeout: 5000 })
  await promptStop.click()
  await page.waitForTimeout(900)
  const promptCancelCard = (await cardTexts('prompts')).at(-1) || ''
  check('分批提示词取消回执', promptCancelCard.includes('已取消'), promptCancelCard.slice(0, 160))
  const afterCancel = await page.locator('table textarea').evaluateAll((els) => els.map((e) => e.value))
  check('取消不落半份提示词', JSON.stringify(afterCancel) === JSON.stringify(beforeCancel))
  delayMs = 0
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-prompts.png') })

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
  projectVariant = 'B'
  active = 'shot'
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME_B)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.locator('[data-shots-chat]').waitFor({ timeout: 15000 })
  await page.getByLabel('shots 技能聊天输入').waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  await runAction('shots', '拆镜')
  await waitReceipt('shots')
  check('B 项目动作回执', (await cardTexts('shots')).some((t) => t.includes('拆出 2 镜')))
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(1800)
  const aCards = await cardTexts('shots')
  check(
    '切换项目不串回执',
    aCards.some((t) => t.includes('拆出 6 镜')) && !aCards.some((t) => t.includes('拆出 2 镜')),
    aCards.join(' / ').slice(0, 200),
  )
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-isolation.png') })

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  console.log('textCalls', textCalls)
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
