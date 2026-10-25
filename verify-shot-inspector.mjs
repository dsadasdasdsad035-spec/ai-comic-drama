/**
 * 分镜 Inspector 驾驶舱验收：
 * 1) 四 tab、默认页、状态 chip、切镜头记忆
 * 2) 吸底操作、拖宽持久化、折叠持久化、草稿保留
 * 3) 删除确认、素材卡仍走原面板、隐藏 tab 媒体暂停
 * 跑法：node verify-shot-inspector.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.APP_URL || 'http://localhost:5273'
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

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1800)

const layout = await p.evaluate(async () => {
  const m = await import('/src/inspectorLayout.ts')
  return {
    min: m.clampInspectorWidth(100),
    max: m.clampInspectorWidth(999),
    mid: m.clampInspectorWidth(400),
    noImage: m.defaultTabForShot(false),
    image: m.defaultTabForShot(true),
    chips: m.shotStatusChips({
      hasImage: true,
      candidateCount: 2,
      hasVideo: false,
      seconds: 5,
      voiceUrl: undefined,
      promptSource: 'auto',
      nativeAudio: true,
    }),
  }
})
check('宽度夹取 320–520', layout.min === 320 && layout.max === 520 && layout.mid === 400, JSON.stringify(layout))
check('默认 tab 按画面状态推导', layout.noImage === 'visual' && layout.image === 'video', JSON.stringify(layout))
check(
  '状态 chip 推导',
  layout.chips.map((c) => c.label).join('|') === '画面 1/2|视频 未出|配音 未生成|提示词 自动|原生音频',
  JSON.stringify(layout.chips),
)

// 默认页 + 出片提示词
await selectShot('S01')
check('四个 tab 都在', (await p.locator('.si-tabs [role="tab"]').count()) === 4)
check('有画面的镜头默认视频页', (await activeTab()) === '视频', await activeTab())
check('视频页直接看到出片提示词', (await p.locator('[data-video-prompt-panel]').count()) === 1)
await selectShot('S02')
check('无画面的镜头默认画面页', (await activeTab()) === '画面', await activeTab())
check('无画面时提示词面板不占视频页外空间', !(await p.locator('[data-video-prompt-panel]').isVisible().catch(() => false)))
await p.locator('.si-chip', { hasText: '提示词' }).click()
await p.waitForTimeout(300)
check('提示词 chip 切到视频页', (await activeTab()) === '视频', await activeTab())
check('切到视频页后提示词面板可见', await p.locator('[data-video-prompt-panel]').isVisible())
await selectShot('S01')
check('手动选页后切镜头保持', (await activeTab()) === '视频', await activeTab())

// chip 路由
await p.locator('.si-chip', { hasText: '配音' }).click()
await p.waitForTimeout(250)
check('配音 chip 切到声音页', (await activeTab()) === '声音', await activeTab())
await p.locator('.si-chip', { hasText: '画面' }).click()
await p.waitForTimeout(250)
check('画面 chip 切到画面页', (await activeTab()) === '画面', await activeTab())
await p.locator('.si-chip', { hasText: '视频' }).click()
await p.waitForTimeout(250)
check('视频 chip 切到视频页', (await activeTab()) === '视频', await activeTab())

// 键盘折叠
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.waitForTimeout(200)
const paramsSection = p.locator('[data-section="shotParams"]')
check('镜头参数默认折叠', (await paramsSection.evaluate((el) => el.open)) === false)
await paramsSection.locator('summary').focus()
await p.keyboard.press('Enter')
await p.waitForTimeout(200)
check('键盘可展开折叠区', (await paramsSection.evaluate((el) => el.open)) === true)
await p.keyboard.press('Enter')
await p.waitForTimeout(200)
check('键盘可收起折叠区', (await paramsSection.evaluate((el) => el.open)) === false)

// 键盘 tab 导航
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '画面' }).focus()
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(250)
check('方向键切到下一个 tab', (await activeTab()) === '视频', await activeTab())
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
await p.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
await p.waitForTimeout(250)
const perf = p.locator('[data-section="performance"]')
check('表演默认折叠', (await perf.evaluate((el) => el.open)) === false)
await perf.locator('summary').click()
await p.waitForTimeout(250)
check('表演可展开', (await perf.evaluate((el) => el.open)) === true)

// 草稿保留
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(250)
await p.locator('[data-video-prompt-panel] button', { hasText: '编辑' }).click()
await p.locator('.vp-textarea').fill('这是一份没有保存的草稿')
await p.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
await p.waitForTimeout(200)
await p.locator('.si-tabs [role="tab"]', { hasText: '视频' }).click()
await p.waitForTimeout(250)
check('切 tab 后草稿仍在', (await p.locator('.vp-textarea').inputValue()) === '这是一份没有保存的草稿')
await p.locator('[data-video-prompt-panel] button', { hasText: '取消' }).click()

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
await p.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
await p.waitForTimeout(250)
const vidPausedAfter = await p.locator('.si-video-preview video').evaluate((el) => el.paused).catch(() => null)
check(
  '离开视频页后媒体暂停',
  vidPausedAfter === true && (!playStarted || vidPaused === false),
  JSON.stringify({ playStarted, before: vidPaused, after: vidPausedAfter }),
)

// 拖宽 + 持久化
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
await p.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
await p.waitForTimeout(250)
check('刷新后表演折叠状态保留', (await p.locator('[data-section="performance"]').evaluate((el) => el.open)) === true)

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
await p.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.waitForTimeout(250)
await p.screenshot({ path: '/tmp/si-audio-480.png' })
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

check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
