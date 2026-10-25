/**
 * 旧数据只读与 Blender 不可用态（任务 4.3 / 4.4）。
 * 需要 dev server：APP_URL=http://127.0.0.1:5274 node verify-legacy-readonly.mjs
 */
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'

const URL = process.env.APP_URL || 'http://127.0.0.1:5274'
const NAME = `legacy-ro-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const health = await api('/api/blender/health')
if (!health.ok) {
  console.log(`⏭ 跳过：本机 Blender 不可用（${health.message}）`)
  process.exit(0)
}

const OLD_JS = `let S;
function init(ctx) { S = ctx; }
function renderAt(t) {}
function dispose() {}
`
// 模拟模型在代码前后带说明和围栏：准入必须清掉围栏，不能把第 1 行送给 Blender
const NEW_PY = '```python\nimport bpy\ndef build(ctx):\n    bpy.ops.mesh.primitive_cube_add()\ndef pose(t, mode):\n    pass\ndef dispose():\n    pass\n```\n\n以上是 Blender 代码。'

const img = await api('/api/save-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
const baseShot = {
  episode: 1,
  scene_no: 1,
  scene_slug: '井道',
  seconds: 3,
  size: '中景',
  move: '推',
  desc: '测试',
  cast: [],
  dialogue: '陈默：别动',
  keyframe_prompt: '测试',
  video_prompt: '测试',
  keyframe: img.url,
}
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    characters: [],
    designs: [],
    assets: [],
    episodes: [{ no: 1, title: '测试', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: [] }] }],
    shots: [
      {
        ...baseShot,
        id: 'E01-S01',
        no: 'S01',
        scene_code: {
          version: 1,
          abiVersion: 1,
          code: OLD_JS,
          codeHash: sha(OLD_JS),
          source: 'manual',
          updatedAt: new Date().toISOString(),
        },
      },
      { ...baseShot, id: 'E01-S02', no: 'S02' },
    ],
  }),
})

const settingsRaw = await api('/api/settings')
const settings = settingsRaw.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'legacy-mock'),
  { id: 'legacy-mock', label: 'Legacy Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'legacy-code'),
  { key: 'legacy-code', label: 'Legacy Code', cap: 'text', provider: 'legacy-mock', model: 'legacy-code' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'legacy-code' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'legacy-code' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })

async function openWorkbench(shotId, routeHealthBroken = false) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  let renderCalls = 0
  page.on('request', (r) => {
    if (r.url().includes('/api/blender/render')) renderCalls++
  })
  page.on('pageerror', (e) => errors.push(e.message))
  if (routeHealthBroken) {
    await page.route('**/api/blender/health*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, path: null, version: null, min: '4.2', max: '6.0', reason: 'not-installed', message: '未找到 Blender。请安装受支持的版本。', defaults: health.defaults }),
      }),
    )
  }
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
    }
    return route.continue()
  })
  await page.route('**/api/text', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: { reply: '已转换', code: NEW_PY, motionNote: '' }, text: '', model: 'legacy-code', modelKey: 'legacy-code', modelLabel: 'Legacy Code' }),
    }),
  )
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(600)
  const nodeId = await page.evaluate(([name, sid]) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === sid)?.id
  }, [NAME, shotId])
  await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.waitForTimeout(1200)
  return { page, nodeId, errors, renderCalls: () => renderCalls }
}

// ---- 旧 v1 代码：只读 + 转换
{
  const { page, nodeId, errors, renderCalls } = await openWorkbench('E01-S01')
  await page.waitForTimeout(2500)
  check('旧代码打开时不提交渲染作业', renderCalls() === 0, String(renderCalls()))
  const previewStatus = await page.locator('.cw-preview-status').textContent().catch(() => '')
  check('旧代码状态是只读而不是渲染失败', previewStatus?.includes('旧数据只读') === true, previewStatus || '')
  const bar = await page.locator('.cw-legacy-bar').innerText().catch(() => '')
  check('旧代码显示只读告知', bar.includes('旧 Three.js 代码只读'), bar.slice(0, 120))
  check('旧代码没有预览 video', (await page.locator('.cw-preview video').count()) === 0)
  await page.getByRole('button', { name: '代码', exact: true }).click()
  await page.waitForTimeout(300)
  const runDisabled = await page.getByRole('button', { name: '运行', exact: true }).isDisabled()
  const saveDisabled = await page.locator('.cw-code-actions').getByRole('button', { name: '保存', exact: true }).isDisabled()
  const renderDisabled = await page.getByRole('button', { name: '渲染视频', exact: true }).isDisabled()
  check('旧代码禁用运行/保存/渲染', runDisabled && saveDisabled && renderDisabled, JSON.stringify({ runDisabled, saveDisabled, renderDisabled }))

  await page.locator('.ctxp').waitFor({ timeout: 20000 })
  // 旧镜头没有保存过参考选择时 context 为空；转换至少要选一项文本。
  await page.getByRole('tab', { name: /文本/ }).click()
  await page.waitForTimeout(200)
  const line = page.locator('.ctxp-line').first()
  if (await line.count()) await line.click()
  await page.locator('.cw-legacy-bar').getByRole('button', { name: '转换为 Blender 代码' }).click()
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500)
    const d = await page.evaluate(([name, nid]) => {
      const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
      return (s.nodes || []).find((x) => x.id === nid)?.data
    }, [NAME, nodeId])
    if (d?.sceneCode?.runtime === 'blender' && d?.sceneCode?.abiVersion === 2) break
  }
  const converted = await page.evaluate(([name, nid]) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    const d = (s.nodes || []).find((x) => x.id === nid)?.data
    return { runtime: d?.sceneCode?.runtime, abi: d?.sceneCode?.abiVersion, source: d?.sceneCode?.source, code: String(d?.sceneCode?.code || '').slice(0, 40) }
  }, [NAME, nodeId])
  check('转换写入 v2 Blender 代码', converted.runtime === 'blender' && converted.abi === 2 && converted.code.includes('def build') && !converted.code.includes('```'), JSON.stringify(converted))
  check('旧代码转换页无未捕获异常', errors.length === 0, errors.join(' | '))
  await page.close()
}

// ---- Blender 不可用：禁用生成/渲染
{
  const { page, errors } = await openWorkbench('E01-S02', true)
  const status = await page.locator('.cw-preview-status').textContent().catch(() => '')
  const empty = await page.locator('.cw-empty-preview').innerText().catch(() => '')
  check('不可用时提示安装 Blender', empty.includes('Blender'), `${status} | ${empty.slice(0, 80)}`)
  const genDisabled = await page.getByRole('button', { name: '生成 3D 代码', exact: true }).first().isDisabled()
  const renderDisabled = await page.getByRole('button', { name: '渲染视频', exact: true }).isDisabled()
  check('不可用时禁用生成与渲染', genDisabled && renderDisabled, JSON.stringify({ genDisabled, renderDisabled }))
  check('不可用页无未捕获异常', errors.length === 0, errors.join(' | '))
  await page.close()
}

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
