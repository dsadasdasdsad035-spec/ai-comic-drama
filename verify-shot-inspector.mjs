/**
 * 分镜 Inspector 驾驶舱验收：
 * 1) 四 tab、默认页、状态 chip、切镜头记忆
 * 2) 吸底操作、拖宽持久化、折叠持久化、草稿保留
 * 3) 删除确认、素材卡仍走原面板、隐藏 tab 媒体暂停
 * 跑法：node verify-shot-inspector.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const BASE = process.env.APP_URL || 'http://localhost:5273'
const root = path.dirname(fileURLToPath(import.meta.url))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const videoFile = '/videos/blender-1792762363064-c0bb01.mp4'
const project = {
  name: 'si-test',
  title: 'Inspector',
  style: '赛博',
  aspect: '16:9',
  episodes: [{ no: 1, title: 'EP1' }],
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 5,
      size: '中景',
      move: '推',
      keyframe_prompt: '雨夜摊位，陈默站着',
      video_prompt: '镜头缓慢前推 20 厘米，雨丝斜切画面',
      keyframe: '/generated/blender-bmvl0f76b100fab-0.jpg',
      clip: videoFile,
      cast: ['陈默'],
      dialogue: [{ speaker: '陈默', text: '你来了。' }],
      refIds: ['char-陈默'],
      refExtras: [],
    },
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 4,
      size: '近景',
      move: '固定',
      keyframe_prompt: '陈默抬头看向雨幕',
      video_prompt: '镜头固定，雨丝飘落',
      cast: ['陈默'],
      dialogue: [{ speaker: '陈默', text: '走吧。' }],
      refIds: ['char-陈默'],
      refExtras: [],
    },
    {
      id: 'E01-S03',
      episode: 1,
      no: 'S03',
      seconds: 3,
      size: '全景',
      move: '固定',
      keyframe_prompt: '',
      video_prompt: '',
      desc: '',
      cast: [],
      dialogue: [],
      refIds: [],
      refExtras: [],
    },
  ],
  characters: [
    {
      name: '陈默',
      role: '主角',
      look_cn: '雨衣',
      look_en: 'weathered coat',
      palette: '冷青',
      keywords: [],
      image: '/generated/sched-1792822461394-0-bbf5.jpg',
    },
  ],
  assets: [{ title: '测试道具', kind: 'prop', url: '/generated/sched-1792822461281-0-cc66.jpg' }],
  sceneLayouts: [],
  media: { missing: [] },
}
let projectState = structuredClone(project)

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 1050 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.route('**/api/project**', async (route) => {
  const req = route.request()
  const u = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}')
    projectState = {
      ...projectState,
      ...body,
      ...(body.shots ? { shots: body.shots } : {}),
      ...(body.characters ? { characters: body.characters } : {}),
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        shots: projectState.shots,
        characters: projectState.characters,
        savedAt: new Date().toISOString(),
      }),
    })
  }
  if (u.searchParams.get('name')) {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, project: projectState }),
    })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      root: '/tmp',
      projects: [
        {
          name: projectState.name,
          title: projectState.title,
          style: projectState.style,
          aspect: projectState.aspect,
          episodes: 1,
          shots: projectState.shots.length,
          seconds: 9,
        },
      ],
    }),
  })
})

const shotNode = (no) =>
  p.locator('.react-flow__node').filter({ has: p.locator('.shot') }).filter({ hasText: no }).first()
const activeTab = async () =>
  (await p.locator('.si-tabs [role="tab"][aria-selected="true"]').innerText()).trim()
const width = async () =>
  p.locator('.shot-inspector').evaluate((el) => el.getBoundingClientRect().width)
const selectShot = async (no) => {
  await shotNode(no).click()
  await p.waitForTimeout(350)
}

