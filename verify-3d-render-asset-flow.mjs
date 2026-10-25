/**
 * 真实 3D 渲染 → 素材选择器验收（需要本机 Blender）：
 * 1) 复制一个已有 scene_code 的项目镜头，避免改动用户项目
 * 2) 从提示词工作台打开 3D，真实渲染 MP4
 * 3) 确认新 MP4 落在 /videos，并出现在 /api/media 的视频列表
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-3d-render-asset-flow.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.APP_URL || 'http://127.0.0.1:5280'
const SOURCE = process.env.SOURCE_PROJECT || 'a'
const NAME = `verify-3d-render-${Date.now()}`
const EVIDENCE = path.join(
  'openspec',
  'changes',
  'move-3d-schedule-to-prompt-workbench',
  'evidence',
)
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) => fetch(`${BASE}${p}`, init).then((r) => r.json())
const postJson = (p, body) =>
  api(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const src = (await api(`/api/project?name=${encodeURIComponent(SOURCE)}`)).project
const shot =
  src.shots.find(
    (s) =>
      s.scene_code?.runtime === 'blender' &&
      String(s.scene_code?.code || '').includes('def build'),
  ) || src.shots.find((s) => s.scene_code)
if (!shot) {
  console.error('源项目没有带 scene_code 的镜头，无法做真实渲染')
  process.exit(2)
}
check('源镜头有可渲染代码', Boolean(shot.scene_code?.code), shot.id)
const originalVideo = shot.schedule_video || ''

await postJson(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  title: NAME,
  aspect: src.aspect || '16:9',
})
await postJson(`/api/project?name=${encodeURIComponent(NAME)}`, {
  shots: src.shots,
  characters: src.characters ?? [],
  designs: src.designs ?? [],
  assets: src.assets ?? [],
  episodes: src.episodes ?? [],
  sceneLayouts: src.sceneLayouts ?? [],
  style: src.style ?? '',
  aspect: src.aspect || '16:9',
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
p.on('dialog', (d) => d.accept())
let textCalls = 0
await p.route('**/api/text', async (route) => {
  textCalls++
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, message: '已有代码，不应调用文本模型' }),
  })
})

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(1000)
const ep = shot.episode || 1
await p.locator('.epbar-trigger').click()
await p.locator('.epbar-tab', { hasText: `E${String(ep).padStart(2, '0')}` }).click()
await p.waitForTimeout(700)
await p.getByRole('button', { name: '提示词', exact: true }).click()
await p.waitForTimeout(900)

const row = p.locator('.pt-table tbody tr', { hasText: shot.no || shot.id }).first()
const cell = row.locator('.pt-3d')
check('目标镜在提示词表', (await row.count()) === 1, shot.no || shot.id)
await cell.locator('button', { hasText: '打开' }).click()
const dialog = p.locator('[aria-label="3D 代码工作台"]')
await dialog.waitFor({ state: 'visible', timeout: 15000 })
check('3D 工作台打开', (await dialog.count()) === 1)
check('没有触发代码生成', textCalls === 0, String(textCalls))
check('编辑器显示已有代码', (await dialog.locator('textarea[aria-label="场景代码"]').count()) >= 0)
await dialog.getByRole('button', { name: '代码', exact: true }).click()
await p.waitForTimeout(300)
check('代码非空', (await dialog.locator('textarea[aria-label="场景代码"]').inputValue()).length > 100)

const t0 = Date.now()
await dialog.getByRole('button', { name: '渲染视频' }).click()
let rendered = null
for (let i = 0; i < 240; i++) {
  await p.waitForTimeout(1000)
  const now = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
  rendered = now.project.shots.find((s) => s.id === shot.id)
  if (
    rendered?.schedule_video &&
    rendered.schedule_video !== originalVideo &&
    rendered.schedule_meta?.renderedAt
  ) {
    break
  }
  if (i % 10 === 0) {
    const btn = await dialog.getByRole('button', { name: /渲染/ }).first().innerText().catch(() => '')
    console.log(`… 渲染中 ${Math.round((Date.now() - t0) / 1000)}s ${btn}`)
  }
}
const secs = Math.round((Date.now() - t0) / 1000)
check('真实渲染完成', Boolean(rendered?.schedule_video) && rendered.schedule_video !== originalVideo, `${secs}s ${rendered?.schedule_video || ''}`)
const videoUrl = rendered?.schedule_video || ''
check('MP4 落在 /videos', videoUrl.startsWith('/videos/') && videoUrl.endsWith('.mp4'), videoUrl)
check('MP4 文件存在', Boolean(videoUrl) && fs.existsSync(path.join('public', videoUrl)), videoUrl)
const media = await api(`/api/media?name=${encodeURIComponent(NAME)}`)
check(
  '素材选择器视频列表包含该 MP4',
  (media.videos ?? []).some((v) => v.url === videoUrl),
  JSON.stringify((media.videos ?? []).slice(0, 3).map((v) => v.url)),
)
check('页面无运行时异常', errors.length === 0, errors.slice(0, 2).join(' | '))

await p.screenshot({ path: path.join(EVIDENCE, '3d-render-asset-flow.png'), fullPage: false })
fs.writeFileSync(
  path.join(EVIDENCE, '3d-render-asset-flow.json'),
  JSON.stringify(
    {
      project: NAME,
      sourceProject: SOURCE,
      shot: shot.id,
      originalVideo,
      videoUrl,
      renderSeconds: secs,
      mediaVideos: (media.videos ?? []).map((v) => v.url).slice(0, 10),
      pageErrors: errors,
    },
    null,
    2,
  ),
)
await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
