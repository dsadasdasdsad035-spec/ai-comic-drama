/**
 * 出片提示词预览/手改验收：
 * 1) 拼装器单测：参考顺序、4 张上限、调度帧去冲突、视频参考、原生音频、指纹、阻止项
 * 2) UI：面板可见、预览与请求逐字一致、手改保存/刷新保留/旧快照/重新拼装、来源记录
 * 跑法：node verify-video-prompt-preview.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.APP_URL || 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const shot = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '推',
  keyframe_prompt: '雨夜摊位，陈默站着',
  video_prompt: '镜头缓慢前推 20 厘米，雨丝斜切画面',
  keyframe: '/generated/probe-frame.jpg',
  cast: ['陈默'],
  dialogue: [{ speaker: '陈默', text: '你来了。' }],
  refIds: ['char-陈默'],
  refExtras: ['/generated/probe-prop.jpg'],
}
let projectState = {
  name: 'vp-test',
  title: 'VP',
  style: '赛博',
  aspect: '16:9',
  episodes: [{ no: 1, title: 'EP1' }],
  shots: [shot],
  characters: [
    {
      name: '陈默',
      role: '主角',
      look_cn: '雨衣',
      look_en: 'weathered coat',
      palette: '冷青',
      keywords: [],
      image: '/generated/probe-char.jpg',
      voice_sample: { url: '/voices/probe-chen.wav', seconds: 6, stale: false },
    },
  ],
  assets: [],
  sceneLayouts: [],
  media: { missing: [] },
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
const posts = []
let taskNo = 0
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
          seconds: 5,
        },
      ],
    }),
  })
})
await p.route('**/api/seedance**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}')
    posts.push(body)
    taskNo++
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: `fake-${taskNo}`, mode: 'ref' }),
    })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: `/videos/fake-${taskNo}.mp4` }),
  })
})

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1800)

// ---------------------------------------------------------------- 拼装器单测
const unit = await p.evaluate(async () => {
  const m = await import('/src/videoPrompt.ts')
  const schedule = {
    scene: { w: 10, h: 10, sceneSlug: '场1' },
    blocking: { keys: [] },
    duration: 5,
    ready: true,
    status: '生效',
    reason: '',
  }
  const baseChar = {
    id: '陈默',
    name: '陈默',
    role: '主角',
    lookCn: '',
    lookEn: 'weathered coat',
    palette: '',
    keywords: [],
    image: '/generated/char.jpg',
    voiceSample: { url: '/voices/chen.wav', seconds: 6, stale: false },
  }
  const nodes = [
    {
      id: 'n1',
      type: 'shot',
      position: { x: 0, y: 0 },
      data: {
        no: 'S01',
        seconds: 5,
        size: '中景',
        move: '推',
        dialogue: '陈默：你来了。',
        prompt: '画面',
        marks: [],
        refImage: '/generated/a.jpg',
        refIds: ['char-陈默'],
        refExtras: ['/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg', '/f.jpg'],
      },
    },
  ]
  const basic = m.buildShotVideoRequest({
    data: nodes[0].data,
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v', model: 'seedance-1-0-pro', providerKind: 'ark' },
    resolution: '720p',
  })
  const frames = m.buildShotVideoRequest({
    data: {
      ...nodes[0].data,
      refExtras: [],
      useScheduleFrames: true,
      scheduleFrames: ['/s1.jpg', '/s2.jpg'],
    },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v', model: 'seedance-1-0-pro' },
  })
  const video = m.buildShotVideoRequest({
    data: {
      ...nodes[0].data,
      refExtras: [],
      useScheduleVideoRef: true,
      scheduleVideo: '/videos/3d.mp4',
    },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v', model: 'seedance-2-5', supportsVideoRef: false },
  })
  const native = m.buildShotVideoRequest({
    data: { ...nodes[0].data, refExtras: [], audioMode: 'native' },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v', model: 'seedance-2.5', providerKind: 'apimart', audioOut: true },
  })
  const prevNodes = [
    {
      id: 'n0',
      type: 'shot',
      position: { x: 0, y: 0 },
      data: { no: 'S00', seconds: 5, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [] },
    },
    { ...nodes[0], data: { ...nodes[0].data, refExtras: [], refIds: ['shot-prev'] } },
  ]
  const neighbor = m.buildShotVideoRequest({
    data: prevNodes[1].data,
    nodeId: 'n1',
    nodes: prevNodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v' },
  })
  const fpA = m.buildShotVideoRequest({
    data: { ...nodes[0].data, refExtras: ['/b.jpg'] },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v' },
  })
  const fpB = m.buildShotVideoRequest({
    data: { ...nodes[0].data, refExtras: ['/c.jpg'] },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v' },
  })
  const noOverride = m.effectiveVideoPrompt(basic, undefined)
  const stale = m.effectiveVideoPrompt(basic, { text: '手改', fingerprint: 'nope', createdAt: '' })
  const same = m.effectiveVideoPrompt(basic, {
    text: '手改',
    fingerprint: basic.fingerprint,
    createdAt: '',
  })
  return { basic, frames, video, native, neighbor, fpA, fpB, noOverride, stale, same }
})

