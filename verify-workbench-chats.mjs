/**
 * 画布拆镜助手的技能聊天：宿主技能、submit 写回即落库、只读技能、按集线程。
 * 镜头表已下线，分镜 Agent 挂在画布右侧；这里按画布入口验收。
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

/**
 * 原生工具调用把 system 放进 messages、把工具声明放进 tools；
 * 断言统一走这两个取值器，避免依赖已经移除的顶层 system 字段。
 */
const systemOf = (call) =>
  (Array.isArray(call?.messages) ? call.messages : [])
    .filter((m) => m.role === 'system')
    .map((m) => String(m.content || ''))
    .join('\n') + String(call?.system || '')
const toolNamesOf = (call) =>
  (Array.isArray(call?.tools) ? call.tools : []).map((t) => String(t?.function?.name || ''))

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

const SHOT_PAYLOAD = {
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
    {
      no: 'S02',
      scene_no: 1,
      scene_slug: '街口',
      seconds: 3,
      size: '近景',
      move: '推',
      desc: '雨夜追捕 · 新增',
      dialogue: [],
      cast: ['陈默'],
    },
  ],
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = []
  let shotCalls = 0
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    // 分镜宿主第一轮写回草稿，后续轮走纯文本
    let reply
    if (shotCalls === 0) {
      shotCalls = 1
      reply = {
        text: '提交分镜草稿',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_shot', name: 'submit_shots', arguments: JSON.stringify(SHOT_PAYLOAD) }],
      }
    } else {
      reply = { text: '分镜完成', finishReason: 'stop', toolCalls: [] }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, modelLabel: 'mock', ...reply }),
    })
  })

  // 画布是默认视图；分镜助理由上下文带的「拆镜助手」打开
  const openCanvas = async () => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.waitForFunction((n) => {
      const sel = document.querySelector('.topbar-project select')
      return sel && sel.value === n
    }, NAME, { timeout: 15000 })
    await page.getByRole('button', { name: '拆镜助手', exact: true }).click()
    await page.locator('[data-shots-chat]').waitFor({ timeout: 15000 })
    // 拆镜面是 compact 空态（不铺引导文案），等输入框可用即视为技能已加载
    await page.getByLabel('shots 技能聊天输入').waitFor({ timeout: 20000 })
  }
  const send = async (text) => {
    const chat = page.locator('[data-shots-chat]')
    await chat.getByLabel('shots 技能聊天输入').fill(text)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
  }

  await openCanvas()
  check('画布挂载分镜助手宿主技能', (await page.locator('[data-shots-chat] .skill-chip.host').textContent())?.includes('shotlist'))
  const shotHeader = await page.locator('[data-shots-chat] [data-chat-header]').innerText()
  check('分镜头部身份/范围/模型', shotHeader.includes('拆镜') && shotHeader.includes('第 1 集') && shotHeader.includes('mock-text'), shotHeader.slice(0, 120))
  const shotPlaceholder = await page.getByLabel('shots 技能聊天输入').getAttribute('placeholder')
  check('分镜 placeholder 属于本工作台', Boolean(shotPlaceholder?.includes('按场次拆镜') && !shotPlaceholder.includes('第 3 集节奏')), shotPlaceholder || '')
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-shots.png') })
  await send('把这一镜改成雨夜追捕')
  await page.locator('[data-chat-tool="submit_shots"]').waitFor({ timeout: 15000 })
  const persisted = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots
  check('分镜草稿写回即落库', persisted.some((s) => s.id === 'E01-S01' && s.desc.includes('雨夜追捕 · 聊天')), persisted.map((s) => s.desc).join(' | '))
  check('新增镜头也落库', persisted.some((s) => s.id === 'E01-S02'), persisted.map((s) => s.id).join(','))
  // 落库后会重新水合：画布卡片数跟着本集镜头数走
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node-shot').length === 2,
    undefined,
    { timeout: 15000 },
  )
  check('画布同步水合出写回结果', (await page.locator('.react-flow__node-shot').count()) === 2)

  await page.locator('[data-shots-chat] select[aria-label="加载只读技能"]').selectOption('prompt')
  check('分镜助手可加载只读提示词技能', (await page.locator('[data-shots-chat] .skill-chip.readonly').textContent())?.includes('prompt'))
  const callsBeforeReadonly = calls.length
  await send('用提示词技能看看这一镜')
  await page.getByText('分镜完成').first().waitFor({ timeout: 15000 })
  for (let i = 0; i < 40 && calls.length <= callsBeforeReadonly; i++) await page.waitForTimeout(100)
  const readonlyCall = calls[calls.length - 1]
  check('只读技能进入 system', systemOf(readonlyCall).includes('已挂只读技能：prompt'), systemOf(readonlyCall).slice(0, 200))
  check('只读技能不获得写工具', !toolNamesOf(readonlyCall).includes('submit_prompts'), toolNamesOf(readonlyCall).join(','))
  check('宿主写工具仍在', toolNamesOf(readonlyCall).includes('submit_shots'), toolNamesOf(readonlyCall).join(','))

  // 按集线程：切到 E02 是空线程，切回 E01 恢复
  await page.locator('.epbar-trigger').click()
  await page.locator('.epbar-tab', { hasText: 'E02' }).click()
  await page.waitForTimeout(900)
  const e02Panel = await page.locator('[data-shots-chat]').innerText()
  check('切集后旧线程不串', !e02Panel.includes('把这一镜改成雨夜追捕'), e02Panel.slice(0, 120))
  await send('E02 的聊天')
  await page.getByText('分镜完成').first().waitFor({ timeout: 15000 })
  await page.locator('.epbar-trigger').click()
  await page.locator('.epbar-tab', { hasText: 'E01' }).click()
  await page.waitForTimeout(900)
  const e01Panel = await page.locator('[data-shots-chat]').innerText()
  check('切回原集恢复原线程', e01Panel.includes('把这一镜改成雨夜追捕'))
  check('切回原集恢复只读技能', (await page.locator('[data-shots-chat] .skill-chip.readonly').count()) > 0)

  check('顶栏无独立提示词视图', (await page.getByRole('button', { name: '提示词', exact: true }).count()) === 0)
  const chatText = await page.locator('[data-shots-chat]').innerText()
  check('写回回执说明已落库', chatText.includes('已保存到项目'), chatText.slice(0, 120))

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
