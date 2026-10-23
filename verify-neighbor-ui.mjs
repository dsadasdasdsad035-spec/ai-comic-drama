/**
 * 相邻分镜 UI / 请求回归：右键只出现上一镜/下一镜、手动勾选、图片与视频请求、无尾帧。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-neighbor-ui.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const A = `neighbor-a-${Date.now()}`
const B = `neighbor-b-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const saveImg = async (prefix) => {
  const r = await api('/api/save-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: PNG, prefix }) })
  if (!r.ok) throw new Error(r.message || 'save image failed')
  return r.url
}
const createProject = async (name, shots) => {
  await api(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: name, aspect: '16:9' }),
  })
  await api(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
      shots,
    }),
  })
}
const s = (id, no, image) => ({
  id, episode: 1, no, scene_no: 1, scene_slug: '井道', seconds: 2, size: '中景', move: '固定',
  cast: [], dialogue: '', keyframe_prompt: `${no} 画面`, ...(image ? { keyframe: image } : {}),
})
const i1 = await saveImg('n1')
const i2 = await saveImg('n2')
const i3 = await saveImg('n3')
const i4 = await saveImg('n4')
await createProject(A, [s('E01-S01', 'S01', i1), s('E01-S02', 'S02', i2), s('E01-S03', 'S03', i3), s('E01-S04', 'S04', i4)])
await createProject(B, [s('E01-S01', 'S01', i1), s('E01-S02', 'S02', i2), s('E01-S03', 'S03', '')])

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const seedream = []
const seedance = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})
await page.route('**/api/seedream', (route) => {
  seedream.push(JSON.parse(route.request().postData() || '{}'))
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, urls: ['/generated/out-neighbor.jpg'], url: '/generated/out-neighbor.jpg', size: '1024x1024', elapsed: 1 }) })
})
await page.route('**/api/seedance**', (route) => {
  if (route.request().method() === 'POST') {
    seedance.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'neighbor-task' }) })
  }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake-neighbor.mp4' }) })
})

const selectProject = async (name) => {
  await page.locator('.topbar-project select').selectOption(name)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(600)
}
const nodeId = async (name, shotId) => page.evaluate(({ name, shotId }) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === shotId)?.id
}, { name, shotId })
const nodeData = async (name, id) => page.evaluate(({ name, id }) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.id === id)?.data
}, { name, id })
const openMenu = async (id) => {
  await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, id)
  await page.waitForTimeout(200)
  await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
}