const { basic, frames, video, native, neighbor, fpA, fpB } = unit
const sync = await p.evaluate(async () => {
  const m = await import('/src/shotSync.ts')
  const base = { no: 'S01', seconds: 5, size: '中景', move: '推', dialogue: '', prompt: '', marks: [] }
  const old = {
    id: 'x',
    video_prompt: '旧',
    video_prompt_override: { text: '手改', fingerprint: 'f', createdAt: '' },
    handEdited: ['video_prompt_override'],
  }
  const gen = { id: 'x', video_prompt: '新' }
  return {
    merged: m.mergeGenerated([old], [gen])[0],
    cleared: m.mergeGenerated([{ ...old, video_prompt_override: null }], [gen])[0],
    wrote: m.nodeToShot(base, 'x').video_prompt_override,
    read: m.shotToData({ id: 'x', video_prompt_override: null }, base).videoPromptOverride,
  }
})
check('重新生成保留手改正文、其他字段可更新', sync.merged.video_prompt === '新' && sync.merged.video_prompt_override?.text === '手改', JSON.stringify(sync.merged))
check('清除后写 null 不复活', sync.wrote === null && sync.read === undefined && sync.cleared.video_prompt_override === null, JSON.stringify(sync))

const sched = await p.evaluate(async () => {
  const m = await import('/src/scheduleStatus.ts')
  const base = { no: 'S01', seconds: 5, size: '中景', move: '推', dialogue: '', prompt: '', marks: [] }
  const input = (data) => ({ data, shotId: 'n1', sceneLayouts: [], projectAspect: '16:9' })
  return {
    none: m.resolveShotSchedule(input(base)),
    review: m.resolveShotSchedule(
      input({ ...base, scheduleVideo: '/videos/x.mp4', scheduleMeta: { version: 1, mode: 'review', fingerprint: 'x' } }),
    ),
    stale: m.resolveShotSchedule(
      input({ ...base, scheduleVideo: '/videos/x.mp4', scheduleMeta: { version: 1, mode: 'clean', fingerprint: 'x' } }),
    ),
  }
})
check('调度未渲染状态', sched.none.ready === false && sched.none.status === '未渲染', JSON.stringify(sched.none))
check('审阅视频仅看空间', sched.review.ready === false && sched.review.status === '仅审阅' && sched.review.reason.includes('审阅'), JSON.stringify(sched.review))
check('过期调度标为已过期', sched.stale.ready === false && sched.stale.status === '已过期' && sched.stale.reason.includes('重新渲染'), JSON.stringify(sched.stale))

