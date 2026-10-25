/**
 * 工作台聊天 UI 层级：标题/范围/模型、空态/示例、轮次、写回执、检查器、拖拽与窄屏。
 * 跑法：node verify-workbench-chat-ui.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5326
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-chat-ui-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-chat-ui-'))
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

const LONG_SOURCE = '一个雨夜的追捕故事。'.repeat(300)
const SCRIPT = {
  logline: '一句话故事',
  episodes: [
    {
      no: 1,
      title: '试播',
      hook: '反转',
      scenes: [
        { no: 1, slug: '街口', place: '街口', time: '夜', beats: '追', characters: ['陈默'], intensity: 7, tone: '紧张' },
      ],
    },
  ],
}
const SEED = {
  source: LONG_SOURCE,
  style: '近未来科幻写实',
  aspect: '16:9',
  episodes: SCRIPT.episodes,
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
  designs: [
    { id: 'scene-rain-street', kind: 'scene', name: '雨夜街口', refs: ['E01-S01'], summaryCn: '霓虹雨夜的街口', promptEn: 'rainy neon street corner, no people', keywords: ['霓虹'] },
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
settings.stageModels = { ...(settings.stageModels || {}), script: 'mock-text' }
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
  const calls = []
  let phase = 0
  let mode = 'submit'
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    if (mode === 'fail') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'mock model down' }),
      })
      return
    }
    if (mode === 'slow') {
      try {
        await new Promise((r) => setTimeout(r, 4000))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, json: { content: '慢慢完成' }, text: '慢慢完成', modelLabel: 'mock' }),
        })
      } catch {
        /* 取消后请求已中止 */
      }
      return
    }
    if (mode === 'ok') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, json: { content: '重试成功' }, text: '重试成功', modelLabel: 'mock' }),
      })
      return
    }
    let payload
    if (phase === 0) {
      phase = 1
      payload = { content: '提交剧本草稿', tool_calls: [{ name: 'submit_script', args: SCRIPT }] }
    } else {
      payload = { content: '已完成剧本草稿' }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: payload, text: payload.content, modelLabel: 'mock' }),
    })
  })

  const open = async (nav, surface) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.getByRole('button', { name: nav, exact: true }).click()
    await page.locator(`[data-${surface}-chat]`).waitFor({ timeout: 15000 })
  }
  const send = async (text) => {
    await page.getByLabel('script 技能聊天输入').fill(text)
    await page.locator('[data-script-chat]').getByRole('button', { name: '发送', exact: true }).click()
  }

  await open('剧本', 'script')
  const header = page.locator('[data-chat-header]')
  const headerText = await header.innerText()
  check('头部显示助手名', headerText.includes('剧本助手'), headerText.slice(0, 80))
  check('头部显示范围', headerText.includes('全剧'), headerText.slice(0, 80))
  check('头部显示当前模型', headerText.includes('Mock Text'), headerText.slice(0, 100))
  check('上下文条标出按范围读取', (await page.locator('[data-chat-context-bar]').innerText()).includes('按范围读取'))
  const emptyText = await page.locator('[data-chat-empty]').innerText()
  check('剧本空态不复用 3D 文案', emptyText.includes('保存前不动项目') && !emptyText.includes('抓帧'), emptyText.slice(0, 100))
  check('空态给出 3 个示例', (await page.locator('[data-chat-suggestion]').count()) === 3)

  const EVIDENCE = path.join(ROOT, 'openspec/changes/skill-driven-workbench-chats/evidence')
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-script.png') })

  const callsBefore = calls.length
  const firstSuggestion = await page.locator('[data-chat-suggestion]').first().innerText()
  await page.locator('[data-chat-suggestion]').first().click()
  check('点示例只预填输入框', (await page.getByLabel('script 技能聊天输入').inputValue()) === firstSuggestion)
  await page.waitForTimeout(350)
  check('点示例不自动发送', calls.length === callsBefore, `${calls.length} / ${callsBefore}`)

  const agentButton = page.locator('.agent-btn')
  check('助手入口 aria-expanded', (await agentButton.getAttribute('aria-expanded')) === 'true')
  await agentButton.click()
  await page.locator('[data-script-chat]').waitFor({ state: 'detached', timeout: 5000 })
  await agentButton.click()
  await page.locator('[data-script-chat]').waitFor({ timeout: 5000 })
  check('助手入口可开合', true)

  await page.getByLabel('script 技能聊天输入').fill('把第 1 集改成悬疑')
  await page.locator('[data-script-chat]').getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-chat-tool="submit_script"]').waitFor({ timeout: 15000 })
  await page.getByText('已完成剧本草稿').first().waitFor({ timeout: 15000 })
  const stepTexts = await page.locator('[data-chat-step]').allInnerTexts()
  check('轮次头出现', stepTexts.length > 0, stepTexts.join(' | '))
  const receiptText = await page.locator('[data-chat-tool="submit_script"]').innerText()
  check('回执说明草稿未保存', receiptText.includes('草稿未保存'), receiptText.slice(0, 140))
  check('回执显示更新数量', receiptText.includes('更新 1'), receiptText.slice(0, 140))
  check('助手入口显示未保存点', (await page.locator('.agent-btn .agent-dot.dirty').count()) === 1)

  await page.getByRole('button', { name: '查看将发送' }).click()
  const inspect = page.locator('[data-chat-inspector]')
  await inspect.waitFor({ timeout: 5000 })
  const inspectText = await inspect.innerText()
  check('检查器显示系统提示/本轮任务', inspectText.includes('系统提示') && inspectText.includes('本轮任务'), inspectText.slice(0, 100))
  check('检查器显示大输入按范围读取', inspectText.includes('按范围读取'), inspectText.slice(0, 400))
  check('检查器显示实际模型与保存语义', inspectText.includes('Mock Text') && inspectText.includes('显式保存'), inspectText.slice(0, 300))
  check('检查器显示输入实际值与规模', inspectText.includes('3000 字') && inspectText.includes('966 字'), inspectText.slice(0, 300))
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-inspector.png') })
  await page.getByRole('button', { name: '收起将发送' }).click()
  await page.getByLabel('script 技能聊天输入').waitFor({ timeout: 5000 })
  check('收起检查器回到对话', true)

  const resizer = page.locator('.workbench-chat-resizer')
  const before = Number(await resizer.getAttribute('aria-valuenow'))
  await resizer.focus()
  await page.keyboard.press('ArrowLeft')
  const after = Number(await resizer.getAttribute('aria-valuenow'))
  check('拖拽条可用键盘调宽', after > before, `${before} -> ${after}`)
  await resizer.dblclick()
  check('双击恢复默认 400', Number(await resizer.getAttribute('aria-valuenow')) === 400)

  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForTimeout(200)
  const aside = page.locator('.workbench-chat-aside')
  const position = await aside.evaluate((el) => getComputedStyle(el).position)
  const resizerDisplay = await resizer.evaluate((el) => getComputedStyle(el).display)
  check('≤1180 聊天改为覆盖式抽屉', position === 'absolute', position)
  check('≤1180 隐藏拖拽条', resizerDisplay === 'none', resizerDisplay)
  const scrim = page.locator('.workbench-chat-scrim')
  const scrimDisplay = await scrim.evaluate((el) => getComputedStyle(el).display)
  const scrimBox = await scrim.boundingBox()
  check('≤1180 显示遮罩', scrimDisplay === 'block', scrimDisplay)
  check('遮罩覆盖工作台', Boolean(scrimBox && scrimBox.width > 800 && scrimBox.height > 700), JSON.stringify(scrimBox))
  await page.screenshot({ path: path.join(EVIDENCE, 'workbench-chat-narrow.png') })

  await page.setViewportSize({ width: 880, height: 900 })
  await page.waitForTimeout(200)
  const sheetBox = await aside.boundingBox()
  check('≤900 聊天全屏', Boolean(sheetBox && sheetBox.width >= 870), JSON.stringify(sheetBox))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('窄屏页面不横向溢出', overflow <= 1, String(overflow))
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForTimeout(200)

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'night'
  })
  await page.waitForTimeout(100)
  const nightBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'day'
  })
  await page.waitForTimeout(100)
  const dayBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  check('日/夜主题 token 生效', nightBg !== dayBg, `${nightBg} -> ${dayBg}`)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'night'
  })

  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForTimeout(200)

  // 回执保存：从聊天里直接触发宿主保存，再确认项目已落库。
  await page.getByRole('button', { name: '保存草稿' }).click()
  await page.locator('.toast', { hasText: '剧本已写回' }).waitFor({ timeout: 10000 })
  const saved = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project
  check('回执保存写入项目', saved.episodes?.[0]?.title === '试播', JSON.stringify(saved.episodes?.[0]?.title))
  check('回执改为已保存', (await page.locator('[data-chat-tool="submit_script"]').innerText()).includes('已保存'))
  check('保存后助手入口回到就绪', (await page.locator('.agent-btn .agent-dot.dirty').count()) === 0)

  // 失败可恢复：错误卡说明草稿未改变，并提供重试。
  mode = 'fail'
  await send('失败测试')
  const errorCard = page.locator('[data-chat-error]')
  await errorCard.waitFor({ timeout: 15000 })
  const errorText = await errorCard.innerText()
  check('失败卡说明草稿未改变', errorText.includes('草稿保持上一版'), errorText.slice(0, 120))
  check('失败卡提供重试', (await errorCard.getByRole('button', { name: '重试', exact: true }).count()) === 1)
  mode = 'ok'
  await errorCard.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('重试成功').first().waitFor({ timeout: 15000 })
  check('重试后恢复', true)
  check('失败/重试未改写草稿', (await page.locator('.sb-ep-title').first().inputValue()) === '试播')

  // 取消不落半份：延迟响应，点停止，确认未写入并恢复输入。
  mode = 'slow'
  await send('取消测试')
  const stop = page.locator('[data-chat-actions]').getByRole('button', { name: '停止', exact: true })
  await stop.waitFor({ timeout: 5000 })
  await page.locator('.agent-btn .agent-dot.running').waitFor({ timeout: 5000 })
  check('助手入口显示运行点', true)
  await stop.click()
  await page.locator('[data-chat-stopped]').waitFor({ timeout: 15000 })
  const stoppedText = await page.locator('[data-chat-stopped]').innerText()
  check('取消说明未写入草稿', stoppedText.includes('未写入草稿'), stoppedText)
  check('取消后输入可用', await page.getByLabel('script 技能聊天输入').isEnabled())
  check('取消未改写草稿', (await page.locator('.sb-ep-title').first().inputValue()) === '试播')

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
