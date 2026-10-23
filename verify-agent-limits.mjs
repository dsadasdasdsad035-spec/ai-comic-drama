/**
 * Agent 运行上限设置验收：默认值、夹取、旧设置兼容、保存不影响其他设置。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-agent-limits.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-agent-limits-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/agent/agentLimits.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lim = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

check('默认值 300 秒', JSON.stringify(lim.normalizeAgentLimits(undefined)) === JSON.stringify({ totalSeconds: 300 }))
check('越界夹取', JSON.stringify(lim.normalizeAgentLimits({ totalSeconds: 9999 })) === JSON.stringify({ totalSeconds: 1800 }))
check('空值/非数字回退默认', JSON.stringify(lim.normalizeAgentLimits({ totalSeconds: 'abc' })) === JSON.stringify({ totalSeconds: 300 }))
check('秒换算毫秒', lim.resolveAgentLimits({ agentLimits: { totalSeconds: 600 } }).totalMs === 600000)

const oldSettings = {
  providers: [{ id: 'p-text', label: 'Text', kind: 'openai', baseUrl: 'https://mock', caps: ['text'], apiKey: 'mock' }],
  models: [{ key: 'code', label: 'Code Model', cap: 'text', provider: 'p-text', model: 'code-model' }],
  defaults: { text: 'code' },
  stageModels: { sceneCode: 'code' },
  pricing: { image: 0.22 },
  apiKey: '',
  rules: { script: { enabled: true, text: 'keep-me' } },
}
let saved = null
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api/settings', async (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings: oldSettings, db: 'mock' }) })
  }
  if (route.request().method() === 'PUT') {
    saved = JSON.parse(route.request().postData() || '{}')
    const normalized = lim.normalizeAgentLimits(saved.agentLimits)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        settings: { ...oldSettings, ...saved, agentLimits: normalized },
      }),
    })
  }
  return route.continue()
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.waitForTimeout(500)
const timeInput = page.locator('label.st-field', { hasText: '总运行时长' }).locator('input')
check('旧设置显示默认总时长', await timeInput.inputValue() === '300', await timeInput.inputValue())

await timeInput.fill('600')
await page.getByRole('button', { name: '保存设置', exact: true }).click()
await page.waitForTimeout(500)
check('保存发送 agentLimits', saved?.agentLimits?.totalSeconds === 600, JSON.stringify(saved?.agentLimits))
check('保存保留模型和其他设置', saved?.providers?.length === 1 && saved?.models?.length === 1 && saved?.rules?.script?.text === 'keep-me')
check('保存后回显 600', await timeInput.inputValue() === '600')

await timeInput.fill('9999')
await page.getByRole('button', { name: '保存设置', exact: true }).click()
await page.waitForTimeout(500)
check('越界保存夹取 1800', saved?.agentLimits?.totalSeconds === 1800, JSON.stringify(saved?.agentLimits))
check('夹取后回显有效值', await timeInput.inputValue() === '1800', await timeInput.inputValue())

await timeInput.fill('')
await page.getByRole('button', { name: '保存设置', exact: true }).click()
await page.waitForTimeout(500)
check('空值回退默认 300', saved?.agentLimits?.totalSeconds === 300, JSON.stringify(saved?.agentLimits))
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
