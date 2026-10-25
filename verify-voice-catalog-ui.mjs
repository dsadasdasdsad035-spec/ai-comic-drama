/**
 * 音色管理 UI：目录加载、添加/删除自定义音色、保存设置。
 * 跑法：node verify-voice-catalog-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5346
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-catalog-ui-'))
let bad = 0
let lastSave = null
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const settings = {
  providers: [{ id: 'minimax', label: 'MiniMax', kind: 'minimax', baseUrl: 'https://api.minimaxi.com/v1', caps: ['text', 'audio'] }],
  models: [{ key: 'minimax-tts', label: 'MiniMax speech-2.8-hd', cap: 'audio', provider: 'minimax', model: 'speech-2.8-hd' }],
  defaults: { audio: 'minimax-tts' }, stageModels: {}, pricing: {}, agentLimits: {}, agentToolProtocol: 'auto', apiKey: '', rules: {}, customVoices: [],
}
const voiceList = {
  ok: true,
  provider: 'minimax',
  providerKind: 'minimax',
  modelKey: 'minimax-tts',
  voices: [
    { id: 'male-qn-qingse', label: 'MiniMax · 青涩男声', provider: 'minimax', providerKind: 'minimax', modelKey: 'minimax-tts', source: 'preset' },
    { id: 'female-yujie', label: 'MiniMax · 御姐音', provider: 'minimax', providerKind: 'minimax', modelKey: 'minimax-tts', source: 'preset' },
  ],
  capabilities: { supportsList: true, supportsCustomVoiceId: true, supportsClone: false, supportsDesign: false, supportsPreview: true },
}
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' })
let up = false
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${APP}/api/health`)).ok) { up = true; break } } catch {} await new Promise((r) => setTimeout(r, 400)) }
if (!up) { child.kill(); throw new Error('临时 dev server 启动失败') }

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.route('**/api/settings**', async (route) => {
  const req = route.request()
  if (req.method() === 'PUT') {
    lastSave = req.postDataJSON()
    if (lastSave?.customVoices) settings.customVoices = lastSave.customVoices
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
})
await page.route('**/api/voices**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(voiceList) })
})

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '音色', exact: true }).click()
  await page.getByRole('heading', { name: '音色管理' }).waitFor({ timeout: 10000 })
  check('目录加载', (await page.locator('text=MiniMax · 青涩男声').count()) >= 1)
  check('显示 2 个音色', (await page.locator('text=2 个').count()) >= 1)

  const fields = page.locator('.st-field')
  await fields.filter({ hasText: '显示名' }).locator('input').fill('我的音色')
  await fields.filter({ hasText: 'voice_id' }).locator('input').fill('my-custom-voice')
  await fields.filter({ hasText: '备注' }).locator('input').fill('测试')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  check('本地自定义条目出现', (await page.getByText('my-custom-voice').count()) >= 1)
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.waitForTimeout(400)
  check('保存 body 含 customVoices', Array.isArray(lastSave?.customVoices) && lastSave.customVoices.some((v) => v.voiceId === 'my-custom-voice'), JSON.stringify(lastSave?.customVoices))

  await page.getByRole('button', { name: '删除', exact: true }).first().click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.waitForTimeout(400)
  check('删除后保存为空', Array.isArray(lastSave?.customVoices) && !lastSave.customVoices.some((v) => v.voiceId === 'my-custom-voice'))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(ROOT, 'openspec/changes/voice-catalog-management/evidence/voice-catalog-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
