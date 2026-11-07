/**
 * 镜头表承载提示词，不再有独立提示词顶栏；本脚本断言镜头表有提示词列且无 3D 列。
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())
const NAME = `verify-prompt-no3d-${Date.now()}`

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: 'T', scenes: [{ no: 1, slug: 'x', place: 'x', time: '日' }] }],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'x', keyframe_prompt: 'kf', video_prompt: 'vp' }],
  }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(800)
check('顶栏无提示词按钮', (await p.getByRole('button', { name: '提示词', exact: true }).count()) === 0)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(800)
const headers = await p.locator('.wb-table thead th').allTextContents()
check('镜头表含首帧提示词列', headers.some((t) => t.includes('首帧提示词')), headers.join('|'))
check('镜头表无 3D 列', !headers.some((t) => t.includes('3D')), headers.join('|'))
await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