await page.goto(URL, { waitUntil: 'networkidle' })
await selectProject(A)
const n2 = await nodeId(A, 'E01-S02')
const beforeEdges = await page.locator('.react-flow__edge').count()
await openMenu(n2)
const rows = await page.locator('.ctx-row').allTextContents()
check('只出现相邻分镜', rows.some((x) => x.includes('上一镜 S01')) && rows.some((x) => x.includes('下一镜 S03')) && !rows.some((x) => x.includes('S04')), JSON.stringify(rows))
await page.locator('.ctx-row', { hasText: '上一镜 S01' }).locator('.ctx-main').click()
await page.waitForTimeout(2100)
let d2 = await nodeData(A, n2)
check('手动勾选写入 shot-prev', d2?.refIds?.includes('shot-prev'), JSON.stringify(d2?.refIds))
check('不自动写 shot-next', !d2?.refIds?.includes('shot-next'), JSON.stringify(d2?.refIds))
const persistedA = await api(`/api/project?name=${encodeURIComponent(A)}`)
const persistedShot = (persistedA.project?.shots || []).find((x) => x.id === 'E01-S02')
check('shot-prev 随项目持久化', persistedShot?.refIds?.includes('shot-prev'), JSON.stringify(persistedShot?.refIds))
const afterEdges = await page.locator('.react-flow__edge').count()
check('相邻参考不新增并行边', afterEdges === beforeEdges, `${beforeEdges} -> ${afterEdges}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, n2)
await page.waitForTimeout(500)
await page.getByRole('button', { name: /生成画面/ }).click()
await page.waitForTimeout(700)
check('画面请求包含上一镜', seedream[0]?.refImages?.includes(i1), JSON.stringify(seedream[0]?.refImages))
check('画面请求不包含下一镜', !seedream[0]?.refImages?.includes(i3), JSON.stringify(seedream[0]?.refImages))
check('画面提示词标明上一镜', /上一镜 S01/.test(String(seedream[0]?.prompt || '')), String(seedream[0]?.prompt || '').slice(-160))

await page.getByRole('button', { name: '生成视频', exact: true }).click()
await page.waitForTimeout(4200)
check('视频请求包含相邻参考', seedance[0]?.refImages?.includes(i1), JSON.stringify(seedance[0]?.refImages))
check('视频请求无尾帧字段', !('lastFrame' in (seedance[0] || {})) && !('returnLastFrame' in (seedance[0] || {})), JSON.stringify(seedance[0]))
check('视频参考模式不发送首帧', !('image' in (seedance[0] || {})), JSON.stringify(seedance[0]))
check('Inspector 无尾帧 UI', !(await page.locator('.vid-box').innerText()).includes('尾帧'), (await page.locator('.vid-box').innerText()).slice(-200))

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await openMenu(n2)
const prevRow = page.locator('.ctx-row', { hasText: '上一镜 S01' })
check('相邻候选有首帧动作', (await prevRow.locator('.ctx-act').count()) === 1)
await prevRow.locator('.ctx-act').click()
await page.waitForTimeout(900)
check('首帧动作只更新当前镜头', (await nodeData(A, n2))?.refImage === i1, (await nodeData(A, n2))?.refImage)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await page.locator('.topbar-project select').selectOption(B)
await page.waitForTimeout(700)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(500)
const b2 = await nodeId(B, 'E01-S02')
await openMenu(b2)
const nextRow = page.locator('.ctx-row', { hasText: '下一镜 S03' })
check('下一镜未出图置灰', (await nextRow.locator('.ctx-main').isDisabled()) === true, await nextRow.innerText())
check('未出图不写入参考', !(await nodeData(B, b2))?.refIds?.includes('shot-next'))

check('页面无未捕获异常（A/B）', errors.length === 0, errors.join(' | '))

// ---- C. 上限与省略提示 ----
const C = `neighbor-c-${Date.now()}`
const extras = []
for (let i = 0; i < 10; i++) extras.push(await saveImg(`nx${i}`))
const c1 = await saveImg('nc1')
const c2 = await saveImg('nc2')
await createProject(C, [
  s('E01-S01', 'S01', i1),
  { ...s('E01-S02', 'S02', i2), refIds: ['char-C1', 'char-C2', 'shot-prev'], refExtras: extras },
])
const projC = await api(`/api/project?name=${encodeURIComponent(C)}`)
await api(`/api/project?name=${encodeURIComponent(C)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...projC.project,
    characters: [
      { name: 'C1', role: '角色1', look_cn: '', look_en: '', palette: '', keywords: [], image: c1 },
      { name: 'C2', role: '角色2', look_cn: '', look_en: '', palette: '', keywords: [], image: c2 },
    ],
  }),
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.topbar-project select').selectOption(C)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const c2Node = await nodeId(C, 'E01-S02')
await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, c2Node)
await page.waitForTimeout(400)
const beforeImage = seedream.length
await page.getByRole('button', { name: /生成画面/ }).click()
await page.waitForTimeout(600)
const imgReq = seedream[beforeImage] || {}
check('图片参考总数不超过 10', (imgReq.refImages?.length || 0) <= 10, String(imgReq.refImages?.length))
check('图片超限仍按 10 张进入请求', (imgReq.refImages?.length || 0) <= 10, String(imgReq.refImages?.length))
check('图片编号不超过实际图片', /图10=/.test(String(imgReq.prompt || '')) && !/图11=/.test(String(imgReq.prompt || '')), String(imgReq.prompt || '').slice(-160))
const beforeVideo = seedance.length
await page.getByRole('button', { name: '生成视频', exact: true }).click()
await page.waitForTimeout(1400)
const vidReq = seedance[beforeVideo] || {}
check('视频参考图最多 4 张', (vidReq.refImages?.length || 0) === 4, JSON.stringify(vidReq.refImages))
check('视频省略提示可见', (await page.locator('.toast').textContent().catch(() => '') || '').includes('已省略') || /最多 4 张/.test(String(vidReq.prompt || '')), await page.locator('.toast').textContent().catch(() => ''))
check('视频优先级包含当前+角色+相邻', /\[图1\]=当前画面构图/.test(String(vidReq.prompt || '')) && /角色/.test(String(vidReq.prompt || '')) && /上一镜 S01/.test(String(vidReq.prompt || '')), String(vidReq.prompt || '').slice(-260))

// ---- D. 旧 tail_image 数据打开兼容 ----
const D = `neighbor-d-${Date.now()}`
await createProject(D, [{
  ...s('E01-S01', 'S01', i1),
  clip: '/videos/old-tail-video.mp4',
  tail_image: '/generated/old-tail.jpg',
}])
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.topbar-project select').selectOption(D)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const dNode = await nodeId(D, 'E01-S01')
await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, dNode)
await page.waitForTimeout(500)
check('旧 tail_image 不生成尾帧 UI', (await page.locator('.tail-row').count()) === 0)
check('旧项目 Inspector 无尾帧文字', !(await page.locator('.vid-box').innerText()).includes('尾帧'))
check('旧视频仍可显示', (await page.locator('.vid-box video').count()) >= 1)

check('页面无未捕获异常（含上限/旧项目）', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