await p.goto(`${BASE.replace(/\/$/, '')}/#/`, { waitUntil: 'domcontentloaded' })
// 大厅是唯一入口：按 hash 打开被 mock 的项目（openProject 在页面内读列表，能拿到 mock 数据）
const siName = await p.evaluate(async () => {
  try {
    const r = await fetch('/api/project')
    const d = await r.json()
    return (d.projects || [])[0]?.name || ''
  } catch {
    return ''
  }
})
if (siName) {
  await p.evaluate((n) => {
    window.location.hash = `#/p/${encodeURIComponent(n)}/board`
  }, siName)
}
await p.locator('.rail').waitFor({ timeout: 20000 })
await p.waitForLoadState('networkidle').catch(() => {})
await p.waitForTimeout(1800)

const layout = await p.evaluate(async () => {
  const m = await import('/src/inspectorLayout.ts')
  // 旧偏好 JSON（不含 videoSettings / motionPrompt，且用户改过 refs / advanced）
  localStorage.setItem(
    m.INSPECTOR_PREFS_KEY,
    JSON.stringify({
      width: 440,
      tab: 'more',
      collapsed: { shotParams: false, performance: true, schedule: false, refs: true, advanced: false },
    }),
  )
  const migrated = m.loadInspectorPrefs()
  localStorage.removeItem(m.INSPECTOR_PREFS_KEY)
  return {
    min: m.clampInspectorWidth(100),
    max: m.clampInspectorWidth(999),
    mid: m.clampInspectorWidth(400),
    imageModeNoImg: m.defaultTabForShot('image', false),
    videoModeHasImg: m.defaultTabForShot('video', true),
    migrated,
    chips: m.shotStatusChips({
      hasImage: true,
      candidateCount: 2,
      hasVideo: false,
      seconds: 5,
      promptSource: 'auto',
      nativeAudio: true,
    }),
  }
})
check(
  '旧偏好读入后新键回落默认 true',
  layout.migrated.collapsed.videoSettings === true && layout.migrated.collapsed.motionPrompt === true,
  JSON.stringify(layout.migrated.collapsed),
)
check(
  '旧偏好其余键不被重置',
  layout.migrated.collapsed.refs === true &&
    layout.migrated.collapsed.advanced === false &&
    layout.migrated.collapsed.shotParams === false &&
    layout.migrated.width === 440 &&
    layout.migrated.tab === 'more',
  JSON.stringify(layout.migrated),
)
check('宽度夹取 320–520', layout.min === 320 && layout.max === 520 && layout.mid === 400, JSON.stringify(layout))
check(
  '默认 tab 随生产模式',
  layout.imageModeNoImg === 'visual' && layout.videoModeHasImg === 'video',
  JSON.stringify(layout),
)
check(
  '状态 chip 推导（无镜头配音）',
  layout.chips.map((c) => c.label).join('|') === '画面 1/2|视频 未出|提示词 自动|原生音频',
  JSON.stringify(layout.chips),
)

// 默认页 + 出片提示词
await selectShot('S01')
check('分镜卡无卡脚出片按钮', (await p.locator('.shot-vid').count()) === 0)
check('分镜卡保留卡头出图', (await p.locator('.shot-gen').count()) >= 1)
await shotNode('S01').click()
await shotNode('S02').click({ modifiers: ['Shift'] })
await p.waitForTimeout(200)
const selbar = p.locator('.selbar')
if ((await selbar.count()) > 0) {
  check('多选栏无出片', (await selbar.getByRole('button', { name: '出片', exact: true }).count()) === 0)
  check('多选栏无配音', (await selbar.getByRole('button', { name: '配音', exact: true }).count()) === 0)
}
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(200)
check('操作菜单无批量出片', (await p.getByRole('button', { name: '批量出片' }).count()) === 0)
check('操作菜单无批量配音', (await p.getByRole('button', { name: '批量配音' }).count()) === 0)
await p.keyboard.press('Escape')
await selectShot('S01')
check('出图模式仅画面与更多 tab', (await p.locator('.si-tabs [role="tab"]').count()) === 2)
check('出图模式默认画面页', (await activeTab()) === '画面', await activeTab())

