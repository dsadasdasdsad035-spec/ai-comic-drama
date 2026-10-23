/**
 * 代码渲染 → sceneCodeMeta → Inspector 生效/过期 → Seedance 参考禁用。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-freshness.mjs
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-code-fresh-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const CODE = `let S;
function init(ctx) {
  S = ctx;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f })
  );
  S.scene.add(box);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.2, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt(t) { if (S) S.scene.rotation.y = t; }
function dispose() {}
`
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: '井道',
        seconds: 3,
        size: '中景',
        move: '推',
        cast: ['陈默'],
        dialogue: '陈默：别动',
        keyframe_prompt: '代码镜头',
        scene_code: {
          version: 1,
          abiVersion: 1,
          code: CODE,
          codeHash: sha(CODE),
          source: 'manual',
          motionNote: '推近',
          updatedAt: new Date().toISOString(),
        },
        shot_3d_context: {
          version: 1,
          characterIds: [],
          designIds: [],
          assetUrls: [],
          imageUrls: [],
          videoUrls: [],
          sceneKeys: ['E01-SC01'],
          text: { prompt: true, videoPrompt: false, dialogue: 'all', cast: true, marks: false, sizeMove: true },
          updatedAt: new Date().toISOString(),
        },
      },
    ],
  }),
})

const settingsRaw = await api('/api/settings')
const settings = settingsRaw.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-video'),
  { id: 'mock-video', label: 'Mock Video', kind: 'ark', baseUrl: 'https://mock.invalid', caps: ['video'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'mock-video'),
  { key: 'mock-video', label: 'Mock Video', cap: 'videoRef', provider: 'mock-video', model: 'mock-video', supportsVideoRef: true },
]
settings.defaults = { ...(settings.defaults || {}), video: 'mock-video', videoRef: 'mock-video' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  return route.continue()
})
await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(900)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(700)

const nodeId = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, NAME)
const nodeData = () =>
  page.evaluate(({ name, id }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.id === id)?.data
  }, { name: NAME, id: nodeId })

await page.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await page.waitForTimeout(250)
await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()
let d = null
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(700)
  d = await nodeData()
  if (d?.scheduleVideo && d?.sceneCodeMeta && d?.scheduleMeta) break
}
check('右键代码渲染产出视频', typeof d?.scheduleVideo === 'string' && d.scheduleVideo.startsWith('/videos/'), String(d?.scheduleVideo))
check('代码渲染元数据完整', d?.sceneCodeMeta?.codeHash === sha(CODE) && d?.sceneCodeMeta?.abiVersion === 1 && d?.sceneCodeMeta?.assets?.length === 0)
check('选择指纹写入', typeof d?.sceneCodeMeta?.selectionFingerprint === 'string' && d.sceneCodeMeta.selectionFingerprint.length > 0)
check('scheduleMeta 与代码指纹一致', d?.scheduleMeta?.fingerprint === d?.sceneCodeMeta?.fingerprint)
const file = d?.scheduleVideo ? path.join(process.cwd(), 'public', d.scheduleVideo.replace(/^\//, '')) : ''
check('视频文件落盘', Boolean(file) && fs.existsSync(file), file)
if (file && fs.existsSync(file)) {
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]).toString(),
  )
  const stream = probe.streams?.[0] || {}
  const dur = Number(probe.format?.duration)
  check('代码视频时长约 3 秒', dur >= 2.7 && dur <= 3.4, String(dur))
  check('代码视频 16:9 尺寸', Number(stream.width) > Number(stream.height), `${stream.width}x${stream.height}`)
}

await page.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await page.waitForTimeout(500)
check('Inspector 显示生效', (await page.locator('.sched-badge').first().textContent())?.includes('生效'))
const refInput = page.locator('label.chk', { hasText: '3D 调度视频作参考' }).locator('input')
check('生效时参考开关可用', !(await refInput.isDisabled()))

// 保存一版改过的代码：旧视频必须变过期
await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: '代码', exact: true }).click()
await page.locator('.cw-code').fill(CODE + '\n// changed')
await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1300)
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(600)
if (await page.locator('.cw-close-ask').count()) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForTimeout(300)
}
check('改代码后 Inspector 显示已过期', (await page.locator('.sched-badge').first().textContent())?.includes('已过期'))
const staleRef = page.locator('label.chk', { hasText: '3D 调度视频作参考' }).locator('input')
check('过期时参考开关禁用', await staleRef.isDisabled())
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
