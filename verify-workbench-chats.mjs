/**
 * 四个内容工作台的技能聊天：角色 / 素材 / 镜头表 / 提示词。
 * 覆盖宿主技能、submit 草稿、只读技能、按集线程。
 * 跑法：node verify-workbench-chats.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5325
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-chat-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-chat-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/skill-driven-workbench-chats/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
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

const SEED = {
  source: '一个雨夜的追捕故事。',
  style: '近未来科幻写实',
  aspect: '16:9',
  episodes: [
    {
      no: 1,
      title: '雨夜',
      hook: '反转',
      scenes: [{ no: 1, slug: '街口', place: '街口', time: '夜', beats: '追捕', characters: ['陈默'], intensity: 7, tone: '紧张' }],
    },
    { no: 2, title: '仓库', hook: '新线索', scenes: [{ no: 1, slug: '仓库', place: '仓库', time: '夜', beats: '对峙', characters: ['陈默'], intensity: 6, tone: '压抑' }] },
  ],
  characters: [
    {
      name: '陈默',
      role: '主角',
      age: '30 岁上下',
      look_cn: '男性，瘦脸，短黑发，深色风衣，左眉疤',
      look_en: 'a lean man with short black hair, dark trench coat, scar over left eyebrow',
      palette: '暗红 + 铁灰',
      keywords: ['左眉疤'],
    },
  ],
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      scene_no: 1,
      scene_slug: '街口',
      seconds: 3,
      size: '中景',
      move: '固定',
      desc: '雨夜街口',
      dialogue: [],
      cast: ['陈默'],
      keyframe_prompt: 'a man in a dark trench coat',
      video_prompt: 'camera pushes in',
    },
  ],
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

const PAYLOADS = {
  character: {
    characters: [
      {
        name: '林岚',
        role: '反派',
        age: '28 岁上下',
        look_cn: '女性，长发，银色义肢左手，黑色皮衣',
        look_en: 'a woman with long hair, silver prosthetic left hand, black leather jacket',
        palette: '银 + 黑',
        keywords: ['银色义肢'],
      },
    ],
  },
  asset: {
    scenes: [{ name: '雨夜街口', refs: ['E01-S01'], summary_cn: '霓虹雨夜的街口', prompt_en: 'rainy neon street corner, no people', keywords: ['霓虹'] }],
    props: [],
  },
  shot: {
    shots: [
      {
        no: 'S01',
        scene_no: 1,
        scene_slug: '街口',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '雨夜追捕 · 聊天',
        dialogue: [],
        cast: ['陈默'],
      },
    ],
  },
  prompt: {
    shots: [
      {
        no: 'S01',
        keyframe_prompt: '{{陈默}} runs through a neon rainy street, medium shot',
        video_prompt: 'camera pushes in as rain streaks across frame',
      },
    ],
  },
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = []
  const stageCalls = {}
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    const system = String(body.system || '')
    let stage = ''
    if (system.includes('角色设定师')) stage = 'character'
    else if (system.includes('场景与道具设定师')) stage = 'asset'
    else if (system.includes('你是分镜师')) stage = 'shot'
    else if (system.includes('AI 影像提示词工程师')) stage = 'prompt'
    let payload
    if (stage && !stageCalls[stage]) {
      stageCalls[stage] = 1
      payload = { content: `提交${stage}草稿`, tool_calls: [{ name: `submit_${stage === 'shot' ? 'shots' : stage === 'prompt' ? 'prompts' : stage === 'asset' ? 'designs' : 'characters'}`, args: PAYLOADS[stage] }] }
    } else {
      payload = { content: `${stage || 'chat'} 完成` }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: payload, text: payload.content, modelLabel: 'mock' }),
    })
  })

  const openView = async (nav, attr) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.getByRole('button', { name: nav, exact: true }).click()
    await page.locator(`[data-${attr}-chat]`).waitFor({ timeout: 15000 })
    await page.getByLabel(`${attr} 技能聊天输入`).waitFor({ timeout: 15000 })
  }
  const send = async (attr, text) => {
    const chat = page.locator(`[data-${attr}-chat]`)
    await chat.getByLabel(`${attr} 技能聊天输入`).fill(text)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
  }

  // 角色
  await openView('角色', 'characters')
  check('角色聊天宿主技能', (await page.locator('[data-characters-chat] .skill-chip.host').textContent())?.includes('character'))
  const charHeader = await page.locator('[data-characters-chat] [data-chat-header]').innerText()
  check('角色头部身份/范围/模型（范围为范围词，不重复集号）', charHeader.includes('角色助手') && charHeader.includes('本集') && charHeader.includes('Mock Text'), charHeader.slice(0, 120))
  const charEmpty = await page.locator('[data-characters-chat] [data-chat-empty]').innerText()
  check('角色空态属于本工作台', charEmpty.includes('只改角色草稿') && !charEmpty.includes('抓帧'), charEmpty.slice(0, 100))
  check('角色空态有三个示例', (await page.locator('[data-characters-chat] [data-chat-suggestion]').count()) === 3)
  const charPlaceholder = await page.getByLabel('characters 技能聊天输入').getAttribute('placeholder')
  check('角色 placeholder 属于本工作台', Boolean(charPlaceholder?.includes('lookEn') && !charPlaceholder.includes('第 3 集节奏')), charPlaceholder || '')
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-characters.png') })
  await send('characters', '把林岚拆出来')
  await page.locator('[data-chat-tool="submit_characters"]').waitFor({ timeout: 15000 })
  check('角色卡写入草稿', (await page.locator('.char-name', { hasText: '林岚' }).count()) > 0)
  check('已有角色未被覆盖', (await page.locator('.char-name', { hasText: '陈默' }).count()) > 0)

  // 素材
  await openView('素材', 'assets')
  check('素材聊天宿主技能', (await page.locator('[data-assets-chat] .skill-chip.host').textContent())?.includes('asset'))
  const assetHeader = await page.locator('[data-assets-chat] [data-chat-header]').innerText()
  check('素材头部身份/范围/模型', assetHeader.includes('素材助手') && assetHeader.includes('本集') && assetHeader.includes('Mock Text'), assetHeader.slice(0, 120))
  const assetEmpty = await page.locator('[data-assets-chat] [data-chat-empty]').innerText()
  check('素材空态属于本工作台', assetEmpty.includes('写入后立即保存') && !assetEmpty.includes('抓帧'), assetEmpty.slice(0, 100))
  check('素材空态有三个示例', (await page.locator('[data-assets-chat] [data-chat-suggestion]').count()) === 3)
  const assetPlaceholder = await page.getByLabel('assets 技能聊天输入').getAttribute('placeholder')
  check('素材 placeholder 属于本工作台', Boolean(assetPlaceholder?.includes('多角度') && !assetPlaceholder.includes('第 3 集节奏')), assetPlaceholder || '')
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-assets.png') })
  await send('assets', '拆场景和道具')
  await page.locator('[data-chat-tool="submit_designs"]').waitFor({ timeout: 15000 })
  check('素材卡写入草稿', (await page.getByText('雨夜街口').count()) > 0)
  const assetsPersisted = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.designs
  check('素材按现有语义即时落库', (assetsPersisted || []).some((d) => d.name === '雨夜街口'))

  // 镜头表 + 只读技能
  await openView('镜头表', 'shots')
  check('镜头表聊天宿主技能', (await page.locator('[data-shots-chat] .skill-chip.host').textContent())?.includes('shotlist'))
  const shotHeader = await page.locator('[data-shots-chat] [data-chat-header]').innerText()
  check('镜头表头部身份/范围/模型', shotHeader.includes('分镜助手') && shotHeader.includes('本集') && shotHeader.includes('Mock Text'), shotHeader.slice(0, 120))
  const shotEmpty = await page.locator('[data-shots-chat] [data-chat-empty]').innerText()
  check('镜头表空态属于本工作台', shotEmpty.includes('只改镜头草稿') && !shotEmpty.includes('抓帧'), shotEmpty.slice(0, 100))
  check('镜头表空态有三个示例', (await page.locator('[data-shots-chat] [data-chat-suggestion]').count()) === 3)
  const shotPlaceholder = await page.getByLabel('shots 技能聊天输入').getAttribute('placeholder')
  check('镜头表 placeholder 属于本工作台', Boolean(shotPlaceholder?.includes('12 个 3 秒') && !shotPlaceholder.includes('第 3 集节奏')), shotPlaceholder || '')
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-shots.png') })
  await send('shots', '把这一镜改成雨夜追捕')
  await page.locator('[data-chat-tool="submit_shots"]').waitFor({ timeout: 15000 })
  const descs = await page.locator('.wb-table textarea').evaluateAll((els) => els.map((e) => e.value))
  check('镜头草稿写入表格', descs.some((v) => v.includes('雨夜追捕 · 聊天')), descs.slice(0, 5).join(' | '))

  await page.locator('[data-shots-chat] select[aria-label="加载只读技能"]').selectOption('prompt')
  check('镜头表可加载只读提示词技能', (await page.locator('[data-shots-chat] .skill-chip.readonly').textContent())?.includes('prompt'))
  await send('shots', '用提示词技能看看这一镜')
  await page.getByText('shot 完成').first().waitFor({ timeout: 15000 })
  const readonlyCall = calls[calls.length - 1]
  check('只读技能进入 system', String(readonlyCall?.system || '').includes('【只读技能：prompt】'))
  check('只读技能不获得写工具', !String(readonlyCall?.system || '').includes('submit_prompts'))
  check('宿主写工具仍在', String(readonlyCall?.system || '').includes('submit_shots'))

  // 按集线程：切到 E02 是空线程，切回 E01 恢复
  await page.locator('.epbar-trigger').click()
  await page.locator('.epbar-tab', { hasText: 'E02' }).click()
  await page.waitForTimeout(900)
  const e02Panel = await page.locator('[data-shots-chat]').innerText()
  check('切集后旧线程不串', !e02Panel.includes('把这一镜改成雨夜追捕'), e02Panel.slice(0, 120))
  await send('shots', 'E02 的聊天')
  await page.getByText('shot 完成').first().waitFor({ timeout: 15000 })
  await page.locator('.epbar-trigger').click()
  await page.locator('.epbar-tab', { hasText: 'E01' }).click()
  await page.waitForTimeout(900)
  const e01Panel = await page.locator('[data-shots-chat]').innerText()
  check('切回原集恢复原线程', e01Panel.includes('把这一镜改成雨夜追捕'))
  check('切回原集恢复只读技能', (await page.locator('[data-shots-chat] .skill-chip.readonly').count()) > 0)

  // 提示词
  await openView('提示词', 'prompts')
  check('提示词聊天宿主技能', (await page.locator('[data-prompts-chat] .skill-chip.host').textContent())?.includes('prompt'))
  const promptHeader = await page.locator('[data-prompts-chat] [data-chat-header]').innerText()
  check('提示词头部身份/范围/模型', promptHeader.includes('提示词助手') && promptHeader.includes('本集') && promptHeader.includes('Mock Text'), promptHeader.slice(0, 120))
  const promptEmpty = await page.locator('[data-prompts-chat] [data-chat-empty]').innerText()
  check('提示词空态属于本工作台', promptEmpty.includes('只改提示词草稿') && !promptEmpty.includes('抓帧'), promptEmpty.slice(0, 100))
  check('提示词空态有三个示例', (await page.locator('[data-prompts-chat] [data-chat-suggestion]').count()) === 3)
  const promptPlaceholder = await page.getByLabel('prompts 技能聊天输入').getAttribute('placeholder')
  check('提示词 placeholder 属于本工作台', Boolean(promptPlaceholder?.includes('夜景霓虹') && !promptPlaceholder.includes('第 3 集节奏')), promptPlaceholder || '')
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-prompts.png') })
  await send('prompts', '给这一镜写提示词')
  await page.locator('[data-chat-tool="submit_prompts"]').waitFor({ timeout: 15000 })
  const promptValues = await page.locator('.pt-table textarea').evaluateAll((els) => els.map((e) => e.value))
  check('锚点占位符被展开', promptValues.some((v) => v.includes('scar over left eyebrow')), promptValues.slice(0, 3).join(' | '))
  check('提示词写入当前集', promptValues.some((v) => v.includes('neon rainy street')))

  await page.locator('[data-prompts-chat] select[aria-label="加载只读技能"]').selectOption('character')
  check('提示词表可加载只读角色技能', (await page.locator('[data-prompts-chat] .skill-chip.readonly').textContent())?.includes('character'))
  await send('prompts', '角色锚点够不够')
  await page.getByText('prompt 完成').first().waitFor({ timeout: 15000 })
  const promptReadonlyCall = calls[calls.length - 1]
  check('提示词只读技能进入 system', String(promptReadonlyCall?.system || '').includes('【只读技能：character】'))
  check('提示词只读技能无写工具', !String(promptReadonlyCall?.system || '').includes('submit_characters'))

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
