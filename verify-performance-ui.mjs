/**
 * 表演 UI 回归：镜头表编辑/保存/重载、手改保护、Inspector 表演区、
 * 口型面板模式与多说话人禁用；不调用外部口型或 TTS。
 * 跑法：node verify-performance-ui.mjs（自起临时 dev server）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5341
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/shot-performance-direction/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const project = {
  name: 'perf-e2e',
  aspect: '16:9',
  style: '近未来科幻写实',
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 3,
      size: '中景',
      move: '固定',
      desc: '陈默压住桌沿，林岚后退',
      dialogue: [
        { speaker: '陈默', text: '你来了。' },
        { speaker: '林岚', text: '我不该来。' },
      ],
      dialogue_delivery: [
        { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft' },
        { emotion: 'fearful', intensity: 3 },
      ],
      performance: [
        { character: '陈默', emotion: 'angry', intensity: 4, action: '压住桌沿', gaze: '林岚', speaks: true },
        { character: '林岚', emotion: 'fearful', intensity: 3, action: '后退半步', speaks: true },
      ],
      cast: ['陈默', '林岚'],
      keyframe_prompt: '{{陈默}} 与 {{林岚}} 对峙',
      video_prompt: '陈默说话，林岚后退',
      handEdited: ['performance'],
    },
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 2,
      size: '特写',
      move: '固定',
      desc: '空镜',
      dialogue: [],
      performance: [],
      cast: [],
      handEdited: [],
    },
  ],
  characters: [
    { name: '陈默', role: '主角', look_cn: '寸头', look_en: 'buzz cut, grey coat', palette: '灰', keywords: ['寸头'] },
    { name: '林岚', role: '配角', look_cn: '短发', look_en: 'short hair, black coat', palette: '黑', keywords: ['短发'] },
  ],
  assets: [],
  designs: [],
  episodes: [{ no: 1, title: 'E1' }],
  sceneLayouts: [],
}
const state = { project: structuredClone(project) }
let lipSyncCalls = 0
let projectPosts = 0
let noProjects = false
let promptBody = null

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
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

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    projectPosts++
    const body = req.postDataJSON() || {}
    for (const shot of body.shots || []) {
      const old = state.project.shots.find((x) => x.id === shot.id)
      if (old) Object.assign(old, shot)
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: state.project.shots, characters: state.project.characters }),
    })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, project: state.project }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      root: '/mock',
      projects: noProjects ? [] : [{ name: state.project.name, title: state.project.name, shots: 2 }],
    }),
  })
})
await page.route('**/api/text', async (route) => {
  promptBody = route.request().postDataJSON()
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json: { shots: [{ no: 'S01', keyframe_prompt: 'mock keyframe', video_prompt: 'mock video' }] }, text: '', model: 'mock', modelKey: 'mock', modelLabel: 'Mock' }),
  })
})
await page.route('**/api/lipsync**', async (route) => {
  lipSyncCalls++
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'UI test 不应调用外部口型' }) })
})

const openShots = async () => {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.locator('table.wb-table').waitFor({ timeout: 15000 })
}

try {
  await openShots()
  check('镜头表 2 镜', (await page.locator('table.wb-table tbody tr').count()) >= 2)
  check('表演摘要显示两个角色', (await page.locator('.perf-summary').first().innerText()).includes('陈默'))
  check('表演摘要显示林岚', (await page.locator('.perf-summary').first().innerText()).includes('林岚'))

  await page.locator('.perf-cell button', { hasText: '编辑' }).first().click()
  await page.locator('.perf-expanded').waitFor()
  check('表演编辑器有角色行', (await page.locator('.perf-expanded .perf-row').count()) === 2)
  check('表演编辑器有台词行', (await page.locator('.perf-expanded .perf-line').count()) === 2)

  const emotion = page.locator('.perf-expanded .perf-row select').first()
  await emotion.selectOption('sad')
  await page.getByRole('button', { name: '保存到 project.json' }).click()
  await page.waitForTimeout(400)
  check(
    '保存后项目里的情绪更新',
    state.project.shots[0].performance?.[0]?.emotion === 'sad',
    JSON.stringify(state.project.shots[0].performance?.[0]),
  )

  // 重新打开：读回手改值
  await openShots()
  check('重载后摘要显示哀', (await page.locator('.perf-summary').first().innerText()).includes('哀'))

  // Inspector 表演区
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  await page.locator('.react-flow__node').first().click()
  await page.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
  await page.waitForTimeout(250)
  const perfSection = page.locator('[data-section="performance"]')
  if ((await perfSection.count()) > 0 && !(await perfSection.evaluate((el) => el.open))) {
    await perfSection.locator('summary').click()
    await page.waitForTimeout(250)
  }
  await page.locator('.perf-inspector').waitFor({ timeout: 10000 })
  check('Inspector 有表演区', (await page.locator('.perf-inspector').innerText()).includes('表演'))

  // 口型面板：多说话人 provider 禁用、prompt 可用；不调用外部
  await openShots()
  await page.locator('.perf-cell button', { hasText: '编辑' }).first().click()
  const lip = page.locator('[data-lip-sync]').first()
  await lip.waitFor()
  await lip.locator('select').selectOption('provider')
  check('provider 模式显示禁用原因', (await lip.innerText()).includes('先生成') || (await lip.innerText()).includes('多说话人'), (await lip.innerText()).slice(0, 180))
  await lip.locator('select').selectOption('prompt')
  check('prompt 模式可用', (await lip.innerText()).includes('提示词会写'))
  check('未调用外部口型接口', lipSyncCalls === 0, `calls=${lipSyncCalls}`)

  // 提示词输入带 cast/performance/delivery
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.locator('table.wb-table').waitFor({ timeout: 15000 })
  await page.locator('main button.btn', { hasText: '生成提示词' }).first().click()
  await page.waitForTimeout(600)
  const promptText = String(promptBody?.prompt || '')
  check('提示词输入含 cast', promptText.includes('cast') && promptText.includes('陈默'))
  check('提示词输入含 performance', promptText.includes('performance') && promptText.includes('压住桌沿'))
  check('提示词输入含逐行 delivery', promptText.includes('dialogue') && promptText.includes('slow'))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))

  await page.screenshot({ path: path.join(EVIDENCE, 'performance-ui.png'), fullPage: false })

  // 没有项目时不渲染可写表格、不产生项目写入
  noProjects = true
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(700)
  const beforeNoProjectPosts = projectPosts
  check('没有项目时不渲染镜头表', (await page.locator('table.wb-table').count()) === 0)
  check('没有项目时不写项目', projectPosts === beforeNoProjectPosts, `posts=${projectPosts}`)
} finally {
  await browser.close()
  child.kill()
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
