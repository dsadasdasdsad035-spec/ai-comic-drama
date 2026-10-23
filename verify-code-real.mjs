/**
 * 真实模型 smoke：空镜头 → 真实文本模型生成代码 → 保存 → 渲染 mp4 → ffprobe。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-code-real.mjs
 * 不打印任何 Key；失败时保留错误文本供排查。
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `real-code-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '井道', seconds: 2, size: '中景', move: '推', cast: [], dialogue: '', keyframe_prompt: '一个青色立方体放在暗色地板上，镜头缓慢推近，冷色顶光' }],
  }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      localStorage.setItem('storyboard-stage-model-pick', JSON.stringify({ sceneCode: 'ark-plan-text-deepseek' }))
    }
  } catch {
    /* sandbox iframe has no localStorage */
  }
})
await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(650)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const id = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, NAME)
await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, id)
await page.waitForTimeout(250)
await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.waitForTimeout(1000)

let status = ''
let alert = ''
for (let i = 0; i < 110; i++) {
  await page.waitForTimeout(1200)
  status = (await page.locator('.cw-preview-status').textContent().catch(() => '')) || ''
  alert = (await page.locator('.cw-alert.danger').first().textContent().catch(() => '')) || ''
  if (status.includes('代码运行中') || alert) break
}
check('真实代码模型生成并运行', status.includes('代码运行中'), alert || status)
if (!status.includes('代码运行中')) {
  await page.screenshot({ path: 'openspec/changes/code-first-3d-chat/evidence/visual/real-model-error.png' })
  console.log('\n生成失败，保留项目与错误供排查。')
  await browser.close()
  process.exit(1)
}
await page.getByRole('button', { name: '代码', exact: true }).click()
const code = await page.locator('.cw-code').inputValue()
check('真实生成包含 ABI 入口', /function\s+init/.test(code) && /function\s+renderAt/.test(code), code.slice(0, 160))
await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1200)
await page.locator('.cw-head').getByRole('button', { name: '渲染视频', exact: true }).click()
let d = null
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(700)
  d = await page.evaluate(({ name, id }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.id === id)?.data
  }, { name: NAME, id })
  if (d?.scheduleVideo) break
}
check('真实生成已保存 sceneCode', Boolean(d?.sceneCode?.code))
check('真实渲染产出视频', typeof d?.scheduleVideo === 'string' && d.scheduleVideo.startsWith('/videos/'), String(d?.scheduleVideo))
if (d?.scheduleVideo) {
  const file = path.join(process.cwd(), 'public', d.scheduleVideo.replace(/^\//, ''))
  check('真实视频文件落盘', fs.existsSync(file), file)
  if (fs.existsSync(file)) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]).toString())
    const dur = Number(probe.format?.duration)
    check('真实视频时长约 2 秒', dur >= 1.7 && dur <= 2.5, String(dur))
  }
}
await page.screenshot({ path: 'openspec/changes/code-first-3d-chat/evidence/visual/real-model.png' })
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