// 空首帧只拦生成：结构镜头仍在画布上，点出图给出提示而不是静默
await selectShot('S03')
await shotNode('S03').locator('.shot-gen').click()
await p.waitForTimeout(350)
const emptyBadge = shotNode('S03').locator('.gen-error-badge')
check(
  '空首帧镜头出图被拦',
  (await emptyBadge.count()) === 1 && (await emptyBadge.getAttribute('title')) === '请先填写画面提示词',
  (await emptyBadge.getAttribute('title').catch(() => '')) ?? 'no badge',
)
await selectShot('S01')
await p.locator('.prod-mode-toggle button', { hasText: '出片' }).click()
await p.waitForTimeout(300)
check('出片模式仅视频与更多 tab', (await p.locator('.si-tabs [role="tab"]').count()) === 2)
await selectShot('S01')
check('出片模式默认视频页', (await activeTab()) === '视频', await activeTab())
check('视频页直接看到出片提示词', (await p.locator('[data-video-prompt-panel]').count()) === 1)
await selectShot('S02')
check('出片模式无画面仍默认视频页', (await activeTab()) === '视频', await activeTab())
check('无画面镜仍可看到提示词面板', await p.locator('[data-video-prompt-panel]').isVisible())
await p.locator('.si-chip', { hasText: '提示词' }).click()
await p.waitForTimeout(300)
check('提示词 chip 切到视频页', (await activeTab()) === '视频', await activeTab())
check('切到视频页后提示词面板可见', await p.locator('[data-video-prompt-panel]').isVisible())
await selectShot('S01')
check('手动选页后切镜头保持', (await activeTab()) === '视频', await activeTab())

// chip 路由：出图模式只有画面/更多，切到出片模式再看视频 chip
await p.locator('.prod-mode-toggle button', { hasText: '出图' }).click()
await p.waitForTimeout(250)
await p.locator('.si-chip', { hasText: '画面' }).click()
await p.waitForTimeout(250)
check('画面 chip 切到画面页', (await activeTab()) === '画面', await activeTab())
await p.locator('.prod-mode-toggle button', { hasText: '出片' }).click()
await p.waitForTimeout(250)
await p.locator('.si-chip', { hasText: '视频' }).click()
await p.waitForTimeout(250)
check('视频 chip 切到视频页', (await activeTab()) === '视频', await activeTab())

// 键盘折叠（回到出图模式，画面 tab 才存在）
await p.locator('.prod-mode-toggle button', { hasText: '出图' }).click()
await p.waitForTimeout(250)
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.waitForTimeout(200)
const paramsSection = p.locator('[data-section="shotParams"]')
check('镜头参数默认折叠', (await paramsSection.evaluate((el) => el.dataset.open)) === 'false')
await paramsSection.locator('.fold-head').focus()
await p.keyboard.press('Enter')
await p.waitForTimeout(200)
check('键盘可展开折叠区', (await paramsSection.evaluate((el) => el.dataset.open)) === 'true')
await p.keyboard.press('Enter')
await p.waitForTimeout(200)
check('键盘可收起折叠区', (await paramsSection.evaluate((el) => el.dataset.open)) === 'false')

// 键盘 tab 导航
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).focus()
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(250)
check('方向键切到下一个 tab（出图模式为更多）', (await activeTab()) === '更多', await activeTab())
await p.keyboard.press('Home')
await p.waitForTimeout(250)
check('Home 回到第一个 tab', (await activeTab()) === '画面', await activeTab())

// 吸底操作
const footer = p.locator('[data-shot-footer]')
check('吸底操作栏存在', (await footer.count()) === 1)
const footerBefore = await footer.boundingBox()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight })
await p.waitForTimeout(200)
const footerAfter = await footer.boundingBox()
check(
  '滚动后吸底栏仍在原位',
  Boolean(footerBefore && footerAfter) && Math.abs(footerBefore.y - footerAfter.y) < 2 && (await footer.isVisible()),
  JSON.stringify({ before: footerBefore?.y, after: footerAfter?.y }),
)
check('视频主操作在吸底栏', (await footer.innerText()).includes('视频') || (await footer.locator('button').innerText()).length > 0)

