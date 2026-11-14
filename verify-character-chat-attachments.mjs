/**
 * 角色聊天「用户自己加图 → 看图写锚点 → 点按钮出三视图」端到端（自起临时库，mock 模型）：
 * 1) 不选角色也有附件栏；打开时不预填项目图或角色参考图
 * 2) 图片只由上传加入，可单张移除、全部清空；点另一张角色卡不替换已添加的图
 * 3) 加入图片后不请求 /api/vision，输入框保持可输入
 * 4) 发送后同一条用户消息带上图片块；清空后再发送则该条消息不含这些图
 * 5) 打开「从素材选」后取消，附件不变
 * 6) 回执出现「用它生成三视图」按钮与价格；点击前不产生 /api/seedream 请求
 * 7) 点击后请求带 cap:'view'、n:2、refImages = 该角色参考图，且不含聊天附件
 * 8) 去掉视觉模型后仍可发送，输入框不被锁住
 *
 * 跑法：node verify-character-chat-attachments.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5321
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-chat-attach-'))
const PROJECT = 'char-chat'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'image' ? `[image ${part.mimeType || ''}]` : String(part?.text || '')))
    .join('\n')
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
  for (let i = 0; i < 80; i++) {
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

  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '角色聊天附件验证' }),
  })
  // 两张真实存在的参考图（写进项目媒体目录，前端能 fetch 到才能拼板）
  const mkImg = async (name, color) => {
    const r = await api('/api/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
        project: PROJECT,
        prefix: name,
      }),
    })
    return r.url
  }
  const refA1 = await mkImg('ref-a1')
  const refA2 = await mkImg('ref-a2')
  const refB1 = await mkImg('ref-b1')
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodes: [{ no: 1, title: '第一集', scenes: [{ no: 1, slug: '客厅', beats: '猫在沙发上' }] }],
      shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '客厅里有猫', dialogue: [], cast: [] }],
      characters: [
        {
          name: '甲角色',
          role: '主角',
          look_cn: '短发',
          look_en: 'short black hair, grey jacket',
          palette: '灰',
          keywords: ['短发'],
          reference_images: [refA1, refA2],
        },
        { name: '乙角色', role: '配角', look_cn: '长发', look_en: 'long hair, red coat', palette: '红', keywords: [], reference_images: [refB1] },
      ],
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('dialog', (d) => d.accept())
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))

  const visionCalls = []
  const seedCalls = []
  await page.route('**/api/vision', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    visionCalls.push(body)
    const json = {
      items: [{ key: (body.prompt.match(/- ([^\s—]+) —/) || [])[1] || 'unknown', features: ['黑色短发', '深灰夹克'] }],
      conflicts: [],
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json, text: JSON.stringify(json), model: 'mock-v', modelKey: 'mock-vision', modelLabel: 'MockVision' }),
    })
  })
  // 文本模型：第一轮返回原生工具调用（聊天只认原生 tool calls），之后纯文本收尾
  const textCalls = []
  await page.route('**/api/text', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    textCalls.push(body)
    const payload = {
      characters: [
        { name: '甲角色', role: '主角', look_cn: '短发深灰夹克', look_en: 'short black hair, dark grey jacket, silver watch', update: true },
      ],
    }
    const firstCall = textCalls.length === 1
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        text: firstCall ? '已按参考图更新甲角色的外观锚点。' : '甲角色的外观锚点已更新完成。',
        model: 'mock',
        modelKey: 'mock-text',
        modelLabel: 'MockText',
        ...(firstCall
          ? {
              toolCalls: [
                {
                  id: `call-${textCalls.length}`,
                  name: 'submit_characters',
                  arguments: JSON.stringify(payload),
                },
              ],
            }
          : {}),
      }),
    })
  })
  await page.route('**/api/seedream', async (route) => {
    seedCalls.push(JSON.parse(route.request().postData() || '{}'))
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"/>')}`
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, urls: [url], url }) })
  })

  const settingsNow = await api('/api/settings')
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stageModels: {
        ...(settingsNow.settings?.stageModels || {}),
        character: 'apimart-text-gemini-3-5-flash',
      },
    }),
  })

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.locator('.topbar-project select').selectOption(PROJECT)
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '素材', exact: true }).click(); await page.locator('[data-asset-character-tab]').click()
  await page.waitForTimeout(1500)
  check('角色卡出现', (await page.locator('.char-card').count()) === 2, String(await page.locator('.char-card').count()))

  // 打开聊天：附件入口不依赖任何角色选择
  if ((await page.locator('[data-characters-chat]').count()) === 0) {
    await page.locator('.agent-btn').first().click()
    await page.waitForTimeout(1600)
  }
  check('角色聊天打开', (await page.locator('[data-characters-chat]').count()) === 1)
  const bar = page.locator('[data-chat-attachments]')
  check('不选角色也有附件栏', (await bar.count()) === 1)
  check('附件栏有上传入口', (await bar.locator('[data-ca-upload]').count()) === 1)
  check('附件栏有「从项目选」入口', (await bar.locator('[data-ca-pick-project]').count()) === 1)
  check('卡片没有「当前角色」标记', (await page.locator('.char-card.is-current').count()) === 0)
  // 项目里已有图、角色卡已有参考图，打开时都不得出现在附件条
  check('打开时没有预填图', (await bar.locator('[data-ca-pick]').count()) === 0, String(await bar.locator('[data-ca-pick]').count()))
  const openedText = await bar.innerText()
  check('预填不含项目图或角色参考图', !/ref-a1|ref-a2|ref-b1/.test(openedText), openedText.slice(0, 160))
  check('计数显示 0/4', /0\/4/.test(await bar.locator('[data-ca-count]').innerText()), await bar.locator('[data-ca-count]').innerText())

  const countBeforeCancel = await bar.locator('[data-ca-count]').innerText()
  await bar.locator('[data-ca-pick-project]').click()
  await page.waitForTimeout(600)
  check('素材选择器打开', (await page.locator('.mp-dialog').count()) === 1)
  await page.locator('.mp-dialog').getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(400)
  check('取消后选择器关闭', (await page.locator('.mp-dialog').count()) === 0)
  check(
    '取消选择不改变附件',
    (await bar.locator('[data-ca-count]').innerText()) === countBeforeCancel && (await bar.locator('[data-ca-pick]').count()) === 0,
    await bar.locator('[data-ca-count]').innerText(),
  )

  const uploadChatImage = async (name) => {
    await page.locator('[data-characters-chat] input[type=file]').first().setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: PNG,
    })
  }

  await uploadChatImage('chat-a.png')
  await page.waitForTimeout(600)
  check('计数变为 1/4', /1\/4/.test(await bar.locator('[data-ca-count]').innerText()), await bar.locator('[data-ca-count]').innerText())
  check('加入图片不请求视觉理解', visionCalls.length === 0, String(visionCalls.length))
  const chatInput = page.locator('[data-characters-chat]').getByLabel('characters 技能聊天输入')
  check('加入图片后输入框可输入', !(await chatInput.isDisabled()))

  // 再上传一张：仍然不走视觉理解
  await uploadChatImage('chat-b.png')
  await page.waitForTimeout(600)
  check('第二张图也不请求视觉理解', visionCalls.length === 0, String(visionCalls.length))

  // 移除一张 → 计数变化
  await bar.locator('[data-ca-pick].on').first().click()
  await page.waitForTimeout(1200)
  check('移除后计数回到 1/4', /1\/4/.test(await bar.locator('[data-ca-count]').innerText()), await bar.locator('[data-ca-count]').innerText())

  await page.locator('[data-characters-chat] input[type=file]').first().setInputFiles({
    name: 'chat-big.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 0x89),
  })
  await page.waitForTimeout(2500)
  check('超限图计入附件', /2\/4/.test(await bar.locator('[data-ca-count]').innerText()), await bar.locator('[data-ca-count]').innerText())

  // 发送：核对接力文本里带参考图要点
  const input = page.locator('[data-characters-chat]').getByLabel('characters 技能聊天输入')
  await input.fill('按这张确认甲角色的外观')
  await page.locator('[data-characters-chat]').getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForTimeout(2500)
  check('发送后调用了文本模型', textCalls.length >= 1, String(textCalls.length))
  const userMessage = (textCalls[0]?.messages || []).find((m) => m?.role === 'user')
  const sentPrompt = messageText(userMessage?.content)
  const imagePart = Array.isArray(userMessage?.content)
    ? userMessage.content.find((part) => part?.type === 'image')
    : null
  check('同一条消息带有图片块', Boolean(imagePart?.data) && String(imagePart.mimeType).startsWith('image/'), sentPrompt.slice(0, 180))
  check('超限图在消息里是占位', sentPrompt.includes('单张超过 4MB'), sentPrompt.slice(0, 240))
  check('图片块不是外观摘要', !sentPrompt.includes('【参考图外观要点】') && !/黑色短发|深灰夹克/.test(sentPrompt), sentPrompt.slice(0, 180))
  const cardText = async () =>
    page.locator('[data-chat-image-context]').evaluate((el) => el.textContent || '')
  const shown = await cardText()
  check('上下文卡写明已送出', shown.includes('已作为图片送出'), shown.slice(0, 240))
  check('上下文卡写明超限占位', shown.includes('单张超过 4MB'), shown.slice(0, 240))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('.topbar-project select').selectOption(PROJECT)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '素材', exact: true }).click(); await page.locator('[data-asset-character-tab]').click()
  await page.waitForTimeout(1200)
  if ((await page.locator('[data-characters-chat]').count()) === 0) {
    await page.locator('.agent-btn').first().click()
    await page.waitForTimeout(1200)
  }
  await page.locator('[data-chat-image-context]').waitFor({ timeout: 8000 })
  const restored = await cardText()
  check('刷新后仍能看到图片处置', restored.includes('已作为图片送出') && restored.includes('单张超过 4MB'), restored.slice(0, 240))

  // 回执按钮：点击前不应有 seedream 请求
  const renderBtn = page.locator('[data-chat-render-turnaround]')
  check('回执出现出图按钮', (await renderBtn.count()) >= 1)
  check('按钮显示价格', /¥/.test(await renderBtn.first().innerText()), await renderBtn.first().innerText())
  check('点击前没有生图请求', seedCalls.length === 0, String(seedCalls.length))

  console.log('DEBUG 按钮可点 =', await renderBtn.first().isEnabled())
  await renderBtn.first().click({ force: true })
  await page.waitForTimeout(600)
  console.log('DEBUG 点击后可见提示 =', JSON.stringify((await page.locator('[data-characters-chat]').innerText()).slice(-160)))
  await page.waitForTimeout(2500)
  check('点击后产生生图请求', seedCalls.length === 1, String(seedCalls.length))
  const seed = seedCalls[0] || {}
  check('生图走 view 能力', seed.cap === 'view', String(seed.cap))
  check('生成两张候选', seed.n === 2, String(seed.n))
  // 甲角色有两张参考图，出图时应全部作为身份输入提交（上限 4 张）
  check('参考图随请求提交', Array.isArray(seed.refImages) && seed.refImages.length === 2, JSON.stringify(seed.refImages))
  check('提交的正是该角色的参考图', (seed.refImages || []).every((u) => String(u).includes('/char-chat/ref-a')), JSON.stringify(seed.refImages))
  // 核心语义：聊天里用过的图是过程产物，不得透传进出图请求
  const chatUsed = await page.evaluate(() => {
    const el = document.querySelector('[data-chat-attachments]')
    return [...(el?.querySelectorAll('[data-ca-pick].on') || [])].map((x) => x.getAttribute('data-ca-pick'))
  })
  check('出图请求不含聊天附件', (seed.refImages || []).every((u) => !String(u).includes('/chat-ref-') && !String(u).includes('/ref-b')), JSON.stringify({ refImages: seed.refImages, chatUsed }))
  check('提示词用锚点+三视图尾巴', /short black hair/.test(String(seed.prompt)) && /character turnaround sheet/.test(String(seed.prompt)), String(seed.prompt).slice(0, 120))

  // 点击角色卡不再影响附件：附件属于本轮对话，与选中谁无关
  const countBefore = await page.locator('[data-ca-count]').innerText()
  const cardB = page.locator('[data-char-card="乙角色"]')
  await cardB.locator('.char-sheet').click({ position: { x: 20, y: 20 } }).catch(() => {})
  await page.waitForTimeout(1200)
  check('点卡片不改变附件', (await page.locator('[data-ca-count]').innerText()) === countBefore, `${countBefore} -> ${await page.locator('[data-ca-count]').innerText()}`)
  check('点卡片不切会话', (await page.locator('[data-characters-chat]').count()) === 1)
  check('点卡片不出现当前角色标记', (await page.locator('.char-card.is-current').count()) === 0)
  check('页面无脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // ---------------------------------------------------------------- 聊天上传的图不写角色、不进后续出图
  {
    const beforeRefs = await page.evaluate(async (proj) => {
      const j = await fetch(`/api/project?name=${encodeURIComponent(proj)}`).then((r) => r.json())
      const c = (j.project?.characters || []).find((x) => x.name === '甲角色')
      return (c?.reference_images || []).length
    }, PROJECT)
    const bar3 = page.locator('[data-chat-attachments]')
    // 上传 input 在聊天面板里（附件栏只放按钮）
    await page.locator('[data-characters-chat] input[type=file]').first().setInputFiles({
      name: 'chat-upload.png',
      mimeType: 'image/png',
      buffer: PNG,
    })
    await page.waitForTimeout(2200)
    const afterRefs = await page.evaluate(async (proj) => {
      const j = await fetch(`/api/project?name=${encodeURIComponent(proj)}`).then((r) => r.json())
      const c = (j.project?.characters || []).find((x) => x.name === '甲角色')
      return (c?.reference_images || []).length
    }, PROJECT)
    check('聊天上传不写角色参考图', afterRefs === beforeRefs, `${beforeRefs} -> ${afterRefs}`)
    const usedKeys = await page.evaluate(() => {
      const el = document.querySelector('[data-chat-attachments]')
      return [...(el?.querySelectorAll('[data-ca-pick].on') || [])].map((x) => x.getAttribute('data-ca-pick'))
    })
    check('上传的图确实进了本轮附件', usedKeys.some((k) => String(k).includes('chat-ref-')), JSON.stringify(usedKeys))
  }

  // ---------------------------------------------------------------- 清空后，下一条消息不再带这些图
  {
    const barClear = page.locator('[data-chat-attachments]')
    await barClear.locator('[data-ca-clear]').click()
    await page.waitForTimeout(800)
    check('清空后计数为 0', /^0\//.test(await barClear.locator('[data-ca-count]').innerText()), await barClear.locator('[data-ca-count]').innerText())
    check('清空后没有已选图', (await barClear.locator('[data-ca-pick].on').count()) === 0)
    const beforeClearSend = textCalls.length
    const clearInput = page.locator('[data-characters-chat]').getByLabel('characters 技能聊天输入')
    await clearInput.fill('附件已经清空')
    await clearInput.press('Enter')
    await page.waitForTimeout(2500)
    check('清空后仍能发送', textCalls.length > beforeClearSend, `${beforeClearSend} -> ${textCalls.length}`)
    const cleared = textCalls[textCalls.length - 1] || {}
    const clearedMsgs = Array.isArray(cleared.messages) ? cleared.messages : []
    const lastUser = [...clearedMsgs].reverse().find((m) => m?.role === 'user')
    const lastUserText = messageText(lastUser?.content)
    check(
      '清空后发送不含该图',
      lastUserText.includes('附件已经清空') && !/【本轮附件】|chat-ref-|黑色短发|深灰夹克/.test(lastUserText),
      lastUserText.slice(-220),
    )
  }

  // ---------------------------------------------------------------- 降级：未配置视觉模型
  // 把设置里的 vision 默认清空，重新载入页面后再加一张图
  const beforeSettings = await api('/api/settings')
  const origDefaultVision = beforeSettings.settings?.defaults?.vision || ''
  const origStageVision = beforeSettings.settings?.stageModels?.vision || ''
  const stripVision = (list) =>
    (list || []).map((m) => {
      const isVision = (m.caps || []).includes('vision') || m.cap === 'vision'
      if (!isVision) return m
      const caps = Array.isArray(m.caps) ? m.caps.filter((c) => c !== 'vision') : []
      return { ...m, caps: caps.length ? caps : ['text'], cap: 'text' }
    })
  // 设置只有 PUT，POST 会被 405 拒掉（实测踩到）
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defaults: { ...(beforeSettings.settings?.defaults || {}), vision: '' },
      stageModels: { ...(beforeSettings.settings?.stageModels || {}), vision: '' },
      models: stripVision(beforeSettings.settings?.models),
    }),
  })
  try {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    await page.locator('.topbar-project select').selectOption(PROJECT)
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: '素材', exact: true }).click(); await page.locator('[data-asset-character-tab]').click()
    await page.waitForTimeout(1400)
    if ((await page.locator('[data-characters-chat]').count()) === 0) {
      await page.locator('.agent-btn').first().click()
      await page.waitForTimeout(1400)
    }
    await page.locator('[data-char-card="乙角色"] .char-sheet').click({ position: { x: 20, y: 20 } }).catch(() => {})
    await page.waitForTimeout(1000)
    const bar2 = page.locator('[data-chat-attachments]')
    check('降级：附件栏仍出现', (await bar2.count()) === 1)
    check('降级：重新打开没有预填图', (await bar2.locator('[data-ca-pick]').count()) === 0)
    await page.locator('[data-characters-chat] input[type=file]').first().setInputFiles({
      name: 'chat-degrade.png',
      mimeType: 'image/png',
      buffer: PNG,
    })
    await page.waitForTimeout(1800)
    check('降级：计数仍增加', /1\/4/.test(await bar2.locator('[data-ca-count]').innerText()), await bar2.locator('[data-ca-count]').innerText())
    const afterSettingsSave = await api('/api/settings')
    const visionLeft = (afterSettingsSave.settings?.models || []).filter((m) =>
      (m.caps || []).includes('vision') || m.cap === 'vision',
    )
    console.log('DEBUG 仍有 vision 模型 =', JSON.stringify(visionLeft.map((m) => m.key)))
    console.log('DEBUG default vision =', afterSettingsSave.settings?.defaults?.vision, '| stage vision =', afterSettingsSave.settings?.stageModels?.vision)
    console.log('DEBUG bar 文本 =', JSON.stringify((await bar2.innerText()).slice(0, 160)))
    check('降级：输入框可输入', !(await page.locator('[data-characters-chat]').getByLabel('characters 技能聊天输入').isDisabled()))
    check('降级：没有视觉理解请求', visionCalls.length === 0, String(visionCalls.length))
    const sendBtn = page.locator('[data-characters-chat]').getByRole('button', { name: '发送', exact: true })
    // 等降级结果落定再判断（effect 是异步的）
    await page.waitForTimeout(2500)
    console.log('DEBUG 发送按钮数 =', await sendBtn.count(), '| disabled =', await sendBtn.first().isDisabled().catch(() => 'n/a'))
    console.log('DEBUG 仍在理解中 =', (await page.locator('[data-chat-attachments] .ca-badge.busy').count()))
    console.log('DEBUG 助理状态 =', JSON.stringify((await page.locator('[data-characters-chat]').innerText()).slice(0, 200)))
    // 降级后仍必须能发消息：填内容再确认发送键可用（空输入时禁用是正常行为）
    await page.locator('[data-characters-chat]').getByLabel('characters 技能聊天输入').fill('按这张确认乙角色的外观')
    await page.waitForTimeout(900)
    check('降级：输入后发送按钮可用', !(await sendBtn.first().isDisabled()))
  } finally {
    // 还原设置，避免影响后续脚本
    await api('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaults: { ...(beforeSettings.settings?.defaults || {}), vision: origDefaultVision },
        stageModels: { ...(beforeSettings.settings?.stageModels || {}), vision: origStageVision },
        models: beforeSettings.settings?.models || [],
      }),
    }).catch(() => {})
  }
} catch (e) {
  check('端到端执行', false, e.message)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
  process.exit(bad === 0 ? 0 : 1)
}
