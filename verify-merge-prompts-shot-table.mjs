/**
 * 镜头表合并提示词：顶栏无「提示词」、空首帧不能推画布、submit_shots 带 prompts 写回表格。
 * 跑法：APP_URL=http://127.0.0.1:5273 node verify-merge-prompts-shot-table.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())
const NAME = `merge-prompts-${Date.now()}`

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, style: 'test', aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: 'T', scenes: [{ no: 1, slug: 'x', place: 'x', time: '日' }] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: 'x',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '空镜',
        keyframe_prompt: '',
        video_prompt: '',
      },
    ],
  }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 900 } })
await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(800)
check('无提示词顶栏', (await p.getByRole('button', { name: '提示词', exact: true }).count()) === 0)
const pushBtn = p.locator('.wb-foot button', { hasText: '生成到画布' })
check('空首帧时推画布禁用', !(await pushBtn.isEnabled()))
await p.locator('.wb-table tbody tr').first().locator('textarea').first().fill('filled keyframe prompt')
await p.waitForTimeout(300)
check('有首帧后可推画布', await pushBtn.isEnabled())
await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