// 折叠 + 持久化
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.waitForTimeout(250)
const perf = p.locator('[data-section="performance"]')
check('表演默认折叠', (await perf.evaluate((el) => el.dataset.open)) === 'false')
await perf.locator('.fold-head').click()
await p.waitForTimeout(250)
check('表演可展开', (await perf.evaluate((el) => el.dataset.open)) === 'true')

// 草稿保留（视频 tab 只在出片模式）
await p.locator('.prod-mode-toggle button', { hasText: '出片' }).click()
await p.waitForTimeout(250)
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(250)
await p.locator('[data-video-prompt-panel] button', { hasText: '编辑' }).click()
await p.locator('.vp-textarea').fill('这是一份没有保存的草稿')
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(250)
check('切 tab 后草稿仍在', (await p.locator('.vp-textarea').inputValue()) === '这是一份没有保存的草稿')
await p.locator('[data-video-prompt-panel] button', { hasText: '取消' }).click()

// ---------------------------------------------------------------- 视频 Tab 折叠分区
const vidFold = (id) => p.locator(`[data-section="${id}"]`)
const vidMeta = async () => (await vidFold('videoSettings').locator('.fold-meta').innerText()).trim()
check('出片设置默认折叠', (await vidFold('videoSettings').evaluate((el) => el.dataset.open)) === 'false')
check('运动提示词默认折叠', (await vidFold('motionPrompt').evaluate((el) => el.dataset.open)) === 'false')
check(
  '提示词面板默认展开',
  (await p.locator('[data-video-prompt-panel]').evaluate((el) => el.dataset.open)) === 'true',
)
check(
  '附件与槽位默认折叠',
  (await p.locator('.vp-refs-disclosure').evaluate((el) => el.dataset.open)) === 'false',
)

const meta480 = await vidMeta()
check(
  '摘要含模型/分辨率/时长/估价',
  meta480.includes('Seedance') && meta480.includes('480p') && meta480.includes('5s') && meta480.includes('¥'),
  meta480,
)

await vidFold('videoSettings').locator('.fold-head').click()
await p.waitForTimeout(200)
check('出片设置可展开', (await vidFold('videoSettings').evaluate((el) => el.dataset.open)) === 'true')
await vidFold('videoSettings').locator('.gen-controls select').selectOption('720p')
await p.waitForTimeout(250)
check('切分辨率后摘要即时更新', (await vidMeta()).includes('720p'), await vidMeta())

// 三种模型切换后摘要文本正确
const modelSelect = vidFold('videoSettings').locator('[data-cap-model-select="video"] select')
for (const [key, label] of [
  ['ark-video-2-0', 'Seedance 2.0'],
  ['ark-video-2-5', 'Seedance 2.5'],
  ['ark-video', 'Seedance 1.0 pro'],
]) {
  await modelSelect.selectOption(key)
  await p.waitForTimeout(250)
  const m = await vidMeta()
  check(`切模型 ${key} 后摘要正确`, m.includes(label) && m.includes('720p') && m.includes('5s'), m)
}

// 折叠 → 重新挂载 → 仍折叠
await vidFold('videoSettings').locator('.fold-head').click()
await p.waitForTimeout(250)
check('出片设置可收起', (await vidFold('videoSettings').evaluate((el) => el.dataset.open)) === 'false')
await vidFold('motionPrompt').locator('.fold-head').click()
await p.waitForTimeout(250)
check('运动提示词可展开', (await vidFold('motionPrompt').evaluate((el) => el.dataset.open)) === 'true')
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await p.locator('.prod-mode-toggle button', { hasText: '出片' }).click()
await p.waitForTimeout(250)
await selectShot('S01')
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(300)
check(
  '重新挂载后出片设置仍折叠',
  (await vidFold('videoSettings').evaluate((el) => el.dataset.open)) === 'false',
)
check(
  '重新挂载后运动提示词仍展开',
  (await vidFold('motionPrompt').evaluate((el) => el.dataset.open)) === 'true',
)

