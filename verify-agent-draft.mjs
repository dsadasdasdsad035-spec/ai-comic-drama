/**
 * 长代码草稿 Playwright 验收：分片 begin/append → commit → 只读预览 → 真实试运行 →
 * 试运行通过后工作台代码更新 → 取消清理草稿。
 * 需要 dev server 与本机 Blender：
 *   APP_URL=http://127.0.0.1:5274 node verify-agent-draft.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5274'
const NAME = `verify-agent-draft-${Date.now()}`
const evidence = 'openspec/changes/agent-scene-draft/evidence'
fs.mkdirSync(evidence, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()

const health = await api('/api/blender/health')
if (!health.ok) {
  console.log(`⏭ 跳过：本机 Blender 不可用（${health.message}）`)
  process.exit(0)
}
console.log(`Blender ${health.version} · ${health.path}`)

const MARKER = '# AGENT_DRAFT_MARKER'
const SOURCE = `${MARKER}\n${fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.py'), 'utf8').trim()}`
const lines = SOURCE.split('\n')
const GROUP = Math.ceil(lines.length / 4)
const chunks = []
for (let i = 0; i < lines.length; i += GROUP) {
  chunks.push(lines.slice(i, i + GROUP).join('\n') + (i + GROUP < lines.length ? '\n' : ''))
}
console.log(`草稿 ${lines.length} 行，分 ${chunks.length} 片写入`)

const img = await api('/api/save-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  }),
})
check('测试图片落盘', img.ok && typeof img.url === 'string', JSON.stringify(img))

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    characters: [
      {
        name: '陈默',
        role: '主角',
        look_cn: '短发',
        look_en: 'short hair',
        palette: '冷灰',
        keywords: [],
        image: img.url,
      },
    ],
    designs: [
      {
        id: 'scene-1',
        kind: 'scene',
        name: '井道',
        refs: ['S01'],
        summaryCn: '潮湿井道',
        promptEn: 'wet shaft',
        keywords: [],
        image: img.url,
      },
    ],
    episodes: [{ no: 1, title: '测试', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: '井道',
        seconds: 3,
        size: '中景',
        move: '推',
        cast: ['陈默'],
        dialogue: '陈默：别动',
        keyframe_prompt: '陈默站在井道门口，冷光',
        video_prompt: '镜头缓慢推近',
        keyframe: img.url,
      },
    ],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'draft-mock'),
  {
    id: 'draft-mock',
    label: 'Draft Mock',
    kind: 'openai',
    baseUrl: 'https://mock.invalid',
    caps: ['text', 'vision'],
    apiKey: 'mock',
  },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'draft-code' && m.key !== 'draft-vision'),
  { key: 'draft-code', label: 'Draft Code', cap: 'text', provider: 'draft-mock', model: 'draft-code' },
  { key: 'draft-vision', label: 'Draft Vision', cap: 'vision', provider: 'draft-mock', model: 'draft-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'draft-code', vision: 'draft-vision' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'draft-code', vision: 'draft-vision' }

const firstScript = [
  { name: 'get_shot_context', args: {} },
  { name: 'begin_scene_draft', args: {} },
  ...chunks.map((chunk) => ({ name: 'append_scene_draft', args: { chunk } })),
  { name: 'read_scene_draft', args: { startLine: 1, endLine: 3 } },
  { name: 'patch_scene_draft', args: { startLine: 1, endLine: 2, text: '# AGENT_DRAFT_MARKER_PATCHED' } },
  { name: 'commit_scene_draft', args: {} },
  { name: 'run_render', args: {} },
]
const failureScript = [
  { name: 'get_shot_context', args: {} },
  { name: 'begin_scene_draft', args: {} },
  { name: 'append_scene_draft', args: { chunk: 'not python at all' } },
  { name: 'commit_scene_draft', args: {} },
]
let script = firstScript
let callIndex = 0
let releaseStall = () => {}
let activeStall = new Promise((resolve) => {
  releaseStall = resolve
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const textPosts = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag|ERR_ABORTED/i.test(m.text())) {
    errors.push('console: ' + m.text())
  }
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, settings, db: 'mock' }),
    })
  }
  return route.continue()
})
await page.route('**/api/vision', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { summary: '主体可见', items: [{ label: '主体可见', ok: true }] },
      text: '',
      model: 'draft-vision',
      modelKey: 'draft-vision',
      modelLabel: 'Draft Vision',
    }),
  }),
)
await page.route('**/api/text', async (route) => {
  textPosts.push(JSON.parse(route.request().postData() || '{}'))
  const call = script[callIndex++]
  if (!call) {
    // 试运行/提交失败后暂停模型调用，让测试观察 UI 后再取消。
    await activeStall
    try {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          json: { content: '等待下一步', tool_calls: [] },
          text: '',
          model: 'draft-code',
          modelKey: 'draft-code',
          modelLabel: 'Draft Code',
        }),
      })
    } catch {
      /* 取消后请求已中止 */
    }
    return
  }
  // 给 commit 卡片一个可观察窗口，再进入真实渲染试运行。
  if (call.name === 'run_render') await new Promise((r) => setTimeout(r, 1500))
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { content: '', tool_calls: [call] },
      text: '',
      model: 'draft-code',
      modelKey: 'draft-code',
      modelLabel: 'Draft Code',
    }),
  })
})

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(600)
  const nodeId = await page.evaluate((name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  }, NAME)
  check('镜头进入画布', Boolean(nodeId), String(nodeId))
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    const opt = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
  }, nodeId)
  await page.waitForTimeout(300)
  await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.locator('.cw-shell').waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)

  const input = page.locator('[data-chat-input]')
  await input.waitFor({ timeout: 10000 })
  await input.fill('用草稿分片写一个完整场景，然后试运行')
  await page.getByRole('button', { name: '发送', exact: true }).click()

  const draftCard = page.locator('[data-chat-draft]').last()
  await draftCard.waitFor({ timeout: 30000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-chat-draft]')].some((el) => el.textContent?.includes('已提交，待试运行')),
    null,
    { timeout: 30000 },
  )
  await page.waitForTimeout(200)
  const cardText = await draftCard.innerText()
  check('草稿卡显示提交状态', /已提交，待试运行|已生效/.test(cardText), cardText.slice(0, 200))
  check('草稿卡显示行数', /\d+ 行/.test(cardText), cardText.slice(0, 120))

  const assistantText = await page.locator('[data-chat-message="assistant"]').last().innerText()
  check('聊天默认不展示整份代码', !assistantText.includes(MARKER))

  await draftCard.getByRole('button', { name: '查看草稿' }).click()
  await page.waitForFunction(
    (marker) =>
      [...document.querySelectorAll('[data-chat-draft] pre')].some((el) => el.textContent?.includes(marker)),
    MARKER,
    { timeout: 10000 },
  )
  const preview = await draftCard.locator('pre').innerText()
  check('只读预览包含完整草稿', preview.includes(MARKER) && preview.includes('def build'), preview.slice(0, 80))
  check('预览标注未试运行', (await draftCard.innerText()).includes('只读预览 · 未试运行'))
  check(
    '预览没有保存/运行按钮',
    (await draftCard.getByRole('button', { name: '保存' }).count()) === 0 &&
      (await draftCard.getByRole('button', { name: '运行' }).count()) === 0,
  )
  await page.locator('.cw-shell').screenshot({ path: `${evidence}/draft-preview.png` })

  const shotId = await page.evaluate((name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.data?.shotId
  }, NAME)
  const draftFile = path.join(process.cwd(), '.scene-drafts', NAME, shotId || 'E01-S01', 'draft.py')
  check('草稿文件落在固定目录', fs.existsSync(draftFile), draftFile)
  const fileText = fs.existsSync(draftFile) ? fs.readFileSync(draftFile, 'utf8') : ''
  check('草稿文件包含完整分片', fileText.includes(MARKER) && fileText.includes('def build') && fileText.includes('def dispose'))

  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-chat-draft]')].some((el) => el.textContent?.includes('已生效')),
    null,
    { timeout: 180000 },
  )
  check('试运行通过后草稿卡已生效', (await draftCard.innerText()).includes('已生效'), (await draftCard.innerText()).slice(0, 160))
  await page.locator('.cw-shell').screenshot({ path: `${evidence}/draft-trial-passed.png` })

  await page.getByRole('button', { name: '代码', exact: true }).click()
  await page.waitForTimeout(300)
  const codeValue = await page.locator('.cw-code').inputValue()
  check('工作台代码页签显示试运行通过的草稿', codeValue.includes(MARKER) && codeValue.includes('def build'))
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await page.waitForTimeout(300)
  check('切换页签后草稿卡仍在', await draftCard.isVisible())

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(600)
  releaseStall()
  for (let i = 0; i < 20 && fs.existsSync(draftFile); i++) await page.waitForTimeout(200)
  check('取消后草稿文件被清理', !fs.existsSync(draftFile), draftFile)
  check('取消后草稿卡保留已生效状态', (await draftCard.innerText()).includes('已生效'))

  // 第二轮：提交坏草稿，卡片显示失败原因，工作台仍保留上一版已生效代码。
  script = failureScript
  callIndex = 0
  activeStall = new Promise((resolve) => {
    releaseStall = resolve
  })
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await input.fill('再提交一个坏草稿，验证旧代码保留')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('[data-chat-draft]')]
      return cards.length >= 2 && Boolean(cards[cards.length - 1]?.textContent?.includes('失败'))
    },
    null,
    { timeout: 30000 },
  )
  const failureCard = page.locator('[data-chat-draft]').last()
  const failureText = await failureCard.innerText()
  check('失败草稿卡显示失败原因', failureText.includes('代码必须定义 build'), failureText.slice(0, 220))
  await page.getByRole('button', { name: '代码', exact: true }).click()
  await page.waitForTimeout(300)
  const codeAfterFailure = await page.locator('.cw-code').inputValue()
  check('提交失败不改工作台代码', codeAfterFailure.includes(MARKER) && codeAfterFailure.includes('def build'))
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(500)
  releaseStall()
  for (let i = 0; i < 20 && fs.existsSync(draftFile); i++) await page.waitForTimeout(200)
  check('失败后取消也清理草稿', !fs.existsSync(draftFile), draftFile)

  check('页面无未处理错误', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
  check(
    '工具调用来自草案序列',
    [...firstScript, ...failureScript].every((c) => c.name !== 'set_scene_code'),
  )
} finally {
  releaseStall()
  try {
    await browser.close()
  } catch {
    /* ignore */
  }
}

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n场景草稿 Playwright 验收通过')