const dry = await fetch(`${BASE}/api/seedance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dryRun: true,
    refImages: ['/generated/blender-bmvl0f76b100fab-0.jpg', '/generated/blender-bmvl0f76b100fab-1.jpg'],
    prompt: '[图1]和[图2]',
    seconds: 5,
    ratio: '16:9',
    resolution: '720p',
  }),
}).then((r) => r.json())
check('后端 dryRun 仍走多参考图模式', dry.ok === true && dry.mode === 'ref', JSON.stringify({ mode: dry.mode, skipped: dry.skipped }))
const dryRefs = (dry.request?.content ?? []).filter((c) => c.type === 'image_url')
check('后端参考图仍用 reference_image', dryRefs.length === 2 && dryRefs.every((c) => c.role === 'reference_image'), JSON.stringify(dryRefs.map((c) => c.role)))

check(
  '无手改正文与旧拼装逐字一致',
  basic.prompt ===
    '画面\n\n参考图：[图1]=当前画面构图，[图2]=角色「陈默」外观，[图3]=手工参考图，[图4]=手工参考图。主体外观、场景与道具必须与参考图一致。',
  JSON.stringify(basic.prompt),
)
check('参考顺序：当前画面优先', basic.refs[0]?.label === '当前画面构图', JSON.stringify(basic.refs[0]))
check('角色参考带身份标签', basic.refs[1]?.label === '角色「陈默」外观', basic.refs[1]?.label)
check('参考图上限 4 张', basic.refs.length === 4, String(basic.refs.length))
check('超限参考进入省略列表', basic.omitted.length === 3, JSON.stringify(basic.omitted.map((x) => x.label)))
check('图注按 [图N] 指代', /\[图1\]=当前画面构图/.test(basic.prompt) && /\[图2\]=角色「陈默」外观/.test(basic.prompt))
check('调度帧不再进入参考图', !frames.refs.some((r) => r.url === '/s1.jpg') && frames.prompt.includes('主体外观、场景与道具必须与参考图一致'), frames.prompt)
check('旧 3D 视频开关不再产生视频参考', video.mode !== 'video' && video.video === null && !video.prompt.includes('@视频1'), video.prompt)
check('旧 3D 视频开关不再警告视频参考', !video.warnings.some((w) => w.code === 'video-ref-unsupported'), JSON.stringify(video.warnings))
check('原生音频模式返回音色槽位', native.mode === 'native' && native.audio?.character === '陈默', JSON.stringify(native.audio))
check('原生音频提示词含音色参考音频1', native.prompt.includes('音色参考音频1'), native.prompt)
check('相邻镜缺图阻止出片', neighbor.blocking.some((x) => x.code === 'neighbor-missing'), JSON.stringify(neighbor.blocking))
check('参考变化会改变指纹', fpA.fingerprint !== fpB.fingerprint)
check('无手改时使用自动正文', unit.noOverride.source === 'auto' && unit.noOverride.text === basic.prompt)
check('手改指纹不匹配标记旧快照', unit.stale.source === 'override' && unit.stale.stale === true)
check('手改指纹匹配不算过期', unit.same.stale === false)

// ---------------------------------------------------------------- UI 路径
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(600)
const panel = p.locator('[data-video-prompt-panel]')
check('面板在生成按钮上方可见', (await panel.count()) === 1)
const autoText = await p.locator('[data-video-prompt-text]').innerText()
check('面板列出当前画面与角色', autoText.includes('[图1]=当前画面构图') && autoText.includes('[图2]=角色「陈默」外观'), autoText.slice(0, 160))
check('面板列出参考图数量', (await panel.innerText()).includes('参考图 3/4'))

await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1000)
check('拦截到出片请求', posts.length === 1, String(posts.length))
check('预览正文与请求 prompt 逐字一致', posts[0]?.prompt === autoText, `${(posts[0]?.prompt || '').slice(0, 80)}`)
check('请求参考图与清单一致', JSON.stringify(posts[0]?.refImages) === JSON.stringify(['/generated/probe-frame.jpg', '/generated/probe-char.jpg', '/generated/probe-prop.jpg']), JSON.stringify(posts[0]?.refImages))
await p.waitForTimeout(3600)
check('生成成功后显示当前视频提示词', (await panel.innerText()).includes('当前视频的提示词'))

// 手改
const edited = '镜头快速推近，陈默抬头说话，雨丝斜切画面，冷青色调，24fps，no overexposure'
await p.locator('[data-video-prompt-panel] button', { hasText: '编辑' }).click()
await p.locator('[data-video-prompt-panel] textarea').fill(edited)
await p.locator('[data-video-prompt-panel] button', { hasText: '保存手改' }).click()
await p.waitForTimeout(500)
check('保存后显示已手改', (await panel.innerText()).includes('已手改'))
check('手改正文不回填自动段落', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
check('手改后运动提示词字段提示不生效', (await p.locator('.vp-field-note').count()) === 1)
await p.waitForTimeout(1600)

await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1000)
check('手改后请求逐字使用手改全文', posts[1]?.prompt === edited, (posts[1]?.prompt || '').slice(0, 80))
await p.waitForTimeout(3600)

// 刷新持久化
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(600)
check('刷新后仍显示手改', (await p.locator('[data-video-prompt-panel]').innerText()).includes('已手改'))
check('刷新后正文保留', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
check('刷新后仍能看到当前视频提示词', (await p.locator('[data-video-prompt-panel]').innerText()).includes('当前视频的提示词'))

// 改参考 → 旧快照（手工参考 URL 在「更多」tab）
await p.getByRole('tab', { name: '更多' }).click()
await p.waitForTimeout(250)
await p.locator('[data-section="advanced"] > summary').click()
await p.waitForTimeout(200)
const addRef = p.locator('.inspector .refx-add-in')
for (const url of ['/generated/probe-x1.jpg', '/generated/probe-x2.jpg', '/generated/probe-x3.jpg']) {
  await addRef.fill(url)
  await addRef.press('Enter')
  await p.waitForTimeout(250)
}
await p.getByRole('tab', { name: '视频' }).click()
await p.waitForTimeout(300)
check('参考变化后显示旧快照', (await p.locator('[data-video-prompt-panel]').innerText()).includes('旧快照'))
check('旧快照正文仍是手改版本', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
const panelText = await p.locator('[data-video-prompt-panel]').innerText()
check('超限参考在面板显式省略', panelText.includes('参考图 4/4（省略 2）') && panelText.includes('省略'), panelText.slice(0, 220))

await p.locator('[data-video-prompt-panel] button', { hasText: '重新拼装' }).click()
await p.waitForTimeout(500)
check('重新拼装回到自动拼装', (await p.locator('[data-video-prompt-panel]').innerText()).includes('自动拼装'))
check('重新拼装正文包含新增参考', (await p.locator('[data-video-prompt-text]').innerText()).includes('[图4]='), await p.locator('[data-video-prompt-text]').innerText())

check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.screenshot({ path: '/tmp/video-prompt-preview.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
