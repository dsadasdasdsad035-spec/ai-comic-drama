/**
 * 角色音色样本 UI：生成请求、项目媒体落库、试听、试音稿变化标 stale。
 * 跑法：node verify-character-voice-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5344
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-voice-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/seedance-voice-reference/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
let voiceBody = null
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const project = {
  name: 'voice-e2e', aspect: '16:9', style: '写实', shots: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{ name: '陈默', role: '主角', voice: 'legacy-unknown', look_cn: '寸头', look_en: 'buzz cut, grey coat', palette: '灰', keywords: ['寸头'] }],
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
    const body = req.postDataJSON() || {}
    if (Array.isArray(body.characters)) project.characters = body.characters
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, characters: project.characters, shots: [] }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 0 }] }) })
})
await page.route('**/api/voice', async (route) => {
  voiceBody = route.request().postDataJSON()
  const url = `/project-assets/${project.name}/voice-sample-test.mp3`
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url, seconds: 8, engine: 'mock:voice' }) })
})
const mp3 = fs.existsSync('/tmp/seedance-ref.mp3') ? fs.readFileSync('/tmp/seedance-ref.mp3') : Buffer.from('')
await page.route('**/project-assets/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: mp3 })
})

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.locator('.char-card').first().waitFor({ timeout: 15000 })
  await page.getByRole('tab', { name: '音色' }).click()
  check('音色样本区出现', (await page.locator('.char-voice-sample').count()) === 1)
  const voiceHtml = await page.locator('.char-voice select').innerHTML()
  check('音色下拉有来源分组', (await page.locator('.char-voice optgroup').count()) >= 1, voiceHtml.slice(0, 500))
  check('旧音色保留为未知原值', (await page.locator('.char-voice select').innerText()).includes('未知/保留原值'))
  await page.locator('.char-voice select').selectOption('male-qn-qingse')
  check('选择目录音色后可用', !(await page.locator('.char-sample-actions button', { hasText: '生成音色样本' }).first().isDisabled()))

  await page.locator('.char-sample-actions button', { hasText: '生成音色样本' }).first().click()
  await page.waitForTimeout(800)
  check('请求带项目与样本用途', voiceBody?.project === project.name && voiceBody?.purpose === 'character-sample')
  check('请求带角色音色与试音稿', voiceBody?.voice === 'male-qn-qingse' && String(voiceBody?.text || '').length > 10)
  check('项目里写入样本', project.characters[0].voice_sample?.url?.includes('/project-assets/'), JSON.stringify(project.characters[0].voice_sample))
  check('显示实际时长', (await page.locator('.char-sample-head').innerText()).includes('8.0s'))
  check('出现试听音频', (await page.locator('.char-sample-audio').count()) === 1)

  await page.getByRole('button', { name: '编辑试音稿' }).click()
  await page.locator('.char-drawer textarea').nth(2).fill('新的试音稿，确认样本会过期。')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(500)
  check('改试音稿标 stale', (await page.locator('.char-voice-sample').innerText()).includes('需要重生成'))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'character-voice-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
