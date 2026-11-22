/**
 * 出片秒数 UI 验收（shot-outgoing-duration）：
 * 1) 出片设置内可直接改镜头时长，并显示「镜头 Xs → 请求 Ys（原因）」
 * 2) 原生音频 4.2s 镜头：请求 4s（4 秒合法，不再抬到 5）、面板摘要同值、生成视频按钮可用
 * 3) 改出片设置时长后，「运镜与语义」同一字段同步
 * 跑法：node verify-shot-outgoing-duration.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5357
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-duration-ui-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const sample = {
  url: '/project-assets/duration-e2e/voice.mp3', text: '试音。', seconds: 8,
  engine: 'mock', voiceId: 'v1', modelKey: 'minimax-tts', fingerprint: 'f', stale: false,
}
const settings = {
  providers: [{ id: 'apimart', label: 'APIMart', kind: 'apimart', baseUrl: 'https://api.apimart.ai/v1', caps: ['text', 'image', 'video', 'audio'] }],
  models: [{ key: 'seedance25', label: 'Seedance 2.5', cap: 'video', caps: ['video', 'videoRef'], provider: 'apimart', model: 'seedance-2.5', features: { audioOut: true, firstFrame: true, lastFrame: true, videoRef: true } }],
  defaults: { video: 'seedance25' }, stageModels: {}, pricing: {}, agentLimits: {}, agentToolProtocol: 'auto', apiKey: '', rules: {}, lipSync: { provider: 'off' },
}
const project = {
  name: 'duration-e2e', aspect: '16:9', style: '写实', assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{ name: '陈默', role: '主角', look_cn: '寸头', look_en: 'buzz cut', palette: '灰', keywords: [], image: '/generated/a.jpg', voice_sample: sample }],
  shots: [
    {
      id: 'E01-S01', episode: 1, no: 'S01', seconds: 4.2, size: '中景', move: '固定',
      desc: '陈默说话', dialogue: [{ speaker: '陈默', text: '你来了。' }],
      performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }],
      cast: ['陈默'], keyframe: '/generated/a.jpg', keyframe_prompt: 'x', video_prompt: '镜头固定，雨丝飘落',
      refIds: ['char-陈默'], refExtras: [], handEdited: [], audio_mode: 'native',
      audio_ref: { character: '陈默', url: sample.url, label: '陈默 音色' },
      clip: '/videos/duration-e2e.mp4',
      prod_kind: 'video',
    },
  ],
}
const projectState = structuredClone(project)

const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  env: { ...process.env, SB_PROJECTS_DIR: TMP },
  stdio: 'ignore',
})
let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  throw new Error('临时 dev server 启动失败')
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

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
    for (const s of body.shots || []) {
      const old = projectState.shots.find((x) => x.id === s.id)
      if (old) Object.assign(old, s)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shots: projectState.shots, characters: projectState.characters }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project: projectState }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: projectState.name, title: projectState.name, shots: projectState.shots.length }] }) })
})
await page.route('**/project-assets/**', async (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('') }))
await page.route('**/generated/**', async (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('') }))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#/p/${encodeURIComponent(projectState.name)}/board`)
  await page.locator('.rail').waitFor({ state: 'visible', timeout: 20000 })
  // 画布现在是「分集目录 → 单集画布」，先选集再选镜
  await page.locator('[data-board-ep="1"]').click()
  await page.locator('.react-flow__node').first().waitFor({ timeout: 20000 })
  await page.locator('.react-flow__node').first().click()
  await page.locator('#si-tab-outgoing').click()
  await page.waitForTimeout(400)

  const settingsFold = page.locator('[data-section="videoSettings"]')
  if ((await settingsFold.getAttribute('data-open')) !== 'true') {
    await settingsFold.locator('.fold-head').click()
  }
  await page.waitForTimeout(300)

  const secondsInput = page.locator('[data-section="videoSettings"] [data-shot-seconds]')
  check('出片设置内有镜头时长输入', (await secondsInput.count()) === 1)
  check('时长输入初值为 4.2', (await secondsInput.inputValue()) === '4.2', await secondsInput.inputValue())

  const note = await page.locator('[data-shot-request-seconds]').innerText()
  check('显示镜头时长与四舍五入后的请求秒数', note.includes('镜头 4.2s → 请求 4s'), note)
  check('不再出现「原生音频须大于 4 秒」', !note.includes('大于 4 秒'), note)

  const settingsMeta = await settingsFold.locator('.fold-meta').innerText()
  check('折叠摘要用请求秒数', settingsMeta.includes('4s'), settingsMeta)

  const panelText = await page.locator('[data-video-prompt-panel]').first().innerText()
  check('出片面板摘要用请求秒数', panelText.includes('镜头 4.2s → 请求 4s'), panelText.split('\n')[0])

  const genBtn = page.locator('[data-shot-footer] button', { hasText: /生成视频|重出视频/ })
  check('原生音频 4.2s 仍可出片', !(await genBtn.isDisabled()))

  const chipText = await page.locator('.si-chips').innerText()
  check('成片 chip 用请求秒数', chipText.includes('成片 4s'), chipText.replace(/\n/g, ' '))

  await secondsInput.fill('6')
  await page.waitForTimeout(700)
  const noteAfter = await page.locator('[data-shot-request-seconds]').innerText()
  check('改时长后请求秒数同步为 6s', noteAfter.includes('6s') && !noteAfter.includes('请求 4s'), noteAfter)

  const motionFold = page.locator('[data-section="motionPrompt"]')
  if ((await motionFold.getAttribute('data-open')) !== 'true') {
    await motionFold.locator('.fold-head').click()
    await page.waitForTimeout(300)
  }
  const motionSeconds = await motionFold.locator('label.field', { hasText: '时长（秒）' }).locator('input').inputValue()
  check('运镜与语义的时长同步为 6', motionSeconds === '6', motionSeconds)

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
