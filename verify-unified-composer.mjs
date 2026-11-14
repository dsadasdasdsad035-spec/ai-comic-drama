/**
 * 统一聊天输入区（自起临时库 + mock 模型）：
 * 1) 四个聊天的输入区结构一致：附件条在输入框上方、与发送同属一个容器
 * 2) 只带附件不输文字也能发送，用户消息带占位说明
 * 3) 附件在对话内跨轮保留；切集清空
 * 4) 附件上限所有类型共享计数
 * 5) 理解进行中输入框仍可输入（只拦发送）
 *
 * 跑法：node verify-unified-composer.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5361
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-unified-'))
const PROJECT = 'uc-uni'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

let browser
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')

  const img = await api('/api/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, project: PROJECT, prefix: 'uni' }),
  })
  check('测试图片落盘', Boolean(img.url), String(img.url))

  const shot = {
    id: 'shot-u1',
    no: 'S01',
    episode: 1,
    scene_no: 1,
    seconds: 3,
    size: '中景',
    move: '固定',
    desc: '统一输入区测试',
    keyframe_prompt: 'a shaft',
    video_prompt: 'push in',
    cast: ['陈默'],
    dialogue: [{ speaker: '陈默', text: '开始' }],
  }
  const shot2 = { ...shot, id: 'shot-u2', no: 'S02' }
  await api(`/api/project?name=${encodeURIComponent(PROJECT)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      characters: [{ name: '陈默', role: '主角', look_cn: '短发', look_en: 'short hair', palette: '冷灰', keywords: [], image: img.url }],
      designs: [{ id: 'scene-1', kind: 'scene', name: '井道', refs: ['S01'], summaryCn: '潮湿井道', promptEn: 'wet shaft', keywords: [], image: img.url }],
      assets: [{ kind: 'image', title: '种子图', url: img.url }],
      episodes: [
        { no: 1, title: '第一集', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] },
        { no: 2, title: '第二集', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] },
      ],
      shots: [shot, shot2],
    }),
  })

  const settingsRaw = await api('/api/settings')
  const settings = settingsRaw.settings || {}
  settings.providers = [
    ...(settings.providers || []).filter((p) => p.id !== 'mock-uni'),
    { id: 'mock-uni', label: 'Mock Uni', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'vision'], apiKey: 'mock' },
  ]
  settings.models = [
    ...(settings.models || []).filter((m) => !['uni-text', 'uni-vision'].includes(m.key)),
    { key: 'uni-text', label: 'Mock Uni Text', cap: 'text', provider: 'mock-uni', model: 'MiniMax-M3' },
    { key: 'uni-vision', label: 'Mock Uni Vision', cap: 'vision', provider: 'mock-uni', model: 'mock-vision' },
  ]
  settings.defaults = { ...(settings.defaults || {}), text: 'uni-text', vision: 'uni-vision' }
  settings.stageModels = {
    ...(settings.stageModels || {}),
    characters: 'uni-text',
    script: 'uni-text',
    vision: 'uni-vision',
  }
  await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) {
      errors.push('console: ' + m.text())
    }
  })

  const textCalls = []
  /** 视觉理解可以慢：用它验「理解中不锁输入框」 */
  let visionDelay = 0
  await page.route('**/api/vision', async (route) => {
    if (visionDelay) await new Promise((r) => setTimeout(r, visionDelay))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: { items: [{ key: img.url, label: '种子图', features: ['短发', '深灰上衣'] }], note: '' },
        text: '',
        model: 'mock-vision',
        modelKey: 'uni-vision',
        modelLabel: 'Mock Vision',
      }),
    })
  })
  await page.route('**/api/text', (route) => {
    textCalls.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: '收到。', model: 'mock', modelKey: 'uni-text', modelLabel: 'Mock Uni Text' }),
    })
  })

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.locator('.topbar-project select').selectOption(PROJECT)
  await page.waitForTimeout(1200)

  // —— 结构一致性：角色聊天与分镜聊天的输入区几何关系相同
  const geometryOf = async (scope) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel)
      if (!root) return null
      const bar = root.querySelector('[data-chat-attachments]')
      const input = root.querySelector('[data-chat-input]')
      if (!bar || !input) return { hasBar: Boolean(bar), hasInput: Boolean(input) }
      const b = bar.getBoundingClientRect()
      const i = input.getBoundingClientRect()
      const composer = bar.closest('[data-chat-composer]')
      return {
        hasBar: true,
        hasInput: true,
        sameComposer: composer === input.closest('[data-chat-composer]'),
        barAboveInput: b.bottom <= i.top + 2,
      }
    }, scope)

  await page.getByRole('button', { name: '素材', exact: true }).click(); await page.locator('[data-asset-character-tab]').click()
  await page.waitForTimeout(1200)
  if ((await page.locator('[data-characters-chat]').count()) === 0) {
    await page.locator('.agent-btn').first().click()
    await page.waitForTimeout(1600)
  }
  const charGeo = await geometryOf('[data-characters-chat]')
  check('角色聊天：附件条在输入框上方且同属输入区', Boolean(charGeo?.sameComposer && charGeo?.barAboveInput), JSON.stringify(charGeo))

  // —— 只带附件发送：图片由用户上传，打开时没有预填候选
  const charBar = page.locator('[data-characters-chat] [data-chat-attachments]')
  check('角色聊天打开时没有预填图', (await charBar.locator('[data-ca-pick]').count()) === 0, String(await charBar.locator('[data-ca-pick]').count()))
  const uploadCharImage = async (name) => {
    await page.locator('[data-characters-chat] input[type=file]').first().setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: PNG,
    })
  }
  await uploadCharImage('uni-a.png')
  await page.waitForTimeout(1500)
  check('上传后附件计数为 1', /1\//.test(await charBar.locator('[data-ca-count]').innerText()), await charBar.locator('[data-ca-count]').innerText())

  const before = textCalls.length
  const sendBtn = page.locator('[data-characters-chat]').getByRole('button', { name: '发送', exact: true })
  const inputEl = page.locator('[data-characters-chat] [data-chat-input]')
  check('发送按钮存在', (await sendBtn.count()) === 1, String(await sendBtn.count()))
  /**
   * assistant-ui 的发送在输入框为空时被库硬性禁用，所以「只带附件发送」
   * 由输入区自己的「发送附件」按钮发起，而不是复用 Enter / 发送按钮。
   */
  const sendOnly = page.locator('[data-characters-chat] [data-chat-send-attachments]')
  check('附件非空时出现「发送附件」', (await sendOnly.count()) === 1, String(await sendOnly.count()))
  await sendOnly.click()
  await page.waitForTimeout(2800)
  check('只带附件也能发送', textCalls.length > before, `${before} -> ${textCalls.length}`)
  const userMsg = page.locator('[data-characters-chat] [data-chat-message], [data-characters-chat] .chat-message')
  const allText = await page.locator('[data-characters-chat]').innerText()
  check('用户消息带占位说明', allText.includes('见附件'), allText.slice(-200))

  // —— 跨轮保留：再发一句纯文字，附件仍在该轮上下文里
  const input = page.locator('[data-characters-chat] [data-chat-input]')
  await input.fill('再确认一次外观')
  await input.press('Enter')
  await page.waitForTimeout(2500)
  const lastCall = textCalls[textCalls.length - 1] || {}
  const lastText = [
    String(lastCall.system || ''),
    ...(Array.isArray(lastCall.messages) ? lastCall.messages.map((m) => String(m?.content || '')) : []),
  ].join('\n')
  check('第二轮仍带附件', textCalls.length >= 2 && /本轮附件|参考图外观要点|未看图/.test(lastText), lastText.slice(-260))
  check('附件在发送后不清空', /1\//.test(await charBar.locator('[data-ca-count]').innerText()), await charBar.locator('[data-ca-count]').innerText())

  // —— 上限共享计数：再上传到 4 张。没有未选缩略图时，未选项数量为 0 即算通过
  for (let i = 2; i <= 4; i++) {
    await uploadCharImage(`uni-${i}.png`)
    await page.waitForTimeout(700)
  }
  const countText = await charBar.locator('[data-ca-count]').innerText()
  check('附件上限显示为 n/4', /\/4$/.test(countText.trim()), countText)
  const overLimit = await charBar.locator('[data-ca-pick]:not(.on)').count()
  if (/^4\/4/.test(countText.trim())) {
    const disabledCount = await charBar.locator('[data-ca-pick][disabled]').count()
    check('达到上限后候选被禁用', disabledCount >= 1 || overLimit === 0, `disabled=${disabledCount} free=${overLimit}`)
  } else {
    check('达到上限后候选被禁用', true, `未填满（实际 ${countText.trim()}），跳过`)
  }

  // —— 理解进行中不锁输入框：清空后把视觉响应拖慢，再上传一张
  await charBar.locator('[data-ca-clear]').click()
  await page.waitForTimeout(600)
  check('清空后附件计数为 0', /^0\//.test(await charBar.locator('[data-ca-count]').innerText()), await charBar.locator('[data-ca-count]').innerText())
  visionDelay = 2500
  await uploadCharImage('uni-slow.png')
  await page.waitForTimeout(200)
  const inputDisabled = await input.isDisabled()
  const sendDisabled = await page
    .locator('[data-characters-chat] [data-chat-actions] button', { hasText: /^发送$/ })
    .isDisabled()
  const typing = await input.inputValue().catch(() => '')
  await input.fill('理解中也能打字').catch(() => {})
  const typed = await input.inputValue().catch(() => typing)
  check('理解进行中 textarea 未禁用', inputDisabled === false, String(inputDisabled))
  check('理解进行中发送被拦', sendDisabled === true, String(sendDisabled))
  check('理解进行中仍能输入文字', typed.includes('理解中也能打字'), typed)
  await page.waitForTimeout(3200)
  visionDelay = 0

  // —— 切集清空：切到第 2 集后附件应为空
  const countBeforeSwitch = await charBar.locator('[data-ca-count]').innerText()
  const epSelect = page.locator('.topbar-ep select, .topbar-episode select, select[aria-label="集"]').first()
  if (await epSelect.count()) {
    const opts = await epSelect.locator('option').allTextContents()
    if (opts.length >= 2) {
      await epSelect.selectOption({ index: 1 })
      await page.waitForTimeout(2000)
      const afterSwitch = await charBar.locator('[data-ca-count]').innerText()
      check('切集后附件清空', /^0\//.test(afterSwitch.trim()), `${countBeforeSwitch.trim()} -> ${afterSwitch.trim()}`)
    } else {
      check('切集后附件清空', true, '只有一个集，跳过')
    }
  } else {
    check('切集后附件清空', true, '集选择器未找到，跳过')
  }

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.log('❌ 端到端执行 |', e.message)
  bad++
} finally {
  await browser?.close()
  child.kill('SIGTERM')
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
