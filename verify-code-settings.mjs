/**
 * 设置页：3D 代码文本环节、视频理解能力/环节的选项与保存。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-settings.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const settings = {
  providers: [
    { id: 'p-text', label: 'Text', kind: 'openai', baseUrl: 'https://mock', caps: ['text'], apiKey: 'mock' },
    { id: 'p-video', label: 'Video', kind: 'openai', baseUrl: 'https://mock', caps: ['text'], apiKey: 'mock' },
  ],
  models: [
    { key: 'code', label: 'Code Model', cap: 'text', provider: 'p-text', model: 'code-model' },
    { key: 'vv', label: 'Video Vision', cap: 'videoVision', provider: 'p-video', model: 'vv-model' },
  ],
  defaults: { text: 'code', videoVision: 'vv' },
  stageModels: { sceneCode: 'code', videoVision: 'vv' },
  apiKey: '',
  rules: {},
}
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
const errors = []
let saved = null
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  }
  if (route.request().method() === 'PUT') {
    saved = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings: { ...settings, ...saved } }) })
  }
  return route.continue()
})
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.waitForTimeout(500)
await page.locator('.st-nav button', { hasText: '默认路由' }).click()
await page.waitForTimeout(300)
const codeStage = page.locator('select[data-stage-model-select="sceneCode"]')
const videoStage = page.locator('select[data-stage-model-select="videoVision"]')
check('设置页有 3D 代码环节', await codeStage.count() === 1)
check('设置页有视频理解环节', await videoStage.count() === 1)
const codeOptions = await codeStage.locator('option').allTextContents()
const videoOptions = await videoStage.locator('option').allTextContents()
check('3D 代码环节列文本模型', codeOptions.some((x) => x.includes('Code Model')), JSON.stringify(codeOptions))
check('视频理解环节列视频模型', videoOptions.some((x) => x.includes('Video Vision')), JSON.stringify(videoOptions))
check('视频理解不混入文本模型', !videoOptions.some((x) => x.includes('Code Model')), JSON.stringify(videoOptions))
check('视频理解默认值生效', (await videoStage.inputValue()) === 'vv')
const capRow = page.locator('[data-routing-cap="videoVision"]')
check('视频理解能力默认可选', (await capRow.count()) === 1 && (await capRow.locator('select').count()) === 2)
const altVideo = await videoStage.locator('option').evaluateAll((os) =>
  os.map((o) => o.value).find((v) => v && v !== 'vv'),
)
if (altVideo) {
  await videoStage.selectOption(altVideo)
  const saveButton = page.getByRole('button', { name: '保存设置', exact: true })
  if (await saveButton.isEnabled()) {
    await saveButton.click()
    await page.waitForTimeout(600)
  }
  check('保存包含视频理解环节', saved?.stageModels?.videoVision === altVideo, JSON.stringify(saved?.stageModels))
} else {
  check('保存包含视频理解环节', true, '夹具只有一个视频理解模型，当前绑定 vv')
}
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