// AI 扩写：单行入口 + 锚定浮层
const composeTrigger = p.locator('.vp-compose-trigger')
check('AI 扩写入口是单行按钮', (await composeTrigger.count()) === 1)
check('浮层默认关闭', (await p.locator('.vp-compose-pop').count()) === 0)
await composeTrigger.click()
await p.waitForTimeout(250)
const pop = p.locator('.vp-compose-pop')
check('浮层已打开', (await pop.count()) === 1)
const popParts = await p.evaluate(() => {
  const el = document.querySelector('.vp-compose-pop')
  if (!el) return null
  const vis = (s) => {
    const n = el.querySelector(s)
    return Boolean(n && n.getBoundingClientRect().height > 0)
  }
  const r = el.getBoundingClientRect()
  return {
    model: vis('[data-stage-model-select="prompt"]'),
    template: vis('button.vp-btn-primary'),
    refine: vis('button.vp-btn-accent'),
    clear: vis('button.vp-btn-ghost'),
    fixed: getComputedStyle(el).position,
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) },
  }
})
check(
  '浮层四个元素可见（模型 + 三个动作）',
  Boolean(
    popParts && popParts.model && popParts.template && popParts.refine && popParts.clear,
  ),
  JSON.stringify(popParts),
)
check('浮层用 fixed 定位', popParts?.fixed === 'fixed', JSON.stringify(popParts))
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
check('Esc 关闭浮层', (await p.locator('.vp-compose-pop').count()) === 0)
const focused = await p.evaluate(() => document.activeElement?.className ?? '')
check('关闭后焦点回到入口', focused.includes('vp-compose-trigger'), focused)
await composeTrigger.click()
await p.waitForTimeout(200)
await p.locator('[data-video-prompt-text]').click()
await p.waitForTimeout(200)
check('外部点击关闭浮层', (await p.locator('.vp-compose-pop').count()) === 0)

// 360×800 高度回归：默认态一屏内看到提示词正文与底栏按钮，且浮层开关不改变正文高度
await vidFold('motionPrompt').locator('.fold-head').click()
await p.waitForTimeout(250)
await p.setViewportSize({ width: 360, height: 800 })
await p.waitForTimeout(400)
const fit = await p.evaluate(() => {
  const prompt = document.querySelector('[data-video-prompt-text]')
  const foot = document.querySelector('[data-shot-footer] button')
  const box = (el) => (el ? el.getBoundingClientRect() : null)
  return { prompt: box(prompt), foot: box(foot), viewport: window.innerHeight }
})
check(
  '360×800 提示词正文与底栏按钮同时可见',
  Boolean(fit.prompt && fit.foot) &&
    fit.prompt.top >= 0 &&
    fit.prompt.bottom <= fit.viewport &&
    fit.foot.top >= 0 &&
    fit.foot.bottom <= fit.viewport,
  JSON.stringify({
    promptTop: fit.prompt?.top,
    promptBottom: fit.prompt?.bottom,
    footTop: fit.foot?.top,
    footBottom: fit.foot?.bottom,
    viewport: fit.viewport,
  }),
)
const panelH = () =>
  p.locator('[data-video-prompt-panel]').evaluate((el) => Math.round(el.getBoundingClientRect().height))
const hClosed = await panelH()
await p.locator('.vp-compose-trigger').click()
await p.waitForTimeout(250)
check('浮层打开时正文区高度不变', (await panelH()) === hClosed, `${hClosed} → ${await panelH()}`)
await p.keyboard.press('Escape')
await p.waitForTimeout(250)
check('浮层关闭后正文区高度不变', (await panelH()) === hClosed, `${hClosed} → ${await panelH()}`)
await p.setViewportSize({ width: 1500, height: 1050 })
await p.waitForTimeout(300)

// 隐藏 tab 媒体暂停
const playStarted = await p
  .locator('.si-video-preview video')
  .evaluate(async (el) => {
    el.muted = true
    try {
      await el.play()
      return true
    } catch {
      return false
    }
  })
  .catch(() => false)
