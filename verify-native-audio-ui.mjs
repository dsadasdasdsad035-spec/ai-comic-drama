/**
 * 原生音频 UI：只有 APIMart Seedance 2.5 + 4s+ + 单说话人 + 有效样本才能开启；
 * 开启后 canvas 写回 audio_mode/audio_ref。跑法：node verify-native-audio-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5345
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'native-audio-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/seedance-voice-reference/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const sample = {
  url: '/project-assets/native-e2e/voice.mp3', text: '这是一段试音。', seconds: 8,
  engine: 'mock', voiceId: 'male-qn-qingse', modelKey: 'minimax-tts', fingerprint: 'f', stale: false,
}
const settings = {
  providers: [{ id: 'apimart', label: 'APIMart', kind: 'apimart', baseUrl: 'https://api.apimart.ai/v1', caps: ['text', 'image', 'video', 'audio'] }],
  models: [{ key: 'seedance25', label: 'Seedance 2.5', cap: 'video', caps: ['video', 'videoRef'], provider: 'apimart', model: 'seedance-2.5', features: { audioOut: true, firstFrame: true, lastFrame: true, videoRef: true } }],
  defaults: { video: 'seedance25' }, stageModels: {}, pricing: {}, agentLimits: {}, agentToolProtocol: 'auto', apiKey: '', rules: {}, lipSync: { provider: 'off' },
}
const project = {
  name: 'native-e2e', aspect: '16:9', style: '写实', assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{ name: '陈默', role: '主角', voice: 'male-qn-qingse', look_cn: '寸头', look_en: 'buzz cut, grey coat', palette: '灰', keywords: ['寸头'], voice_sample: sample }],
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', seconds: 5, size: '中景', move: '固定', desc: '陈默说话', dialogue: [{ speaker: '陈默', text: '你来了。' }], performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'], keyframe: '/generated/a.jpg', keyframe_prompt: 'x', handEdited: [], audio_mode: 'off' },
    { id: 'E01-S02', episode: 1, no: 'S02', seconds: 2, size: '中景', move: '固定', desc: '太短', dialogue: [{ speaker: '陈默', text: '太短。' }], performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'], keyframe: '/generated/a.jpg', keyframe_prompt: 'x', handEdited: [], audio_mode: 'off' },
  ],
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
  if (route.request().method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
    return
  }
  await route.continue()
})
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    const body = req.postDataJSON() || {}
    for (const s of body.shots || []) { const old = project.shots.find((x) => x.id === s.id); if (old) Object.assign(old, s) }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shots: project.shots, characters: project.characters }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 2 }] }) })
})
await page.route('**/project-assets/**', async (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('') }))
await page.route('**/generated/**', async (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('') }))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  await page.locator('.react-flow__node').first().click()
  await page.locator('[data-native-audio]').waitFor({ timeout: 10000 })
  check('5 秒单说话人可开启', !(await page.locator('[data-native-audio] input[type=checkbox]').isDisabled()))
  await page.locator('[data-native-audio] input[type=checkbox]').check()
  await page.waitForTimeout(2200)
  check('写回 audio_mode=native', project.shots[0].audio_mode === 'native', project.shots[0].audio_mode)
  check('写回 audio_ref', project.shots[0].audio_ref?.url === sample.url, JSON.stringify(project.shots[0].audio_ref))

  await page.locator('.react-flow__node').nth(1).click()
  await page.locator('[data-native-audio]').waitFor({ timeout: 10000 })
  check('2 秒镜头禁用 native', await page.locator('[data-native-audio] input[type=checkbox]').isDisabled())
  check('显示 4 秒原因', (await page.locator('[data-native-audio]').innerText()).includes('4 秒'))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'native-audio-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
