/**
 * 口型面板 UI 回归：三档模式、provider 禁用原因、prompt 提示、
 * 不从 UI 自动提交外部任务。跑法：node verify-lipsync-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5342
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lipsync-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/shot-performance-direction/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
let externalCalls = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const project = {
  name: 'lip-e2e', aspect: '16:9', style: '写实',
  shots: [{
    id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '近景', move: '固定',
    desc: '两人对话', cast: ['陈默', '林岚'],
    dialogue: [{ speaker: '陈默', text: '你来了。' }, { speaker: '林岚', text: '我不该来。' }],
    performance: [
      { character: '陈默', emotion: 'angry', intensity: 4, speaks: true },
      { character: '林岚', emotion: 'fearful', intensity: 3, speaks: true },
    ],
    keyframe_prompt: '{{陈默}} 与 {{林岚}} 对峙', handEdited: [],
  }],
  characters: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
}

const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore',
})
let up = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`${APP}/api/health`)).ok) { up = true; break } } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) { child.kill(); throw new Error('临时 dev server 启动失败') }

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shots: project.shots, characters: [] }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 1 }] }) })
})
await page.route('**/api/lipsync**', async (route) => {
  externalCalls++
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'UI test 不应调用外部口型' }) })
})

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.locator('table.wb-table').waitFor({ timeout: 15000 })
  await page.locator('.perf-cell button', { hasText: '编辑' }).first().click()
  const panel = page.locator('[data-lip-sync]').first()
  await panel.waitFor()
  check('口型面板出现', (await panel.locator('select').count()) === 1)
  check('默认关闭', (await panel.locator('select').inputValue()) === 'off')
  await panel.locator('select').selectOption('provider')
  check('provider 有禁用原因', (await panel.innerText()).includes('先生成') || (await panel.innerText()).includes('多说话人'), (await panel.innerText()).slice(0, 160))
  await panel.locator('select').selectOption('prompt')
  check('prompt 模式提示', (await panel.innerText()).includes('提示词会写'))
  check('未自动提交外部口型', externalCalls === 0, `calls=${externalCalls}`)
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'lipsync-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
