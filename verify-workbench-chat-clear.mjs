/**
 * 内容工作台聊天「清空对话」：入口、确认、持久化删除、下一轮不带旧历史、隔离、运行中取消。
 * 跑法：node verify-workbench-chat-clear.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5361
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-clear-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-clear-'))
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const MARKER = 'CLEAR_MARKER_OLD_TURN_XYZ'
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
const api = async (p, init) => {
  const res = await fetch(`${APP}${p}`, init)
  const j = await res.json().catch(() => ({}))
  return { ...j, status: res.status }
}

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

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: '一个雨夜的追捕故事。',
    style: '近未来科幻写实',
    episodes: [
      {
        no: 1,
        title: '雨夜',
        hook: '反转',
        scenes: [{ no: 1, slug: '街口', place: '街口', time: '夜', beats: '追捕', characters: ['陈默'], intensity: 7, tone: '紧张' }],
      },
      {
        no: 2,
        title: '仓库',
        hook: '新线索',
        scenes: [{ no: 1, slug: '仓库', place: '仓库', time: '夜', beats: '对峙', characters: ['陈默'], intensity: 6, tone: '压抑' }],
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
        desc: '原镜手改保留',
        dialogue: [],
        cast: ['陈默'],
        keyframe_prompt: '',
        video_prompt: '',
      },
      {
        id: 'E02-S01',
        episode: 2,
        no: 'S01',
        scene_no: 1,
        scene_slug: '仓库',
        seconds: 3,
        size: '近景',
        move: '固定',
        desc: '第二集原镜',
        dialogue: [],
        cast: ['陈默'],
        keyframe_prompt: '',
        video_prompt: '',
      },
    ],
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
settings.stageModels = {
  ...(settings.stageModels || {}),
  script: 'mock-text',
  character: 'mock-text',
  asset: 'mock-text',
  shot: 'mock-text',
  prompt: 'mock-text',
  publish: 'mock-text',
  creative: 'mock-text',
}
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const userMsg = (id, text) => ({
  id,
  role: 'user',
  status: 'complete',
  parts: [{ type: 'text', text }],
})
const asstMsg = (id, text) => ({
  id,
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text }],
})

const putThread = (surface, episode, messages) =>
  api('/api/chat-thread', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: NAME,
      surface,
      episode: episode || 0,
      shotId: '',
      messages,
      activeSkills: [],
    }),
  })

const getThread = async (surface, episode = 0) => {
  const q = new URLSearchParams({
    project: NAME,
    surface,
    episode: String(episode),
    shotId: '',
  })
  return api(`/api/chat-thread?${q}`)
}

const threadEmpty = (t) => !t.thread || !Array.isArray(t.thread.messages) || t.thread.messages.length === 0
const threadHas = (t, text) => JSON.stringify(t.thread || {}).includes(text)

await putThread('script', 0, [userMsg('s1', MARKER), asstMsg('s2', '旧剧本回复')])
await putThread('characters', 0, [userMsg('c1', '角色旧讨论'), asstMsg('c2', '角色旧回复')])
await putThread('assets', 0, [userMsg('a1', '素材旧讨论'), asstMsg('a2', '素材旧回复')])
await putThread('shots', 1, [userMsg('h1', '第1集镜头旧讨论'), asstMsg('h2', '第1集旧回复')])
await putThread('shots', 2, [userMsg('h3', '第2集镜头旧讨论'), asstMsg('h4', '第2集旧回复')])
await putThread('prompts', 1, [userMsg('p1', '提示词旧讨论'), asstMsg('p2', '提示词旧回复')])

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = []
  let delayMs = 0
  let failDelete = false
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, modelLabel: 'mock', text: '新一轮完成', finishReason: 'stop', toolCalls: [] }),
    })
  })

  const openView = async (nav, attr) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.waitForFunction(
      (n) => {
        const sel = document.querySelector('.topbar-project select')
        return sel && sel.value === n
      },
      NAME,
      { timeout: 15000 },
    )
    const epTrigger = page.locator('.epbar-trigger')
    if (await epTrigger.count()) {
      await epTrigger.click()
      const e01 = page.locator('.epbar-tab', { hasText: 'E01' })
      if (await e01.count()) await e01.click()
      else await page.keyboard.press('Escape').catch(() => {})
    }
    await page.getByRole('button', { name: nav, exact: true }).click()
    await page.locator(`[data-${attr}-chat]`).waitFor({ timeout: 15000 })
    await page.locator(`[data-${attr}-chat] [data-chat-clear]`).waitFor({ timeout: 20000 })
  }

  const chat = (attr) => page.locator(`[data-${attr}-chat]`)
  const clearBtn = (attr) => chat(attr).locator('[data-chat-clear]')
  const send = async (attr, text) => {
    await chat(attr).getByLabel(`${attr} 技能聊天输入`).fill(text)
    await chat(attr).getByRole('button', { name: '发送', exact: true }).click()
  }

  const surfaces = [
    ['剧本', 'script'],
    ['角色', 'characters'],
    ['素材', 'assets'],
    ['镜头表', 'shots'],
    ['提示词', 'prompts'],
  ]

  for (const [nav, attr] of surfaces) {
    await openView(nav, attr)
    check(`${nav} 有清空入口`, (await clearBtn(attr).count()) === 1)
  }

  await openView('剧本', 'script')
  await page.getByText(MARKER).first().waitFor({ timeout: 10000 })
  check('空线程时不清空：当前有消息所以可点', await clearBtn('script').isEnabled())

  page.once('dialog', (d) => d.dismiss())
  await clearBtn('script').click()
  await page.waitForTimeout(400)
  check('取消确认后旧消息仍在', (await chat('script').innerText()).includes(MARKER))
  check('取消确认后线程未删', threadHas(await getThread('script'), MARKER))

  await page.route('**/api/chat-thread*', async (route) => {
    if (failDelete && route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: '模拟清空失败' }),
      })
      return
    }
    await route.continue()
  })
  failDelete = true
  page.once('dialog', (d) => d.accept())
  await clearBtn('script').click()
  await page.waitForTimeout(700)
  check('DELETE 失败后旧消息仍在', (await chat('script').innerText()).includes(MARKER))
  check('DELETE 失败后仍可再点清空', await clearBtn('script').isEnabled())
  failDelete = false

  page.once('dialog', (d) => d.accept())
  await clearBtn('script').click()
  await chat('script').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  check('清空后剧本空态', (await chat('script').locator('[data-chat-empty]').count()) > 0)
  check('清空后入口禁用', await clearBtn('script').isDisabled())
  check('清空后 GET 剧本线程为空', threadEmpty(await getThread('script')))
  check('角色线程未动', threadHas(await getThread('characters'), '角色旧讨论'))
  check('素材线程未动', threadHas(await getThread('assets'), '素材旧讨论'))

  await chat('script').getByRole('button', { name: '关闭助手' }).click()
  await page.getByRole('button', { name: '打开助手' }).click()
  await chat('script').waitFor({ timeout: 10000 })
  await chat('script').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  check('关闭再打开仍无旧标记', !(await chat('script').innerText()).includes(MARKER))
  check('关闭再打开 GET 仍空', threadEmpty(await getThread('script')))

  const beforeSend = calls.length
  await send('script', '全新指令不要带旧讨论')
  await page.getByText('新一轮完成').first().waitFor({ timeout: 15000 })
  const after = calls.slice(beforeSend)
  const dumped = JSON.stringify(after)
  check('下一轮请求不含旧会话标记', after.length > 0 && !dumped.includes(MARKER), dumped.slice(0, 180))
  check('下一轮请求不含旧助手回复', !dumped.includes('旧剧本回复'))

  await openView('镜头表', 'shots')
  await page.getByText('第1集镜头旧讨论').first().waitFor({ timeout: 10000 })
  const shotCell = page.locator('.wb-table textarea').first()
  await shotCell.fill('未保存手改保留')
  page.once('dialog', (d) => d.accept())
  await clearBtn('shots').click()
  await chat('shots').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  check('镜头表第1集线程已空', threadEmpty(await getThread('shots', 1)))
  check('镜头表第2集线程未动', threadHas(await getThread('shots', 2), '第2集镜头旧讨论'))
  check('镜头表草稿手改仍在', (await shotCell.inputValue()) === '未保存手改保留')

  await page.locator('.epbar-trigger').click()
  await page.locator('.epbar-tab', { hasText: 'E02' }).click()
  await page.waitForTimeout(900)
  check('切到第2集仍能看到旧讨论', (await chat('shots').innerText()).includes('第2集镜头旧讨论'))

  const putP = await putThread('prompts', 1, [userMsg('p1', '提示词旧讨论'), asstMsg('p2', '提示词旧回复')])
  const gotP = await getThread('prompts', 1)
  check('提示词线程已写入', threadHas(gotP, '提示词旧讨论'), JSON.stringify({ put: putP.ok, got: gotP.thread?.messages }).slice(0, 240))
  await openView('提示词', 'prompts')
  await chat('prompts').locator('[data-chat-header]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const promptPanel = await chat('prompts').innerText()
  if (!promptPanel.includes('提示词旧讨论')) {
    check('提示词聊天恢复旧讨论', false, promptPanel.slice(0, 240))
  } else {
    check('提示词聊天恢复旧讨论', true)
  }
  page.once('dialog', (d) => d.accept())
  await clearBtn('prompts').click()
  await chat('prompts').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  check('提示词线程已空', threadEmpty(await getThread('prompts', 1)))
  check('提示词清空不串镜头表第2集', threadHas(await getThread('shots', 2), '第2集镜头旧讨论'))

  await openView('角色', 'characters')
  await page.getByText('角色旧讨论').first().waitFor({ timeout: 10000 })
  const ro = chat('characters').locator('select[aria-label="加载只读技能"]')
  if ((await ro.count()) > 0) {
    const opts = await ro.locator('option').evaluateAll((els) => els.map((e) => e.value).filter(Boolean))
    if (opts.includes('script')) await ro.selectOption('script')
    else if (opts[0]) await ro.selectOption(opts[0])
  }
  await page.waitForTimeout(300)
  const hadReadonly = (await chat('characters').locator('.skill-chip.readonly').count()) > 0
  await chat('characters').locator('input[type=file]').first().setInputFiles({
    name: 'clear-a.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await page.waitForTimeout(700)
  check('清空前有附件', /[1-9]\/\d/.test(await chat('characters').locator('[data-ca-count]').innerText()))
  page.once('dialog', (d) => d.accept())
  await clearBtn('characters').click()
  await chat('characters').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  check('清空后只读技能消失', (await chat('characters').locator('.skill-chip.readonly').count()) === 0, hadReadonly ? '' : '未加载到只读技能')
  const countAfter = await chat('characters').locator('[data-ca-count]').innerText().catch(() => '0/4')
  check('清空后附件计数归零', /^0\//.test(countAfter), countAfter)
  check('宿主技能仍在', (await chat('characters').locator('.skill-chip.host').textContent())?.includes('character'))
  check('模型标签仍在', (await chat('characters').locator('[data-chat-header]').innerText()).includes('Mock Text'))

  await openView('剧本', 'script')
  await clearBtn('script').waitFor({ timeout: 10000 })
  delayMs = 6000
  const runningSend = send('script', '慢请求用来清空')
  await page.locator('[data-script-chat]').getByText('正在改').first().waitFor({ timeout: 8000 })
  page.once('dialog', (d) => d.accept())
  await clearBtn('script').click()
  await chat('script').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  await runningSend.catch(() => {})
  await page.waitForTimeout(delayMs + 800)
  delayMs = 0
  check('生成中清空后 GET 仍空', threadEmpty(await getThread('script')))
  check('生成中清空后界面无半截旧文', !(await chat('script').innerText()).includes('慢请求用来清空'))

  await openView('镜头表', 'shots')
  const descBefore = await page.locator('.wb-table textarea').first().inputValue().catch(() => '')
  delayMs = 6000
  const shotsRunningSend = send('shots', '慢请求用来清空镜头表')
  await page.locator('[data-shots-chat]').getByText('正在改').first().waitFor({ timeout: 8000 })
  page.once('dialog', (d) => d.accept())
  await clearBtn('shots').click()
  await chat('shots').locator('[data-chat-empty]').waitFor({ timeout: 10000 })
  await shotsRunningSend.catch(() => {})
  await page.waitForTimeout(delayMs + 800)
  delayMs = 0
  check('分镜生成中清空后线程空', threadEmpty(await getThread('shots', 1)))
  check('分镜生成中清空不改镜头草稿', (await page.locator('.wb-table textarea').first().inputValue().catch(() => '')) === descBefore)

  await page.getByRole('button', { name: '发布' }).first().click()
  await page.waitForTimeout(1200)
  check('发布聊天没有清空入口', (await page.locator('[data-publish-chat] [data-chat-clear]').count()) === 0)

  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-header]').waitFor({ timeout: 15000 })
  check('创意头部没有清空对话', !(await page.locator('[data-creative-header]').innerText()).includes('清空对话'))
  check('创意页没有 data-chat-clear', (await page.locator('[data-chat-clear]').count()) === 0)

  check(
    '3D 聊天壳没有清空入口',
    !fs.readFileSync(path.join(ROOT, 'src/agent/SceneAgentChat.tsx'), 'utf8').includes('data-chat-clear'),
  )

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