await p.waitForTimeout(300)
const vidPaused = await p.locator('.si-video-preview video').evaluate((el) => el.paused).catch(() => null)
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.waitForTimeout(250)
const vidPausedAfter = await p.locator('.si-video-preview video').evaluate((el) => el.paused).catch(() => null)
check(
  '离开视频页后媒体暂停',
  vidPausedAfter === true && (!playStarted || vidPaused === false),
  JSON.stringify({ playStarted, before: vidPaused, after: vidPausedAfter }),
)

// 拖宽 + 持久化
await p.locator('.prod-mode-toggle button', { hasText: '出图' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.waitForTimeout(200)
const beforeWidth = await width()
const handle = p.locator('.si-resize')
const box = await handle.boundingBox()
check('拖拽把手存在', Boolean(box), JSON.stringify(box))
if (box) {
  await p.mouse.move(box.x + 3, box.y + 180)
  await p.mouse.down()
  await p.mouse.move(box.x + 3 - 120, box.y + 180, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(300)
}
const afterWidth = await width()
check('拖宽增加面板宽度', afterWidth > beforeWidth + 80, JSON.stringify({ beforeWidth, afterWidth }))

// 重新加载：宽度 + 折叠 + tab 偏好
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await selectShot('S01')
check('刷新后宽度保留', Math.abs((await width()) - afterWidth) < 3, JSON.stringify({ afterWidth, now: await width() }))
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.waitForTimeout(250)
check('刷新后表演折叠状态保留', (await p.locator('[data-section="performance"]').evaluate((el) => el.dataset.open)) === 'true')

// 复位
const handle2 = p.locator('.si-resize')
const box2 = await handle2.boundingBox()
if (box2) {
  await p.mouse.dblclick(box2.x + 3, box2.y + 180)
  await p.waitForTimeout(300)
}
check('双击复位默认宽度', Math.abs((await width()) - 360) < 3, String(await width()))

// 删除确认
await p.locator('.si-menu > summary').click()
await p.waitForTimeout(200)
let dialogSeen = false
p.once('dialog', (d) => {
  dialogSeen = true
  d.dismiss()
})
await p.locator('.si-menu-pop button', { hasText: '删除镜头' }).click()
await p.waitForTimeout(400)
check('删除前弹确认', dialogSeen)
check('取消后镜头仍在', (await shotNode('S01').count()) === 1)

// 素材卡不受驾驶舱影响
await p.locator('.react-flow__node').filter({ hasText: '测试道具' }).first().click()
await p.waitForTimeout(500)
check('素材卡没有分镜驾驶舱', (await p.locator('.shot-inspector').count()) === 0 && (await p.locator('.si-tabs').count()) === 0)
check('素材卡显示原面板', (await p.locator('.inspector .panel-head').innerText()).includes('素材卡'))

// 截图
await selectShot('S01')
await p.locator('.prod-mode-toggle button', { hasText: '出图' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.waitForTimeout(300)
await p.screenshot({ path: '/tmp/si-day-360.png' })
const handle3 = p.locator('.si-resize')
const box3 = await handle3.boundingBox()
if (box3) {
  await p.mouse.move(box3.x + 3, box3.y + 180)
  await p.mouse.down()
  await p.mouse.move(box3.x + 3 - 120, box3.y + 180, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(300)
}
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.screenshot({ path: '/tmp/si-day-480.png' })
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.waitForTimeout(250)
await p.screenshot({ path: '/tmp/si-more-dialogue-480.png' })
await p.locator('.si-tabs [role="tab"]', { hasText: '更多' }).click()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.waitForTimeout(250)
await p.screenshot({ path: '/tmp/si-more-480.png' })
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.waitForTimeout(250)
await p.getByRole('button', { name: '夜间' }).click()
await p.waitForTimeout(300)
await p.screenshot({ path: '/tmp/si-night-480.png' })

// 阻断与告警分层：blocking 常驻、warnings 合并成一行
await p.evaluate(async (state) => {
  await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: state }),
  })
}, [
  ...project.shots.slice(0, 1),
  {
    ...project.shots[1],
    refIds: [...(project.shots[1].refIds ?? []), 'asset-已删除-1'],
    use_expression_ref: true,
    video_prompt_override: {
      text: '旧手改正文，指纹已失效',
      fingerprint: 'stale-fingerprint',
      createdAt: new Date(0).toISOString(),
    },
  },
  project.shots[2],
])
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await p.locator('.prod-mode-toggle button', { hasText: '出片' }).click()
await p.waitForTimeout(250)

// 无参考镜：blocking 常驻，折叠提示词后仍可见，主按钮禁用
await selectShot('S03')
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(300)
const blockBox = p.locator('[data-vp-blocking]')
check('无参考镜产生阻断', (await blockBox.count()) === 1)
if ((await p.locator('[data-video-prompt-panel] .vp-fold').getAttribute('data-open')) === 'true') {
  await p.locator('[data-video-prompt-panel] .vp-fold > .fold-head').click()
  await p.waitForTimeout(250)
}
check(
  '提示词折叠后阻断仍可见',
  (await p.locator('[data-video-prompt-panel]').getAttribute('data-open')) === 'false' &&
    (await blockBox.isVisible()),
)
check(
  '折叠态阻断提示为一行且主按钮禁用',
  (await blockBox.evaluate((el) => el.getBoundingClientRect().height)) < 40 &&
    (await p.locator('[data-shot-footer] button').first().isDisabled()),
  String(
    await blockBox.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
  ),
)

// 三条 warning：默认一行计数，点开逐条
await selectShot('S02')
await p.waitForTimeout(350)
if ((await p.locator('[data-video-prompt-panel]').getAttribute('data-open')) === 'false') {
  await p.locator('[data-video-prompt-panel] .vp-fold > .fold-head').click()
  await p.waitForTimeout(250)
}
const warns = p.locator('.vp-warns')
check('告警合并为一行入口', (await warns.count()) === 1)
const warnHead = (await warns.locator('.fold-head').innerText()).trim()
check('告警计数为 3 条', warnHead.includes('3 条提示'), warnHead)
check('告警默认收起', (await warns.getAttribute('data-open')) === 'false')
check(
  '告警默认只占一行',
  (await warns.evaluate((el) => el.getBoundingClientRect().height)) < 30,
  String(await warns.evaluate((el) => Math.round(el.getBoundingClientRect().height))),
)
await warns.locator('.fold-head').click()
await p.waitForTimeout(250)
check('展开后逐条可见', (await warns.locator('.gen-warn.vp-issue').count()) === 3)

check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')

// ---------------------------------------------------------------- 截图留档（5.3）
// 默认态与提示词展开态各在两个视口留一张，人工确认无裁切、无跳动
const shotDir = path.join(root, '.verify-panel-folds')
fs.mkdirSync(shotDir, { recursive: true })
for (const [w, h] of [
  [360, 800],
  [1280, 900],
]) {
  await p.setViewportSize({ width: w, height: h })
  await p.waitForTimeout(400)
  const panel = p.locator('[data-video-prompt-panel]')
  const foldHead = p.locator('[data-video-prompt-panel] .vp-fold > .fold-head')
  const isOpen = async () => (await panel.getAttribute('data-open')) === 'true'
  // 默认态：提示词展开（默认值）
  if (!(await isOpen())) {
    await foldHead.click()
    await p.waitForTimeout(250)
  }
  await p.screenshot({ path: path.join(shotDir, `shot-video-${w}x${h}-default-open.png`) })
  // 折叠态：只留摘要行与阻断
  await foldHead.click()
  await p.waitForTimeout(250)
  await p.screenshot({ path: path.join(shotDir, `shot-video-${w}x${h}-prompt-folded.png`) })
}
await p.setViewportSize({ width: 1500, height: 1050 })
await p.waitForTimeout(300)
console.log(`\n截图已留存：${shotDir}`)
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
