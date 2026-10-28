/**
 * 场景/道具素材板集成验证（临时库 + mock 文本/生图，不花真实额度）：
 * 1) 设置页默认素材守则、旧设置补齐、素材环节模型
 * 2) 本集拆解、同地点去重、无台词/无 cast 镜头仍参与
 * 3) 场景空镜/道具多角度请求，候选切换
 * 4) 单卡/批量发布幂等、删除后重发、刷新恢复
 * 5) A/B 项目隔离，3D 调度/布局不被引入
 * 跑法：node verify-asset-board.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5302
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-board-'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  })
const postProject = (name, body) =>
  api(`/api/project?name=${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const shot = (no, desc, extra = {}) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc,
  keyframe_prompt: `${desc}，冷青低照度`,
  dialogue: [],
  cast: [],
  ...extra,
})

const A_SHOTS = [
  shot('S01', '陈默推开地下井道的铁门，冷白灯光从井口落下', { cast: ['陈默'] }),
  shot('S02', '井口旁放着机械义体手臂，黑雨衣女人指向铁梯', {
    dialogue: [{ speaker: '黑雨衣女人', text: '你先下去。' }],
  }),
]
const B_SHOTS = [shot('S01', 'B 项目的地下井道里有编号牌')]

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

let browser
try {
  if (!(await waitServer())) throw new Error('临时 dev server 启动失败')

  await api('/api/project?name=A&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '项目 A' }),
  })
  await postProject('A', {
    source: 'A-source：陈默在废土夜市发现妹妹的义体手臂，被黑雨衣女人引向地下井道。',
    style: '近未来科幻写实，冷青低照度',
    episodes: [
      {
        no: 1,
        title: '妹妹的手臂',
        scenes: [
          {
            no: 1,
            slug: '地下井道',
            place: '废土夜市地下井道',
            time: '夜',
            beats: '陈默在井口发现机械义体手臂，黑雨衣女人让他先下去。',
            characters: ['陈默', '黑雨衣女人'],
            intensity: 7,
            tone: '悬疑',
          },
        ],
      },
    ],
    shots: A_SHOTS,
  })
  await api('/api/project?name=B&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '项目 B' }),
  })
  await postProject('B', {
    source: 'B-source：另一条地下井道线索。',
    episodes: [{ no: 1, title: 'B 集', scenes: [{ no: 1, slug: 'B 井道', place: 'B 井道', beats: '编号牌出现' }] }],
    shots: B_SHOTS,
  })

  // 模拟旧设置：只有四个旧规则包，没有 asset
  const cur = await api('/api/settings')
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rules: {
        script: { enabled: true, text: 'OLD-SCRIPT' },
        character: { enabled: true, text: 'OLD-CHARACTER' },
        shot: { enabled: true, text: 'OLD-SHOT' },
        prompt: { enabled: true, text: 'OLD-PROMPT' },
      },
    }),
  })
  check('临时设置已写入旧规则', Boolean(cur.ok))

  const textCalls = []
  const seedCalls = []
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()

  await page.route('**/api/text', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    textCalls.push(body)
    const prompt = String(body.prompt || '')
    const b = /B-source|B 井道|B 项目/.test(prompt)
    const scene = b ? 'B 地下井道' : 'A 地下井道'
    const prop = b ? 'B 编号牌' : 'A 机械义体手臂'
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: {
          scenes: [
            {
              name: scene,
              refs: b ? ['E01-S01'] : ['E01-S01', 'E01-S02'],
              summary_cn: b ? 'B 的井道' : '潮湿的井道，铁梯向下',
              prompt_en: `underground shaft, wet concrete, cold cyan light, ${b ? 'B' : 'A'}`,
              keywords: ['井口', '铁梯'],
            },
          ],
          props: [
            {
              name: prop,
              refs: b ? ['E01-S01'] : ['E01-S02'],
              summary_cn: '剧情关键道具',
              prompt_en: `worn mechanical arm, brass joints, ${b ? 'B' : 'A'}`,
              keywords: ['机械义体'],
            },
          ],
        },
        text: 'mock',
        model: 'mock',
        modelLabel: 'mock',
      }),
    })
  })

  await page.route('**/api/seedream', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    seedCalls.push(body)
    const n = Math.max(1, Number(body.n) || 1)
    const urls = Array.from({ length: n }, (_, i) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#17324a"/><text x="18" y="96" fill="#dff" font-family="sans-serif" font-size="18">mock ${i + 1}</text></svg>`
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, urls, url: urls[0], size: 'mock', elapsed: 0.1 }),
    })
  })

  // 上传段：saveFail 打开时让 /api/save-image 返回失败，用来验证「不写回设定卡」
  let saveFail = false
  await page.route('**/api/save-image', async (route) => {
    if (saveFail) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: '模拟保存失败' }),
      })
      return
    }
    await route.continue()
  })

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  const projectSel = page.locator('.topbar-project select')
  check('默认项目为 A', (await projectSel.inputValue()) === 'A', await projectSel.inputValue())

  // ---- 设置页 ----
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.waitForTimeout(600)
  await page.locator('.st-nav button', { hasText: '技能' }).click()
  await page.locator('[data-skill="asset"]').waitFor({ timeout: 10000 })
  const ruleState = await page.evaluate(() => {
    const card = document.querySelector('[data-skill="asset"]')
    const text = card?.querySelector('textarea')?.value || ''
    return {
      exists: Boolean(card),
      text,
      layoutRule: Boolean(document.querySelector('[data-skill="layout"]')),
    }
  })
  check('设置页显示素材技能', ruleState.exists)
  check('素材技能包含空镜/去重默认文本', /场景按地点去重/.test(ruleState.text) && /空镜/.test(ruleState.text))
  check('设置页不出现布局技能', !ruleState.layoutRule)
  await page.locator('.st-nav button', { hasText: '默认路由' }).click()
  await page.waitForTimeout(300)
  check('设置页显示素材环节模型', (await page.locator('[data-stage-model-select="asset"]').count()) === 1)

  // 旧规则包已迁移为技能；这里不再改写技能正文，直接验证素材页使用内置素材技能
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(500)

  // ---- 素材页：本集拆解 ----
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(700)
  // 上下文带的标题就是「素材」；「素材设定板」是旧标题，已随外壳改版移除
  check('素材页标题存在', (await page.locator('.wb-bar-title').first().innerText()).trim() === '素材')
  check('素材页有场景/道具页签', (await page.getByRole('button', { name: /场景/ }).count()) >= 1)
  check('素材页没有布局页签', (await page.getByRole('button', { name: '布局', exact: true }).count()) === 0)

  textCalls.length = 0
  await page.locator('.wb-bar-actions').getByRole('button', { name: '从本集拆' }).click()
  await waitFor(() => textCalls.length > 0, 5000)
  check('本集拆解调用模型', textCalls.length === 1, String(textCalls.length))
  const extractPrompt = String(textCalls[0]?.prompt || '')
  check('拆解包含无 cast/无台词的镜头', /机械义体手臂/.test(extractPrompt), extractPrompt.slice(0, 220))
  check('拆解使用素材守则', /场景按地点去重/.test(String(textCalls[0]?.system || '')) || /空镜/.test(String(textCalls[0]?.system || '')))
  await page.waitForTimeout(1000)
  let a = await api('/api/project?name=A')
  check('拆出场景与道具写入 A', (a.project?.designs || []).length === 2, String((a.project?.designs || []).length))
  const sceneDesign = (a.project?.designs || []).find((d) => d.kind === 'scene')
  check('场景 refs 合并了多个镜头', (sceneDesign?.refs || []).length === 2, JSON.stringify(sceneDesign?.refs))

  // 再次拆解：不重复、refs 取并集
  await page.locator('.wb-bar-actions').getByRole('button', { name: '从本集拆' }).click()
  await waitFor(() => textCalls.length >= 2, 5000)
  await page.waitForTimeout(900)
  a = await api('/api/project?name=A')
  check('重复拆解不新增重复卡', (a.project?.designs || []).length === 2, String((a.project?.designs || []).length))

  // 编辑英文锚点，再拆一次，验证手改保护
  const sceneCard = page.locator('.design-card').filter({ hasText: 'A 地下井道' }).first()
  await sceneCard.getByRole('button', { name: '编辑', exact: true }).click()
  const promptArea = sceneCard.locator('.char-edit textarea').nth(1)
  await promptArea.fill('EDITED-SCENE-ANCHOR, underground shaft')
  await page.waitForTimeout(1100)
  a = await api('/api/project?name=A')
  check(
    '手改英文锚点已保存',
    (a.project?.designs || []).find((d) => d.kind === 'scene')?.promptEn === 'EDITED-SCENE-ANCHOR, underground shaft',
  )
  await page.locator('.wb-bar-actions').getByRole('button', { name: '从本集拆' }).click()
  await waitFor(() => textCalls.length >= 3, 5000)
  await page.waitForTimeout(900)
  a = await api('/api/project?name=A')
  check(
    '再次拆解保留手改锚点',
    (a.project?.designs || []).find((d) => d.kind === 'scene')?.promptEn === 'EDITED-SCENE-ANCHOR, underground shaft',
  )

  // 空锚点：明确报错且不发请求
  seedCalls.length = 0
  await promptArea.fill('')
  await sceneCard.getByRole('button', { name: /生成设定图|重出设定图/ }).click()
  await page.waitForTimeout(400)
  const emptyAnchorError = await sceneCard.locator('.gen-error').innerText().catch(() => '')
  check('空锚点给出错误且不发请求', /先补英文锚点/.test(emptyAnchorError) && seedCalls.length === 0, emptyAnchorError)

  // ---- 上传设定图（锚点仍为空，验证不依赖英文锚点） ----
  const cardFileInput = sceneCard.locator('input[type=file]')
  check('设定卡有上传入口', (await cardFileInput.count()) === 1, String(await cardFileInput.count()))
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await cardFileInput.setInputFiles({ name: 'uploaded-scene.png', mimeType: 'image/png', buffer: pngBytes })
  await page.waitForTimeout(1400)
  a = await api('/api/project?name=A')
  const uploadedScene = (a.project?.designs || []).find((d) => d.kind === 'scene')
  check(
    '空锚点也能上传且成为当前图',
    Boolean(uploadedScene?.image) && String(uploadedScene.image).startsWith('/project-assets/A/'),
    JSON.stringify({ image: uploadedScene?.image, promptEn: uploadedScene?.promptEn }),
  )
  check('上传图进入候选', (uploadedScene?.candidates || []).includes(uploadedScene?.image), JSON.stringify(uploadedScene?.candidates))
  check(
    '上传不改英文锚点',
    (uploadedScene?.promptEn || '') === '',
    JSON.stringify(uploadedScene?.promptEn),
  )
  check('上传后卡片可加入画布', await sceneCard.getByRole('button', { name: /加入画布|更新画布/ }).isEnabled())

  // 不支持的格式：报错且不改设定卡
  const beforeBadFormat = JSON.stringify((await api('/api/project?name=A')).project?.designs)
  await cardFileInput.setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: Buffer.from('not-a-real-heic'),
  })
  await page.waitForTimeout(700)
  const heicError = await sceneCard.locator('.gen-error').innerText().catch(() => '')
  check('HEIC 被拒并说明支持的格式', /png \/ jpeg \/ webp/.test(heicError), heicError)
  check('HEIC 拒绝后设定卡不变', JSON.stringify((await api('/api/project?name=A')).project?.designs) === beforeBadFormat)

  // 保存失败：只报错，不把地址写进设定卡
  const beforeFail = JSON.stringify((await api('/api/project?name=A')).project?.designs)
  saveFail = true
  await cardFileInput.setInputFiles({ name: 'fail.png', mimeType: 'image/png', buffer: pngBytes })
  await page.waitForTimeout(1400)
  const saveError = await sceneCard.locator('.gen-error').innerText().catch(() => '')
  saveFail = false
  check('保存失败显示错误', /模拟保存失败|保存失败/.test(saveError), saveError)
  check('保存失败后设定卡不变', JSON.stringify((await api('/api/project?name=A')).project?.designs) === beforeFail)

  await promptArea.fill('EDITED-SCENE-ANCHOR, underground shaft')
  await page.waitForTimeout(500)

  // ---- 生成场景空镜 ----
  seedCalls.length = 0
  await sceneCard.getByRole('button', { name: /生成设定图|重出设定图/ }).click()
  await waitFor(() => seedCalls.length > 0, 5000)
  const sceneReq = seedCalls[0] || {}
  check('场景请求 16:9 / 2 张', sceneReq.ratio === '16:9' && sceneReq.n === 2, JSON.stringify({ ratio: sceneReq.ratio, n: sceneReq.n }))
  check('场景请求包含空镜约束', /empty scene plate/.test(String(sceneReq.prompt)) && /no people/.test(String(sceneReq.prompt)))
  check('场景请求带项目画风', /近未来科幻写实/.test(String(sceneReq.prompt)))
  check('场景请求不传角色参考图', !sceneReq.refImages && !sceneReq.image, JSON.stringify({ refImages: sceneReq.refImages, image: sceneReq.image }))
  await page.waitForTimeout(1200)
  check('场景卡出现候选图', (await sceneCard.locator('.cand-dot').count()) === 2)
  check('场景卡显示图片', (await sceneCard.locator('img').count()) >= 1)
  await sceneCard.locator('.cand-dot').nth(1).click()
  await page.waitForTimeout(1100)
  a = await api('/api/project?name=A')
  check('候选切换写回 activeIdx', (a.project?.designs || []).find((d) => d.kind === 'scene')?.activeIdx === 1)

  // 只有场景有图时批量发布：道具应跳过
  await page.getByRole('button', { name: '全部加入画布' }).click()
  await page.waitForTimeout(500)
  const toast1 = await page.locator('.toast').innerText().catch(() => '')
  check('批量发布报告无图跳过', /跳过 1 张无图/.test(toast1), toast1)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(500)
  check('画布只新增场景素材卡', (await page.locator('.asset-node').count()) === 1, String(await page.locator('.asset-node').count()))
  check('素材卡类型为场景', /场景/.test(await page.locator('.asset-node').first().innerText()))

  // ---- 生成道具并单卡发布 ----
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.asset-tabs').getByRole('button', { name: /道具/ }).first().click()
  const propCard = page.locator('.design-card').filter({ hasText: 'A 机械义体手臂' }).first()
  seedCalls.length = 0
  await propCard.getByRole('button', { name: /生成设定图|重出设定图/ }).click()
  await waitFor(() => seedCalls.length > 0, 5000)
  const propReq = seedCalls[0] || {}
  check('道具请求 1:1 / 2 张', propReq.ratio === '1:1' && propReq.n === 2, JSON.stringify({ ratio: propReq.ratio, n: propReq.n }))
  check(
    '道具请求包含多角度/中性背景/无手',
    /prop turnaround sheet/.test(String(propReq.prompt)) &&
      /neutral grey/.test(String(propReq.prompt)) &&
      /no hands/.test(String(propReq.prompt)),
  )
  check('道具请求不传角色参考图', !propReq.refImages && !propReq.image)
  await page.waitForTimeout(1000)
  await propCard.getByRole('button', { name: '加入画布', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(500)
  check('单卡发布后画布有两张素材卡', (await page.locator('.asset-node').count()) === 2, String(await page.locator('.asset-node').count()))

  // 再次全部发布：幂等
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '全部加入画布' }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(500)
  check('重复批量发布不新增卡', (await page.locator('.asset-node').count()) === 2, String(await page.locator('.asset-node').count()))
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(400)
  check('素材页显示两张已在画布', (await page.getByText(/已在画布/).count()) >= 2)

  // 等画布 localStorage 和 assets 回写落盘
  await page.waitForTimeout(1600)

  // 刷新恢复 designId 和已发布状态
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(800)
  a = await api('/api/project?name=A')
  check('刷新后设定数据仍是两张', (a.project?.designs || []).length === 2)
  check('刷新后场景页签恢复一张', (await page.locator('.design-card').count()) === 1)
  check('刷新后场景卡显示已在画布', (await page.getByRole('button', { name: '更新画布', exact: true }).count()) === 1)
  await page.locator('.asset-tabs').getByRole('button', { name: /道具/ }).first().click()
  await page.waitForTimeout(300)
  check('刷新后道具页签恢复一张', (await page.locator('.design-card').count()) === 1)
  check('刷新后道具卡显示已在画布', (await page.getByRole('button', { name: '更新画布', exact: true }).count()) === 1)
  const storedAssets = await page.evaluate(() => {
    const raw = localStorage.getItem('storyboard-canvas-v1:A')
    const p = JSON.parse(raw || '{}')
    return (p.nodes || []).filter((n) => n.type === 'asset').map((n) => n.data)
  })
  check('刷新后画布素材卡保留 designId', storedAssets.length === 2 && storedAssets.every((x) => Boolean(x.designId)), JSON.stringify(storedAssets))
  a = await api('/api/project?name=A')
  check('项目 assets 保留 designId', (a.project?.assets || []).every((x) => Boolean(x.designId)))

  // ---- 发布卡参与镜头参考 ----
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(700)
  const canvasIds = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1:A') || '{}')
    const shot = (p.nodes || []).find((n) => n.type !== 'asset' && n.data?.shotId)
    const asset = (p.nodes || []).find((n) => n.type === 'asset')
    return { shotId: shot?.id, assetId: asset?.id }
  })
  check('画布上找到分镜和发布卡', Boolean(canvasIds.shotId && canvasIds.assetId), JSON.stringify(canvasIds))
  await page.locator(`[data-id="${canvasIds.shotId}"]`).dispatchEvent('contextmenu', {
    clientX: 640,
    clientY: 420,
    button: 2,
  })
  await page.waitForTimeout(400)
  check(
    '分镜右键候选包含发布卡',
    (await page.locator(`.ctx-row[data-ref="${canvasIds.assetId}"]`).count()) === 1,
  )
  await page.locator(`.ctx-row[data-ref="${canvasIds.assetId}"] .ctx-main`).click()
  await page.waitForTimeout(500)
  check(
    '发布卡建立参考连线',
    (await page.locator(`.react-flow__edge[data-id^="ref-${canvasIds.assetId}-${canvasIds.shotId}"]`).count()) === 1,
  )
  await page.locator('.ctx-menu button', { hasText: '关闭' }).click()
  await page.waitForTimeout(300)
  seedCalls.length = 0
  const genShot = page.locator('.inspector button', { hasText: '生成画面' }).first()
  check('镜头 Inspector 生成画面可用', (await genShot.count()) === 1)
  await genShot.click()
  await waitFor(() => seedCalls.length > 0, 5000)
  const shotReq = seedCalls[0] || {}
  const sceneUrl = storedAssets.find((x) => x.kind === 'scene')?.url
  check(
    '镜头生成请求带上发布卡的图',
    Array.isArray(shotReq.refImages) && shotReq.refImages.includes(sceneUrl),
    JSON.stringify(shotReq.refImages),
  )

  // ---- 删除画布卡 → 素材页回到未发布 → 重新加入只生成一张 ----
  await page.locator(`[data-id="${canvasIds.assetId}"]`).dispatchEvent('contextmenu', {
    clientX: 420,
    clientY: 360,
    button: 2,
  })
  await page.waitForTimeout(300)
  await page.locator('.ctx-menu button', { hasText: '关闭' }).click()
  await page.waitForTimeout(200)
  await page.locator('.inspector button', { hasText: '删除素材卡' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(600)
  await page.locator('.asset-tabs').getByRole('button', { name: /场景/ }).first().click()
  await page.waitForTimeout(300)
  check(
    '删除画布卡后场景回到未发布',
    (await page.getByRole('button', { name: '加入画布', exact: true }).count()) === 1,
  )
  await page.getByRole('button', { name: '加入画布', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(500)
  check('重新加入只生成一张', (await page.locator('.asset-node').count()) === 2, String(await page.locator('.asset-node').count()))

  // ---- A/B 隔离 ----
  await projectSel.selectOption('B')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(700)
  check('B 初始没有 A 的设定', (await page.locator('.design-card').count()) === 0)
  await page.locator('.wb-bar-actions').getByRole('button', { name: '从本集拆' }).click()
  await waitFor(() => textCalls.some((c) => /B-source|B 井道|B 项目/.test(String(c.prompt))), 5000)
  await page.waitForTimeout(900)
  const b = await api('/api/project?name=B')
  check('B 拆出自己的设定', (b.project?.designs || []).some((d) => d.name === 'B 地下井道'))
  a = await api('/api/project?name=A')
  check('B 拆解不修改 A 的设定', (a.project?.designs || []).length === 2)
  await projectSel.selectOption('A')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(500)
  check('切回 A 后画布仍有两张素材卡', (await page.locator('.asset-node').count()) === 2)
} catch (e) {
  check('集成测试执行', false, (e && e.message) || String(e))
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
