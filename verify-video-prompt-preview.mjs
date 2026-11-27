/**
 * 出片提示词预览/正文验收：
 * 1) 拼装器单测：参考顺序、调度帧去冲突、视频参考、原生音频、指纹、阻止项
 * 2) UI：面板可见、预览与请求逐字一致、正文保存写回 video_prompt、刷新保留、存量快照只读兼容
 * 跑法：node verify-video-prompt-preview.mjs
 */
import { chromium } from 'playwright-core'
import { selectProject } from './verify-lib.mjs'

const BASE = process.env.APP_URL || 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const shot = {
  id: 'E01-S01',
  episode: 1,
  prod_kind: 'video',
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '推',
  keyframe_prompt: '雨夜摊位，陈默站着',
  video_prompt: '镜头缓慢前推 20 厘米，雨丝斜切画面',
  keyframe: '/generated/probe-frame.jpg',
  cast: ['陈默'],
  dialogue: [{ speaker: '陈默', text: '你来了。' }],
  performance: [{ character: '陈默', emotion: 'calm', intensity: 3, action: '抬头', speaks: true }],
  dialogue_delivery: [{ pace: 'slow' }],
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
    // 画布写回可能不带 prod_kind；保住出片镜身份，否则刷新后回落生图镜
    if (Array.isArray(body.shots)) {
      body.shots = body.shots.map((s) => ({ ...s, prod_kind: s.prod_kind ?? 'video' }))
    }
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
await p.waitForTimeout(1200)
const ensureCanvas = async () => {
  const ep = p.locator('[data-board-ep]').first()
  if (await ep.count()) {
    await ep.click()
    await p.waitForTimeout(1500)
  }
}
await selectProject(p, projectState.name, { view: 'board' })
await p.waitForTimeout(1500)
await ensureCanvas()

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
        videoPrompt: '雨夜追车，镜头推进',
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
    { ...nodes[0], data: { ...nodes[0].data, prodKind: 'video', refExtras: [], refIds: ['shot-prev'] } },
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
  const legacy = m.effectiveVideoPrompt(basic, { text: '手改', fingerprint: 'nope', createdAt: '' })
  const same = m.effectiveVideoPrompt(basic, {
    text: '手改',
    fingerprint: basic.fingerprint,
    createdAt: '',
  })
  const withPerf = m.buildShotVideoRequest({
    data: {
      ...nodes[0].data,
      refExtras: [],
      performance: [
        { character: '陈默', emotion: 'calm', intensity: 3, action: '抬头', speaks: true },
      ],
      dialogue: '陈默：你来了。',
      dialogueDelivery: [{ pace: 'slow' }],
    },
    nodeId: 'n1',
    nodes,
    characters: [baseChar],
    schedule,
    model: { key: 'v' },
  })
  const perfIgnored = m.effectiveVideoPrompt(withPerf, {
    text: '手改',
    fingerprint: basic.fingerprint,
    createdAt: '',
  })
  return { basic, frames, video, native, neighbor, fpA, fpB, noOverride, legacy, same, withPerf, perfIgnored }
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
  const locked = { ...old, handEdited: ['video_prompt'] }
  return {
    merged: m.mergeGenerated([old], [gen])[0],
    lockedMerge: m.mergeGenerated([locked], [gen])[0],
    cleared: m.mergeGenerated([{ ...old, video_prompt_override: null }], [gen])[0],
    wrote: m.nodeToShot(base, 'x').video_prompt_override,
    read: m.shotToData({ id: 'x', video_prompt_override: null }, base).videoPromptOverride,
  }
})
check('存量快照在重新生成后仍保留', sync.merged.video_prompt_override?.text === '手改', JSON.stringify(sync.merged))
check('handEdited 含 video_prompt 时模型不能覆盖正文', sync.lockedMerge.video_prompt === '旧', JSON.stringify(sync.lockedMerge))
check('清除后写 null 不复活', sync.wrote === null && sync.read === undefined && sync.cleared.video_prompt_override === null, JSON.stringify(sync))


/** 画布自动保存是 1500ms 防抖 + 一次请求往返，读库前必须轮询而不是死等 */
const readShotS01 = async (predicate, timeoutMs = 12000) => {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    last = await p.evaluate(async () => {
      const r = await fetch('/api/project?name=vp-test')
      const j = await r.json()
      const s = (j.project?.shots || []).find((x) => x.no === 'S01')
      return {
        video_prompt: s?.video_prompt,
        override: s?.video_prompt_override ?? null,
        handEdited: s?.handEdited || [],
      }
    })
    if (predicate(last)) return last
    await p.waitForTimeout(400)
  }
  return last
}

const pngPixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const dry = await fetch(`${BASE}/api/seedance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dryRun: true,
    refImages: [pngPixel, pngPixel],
    prompt: '[图1]和[图2]',
    seconds: 5,
    ratio: '16:9',
    resolution: '720p',
  }),
}).then((r) => r.json())
check('后端 dryRun 仍走多参考图模式', dry.ok === true && dry.mode === 'ref', JSON.stringify({ mode: dry.mode, skipped: dry.skipped }))
// 默认渠道可能是 APIMart（image_with_roles）或方舟（content[]），两种形状都认
const dryRefs = Array.isArray(dry.request?.image_with_roles)
  ? dry.request.image_with_roles
  : (dry.request?.content ?? []).filter((c) => c.type === 'image_url')
check('后端参考图仍用 reference_image', dryRefs.length === 2 && dryRefs.every((c) => c.role === 'reference_image'), JSON.stringify(dryRefs.map((c) => c.role)))
const dryText = Array.isArray(dry.request?.image_with_roles)
  ? String(dry.request?.prompt ?? '')
  : (dry.request?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
check('服务端零改写：回显正文与提交值逐字相同', dryText === '[图1]和[图2]', dryText)

const dryEmpty = await fetch(`${BASE}/api/seedance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun: true, refImages: [pngPixel], prompt: '   ', seconds: 5, ratio: '16:9', resolution: '720p' }),
})
const dryEmptyBody = await dryEmpty.json()
check('服务端不兜底空正文：4xx 且提示词为空', dryEmpty.status >= 400 && dryEmpty.status < 500 && String(dryEmptyBody.message || '').includes('提示词为空'), `${dryEmpty.status} ${JSON.stringify(dryEmptyBody)}`)

check('正文逐字等于 video_prompt', basic.prompt === '雨夜追车，镜头推进', basic.prompt.slice(0, 200))
check('正文不含指令段', !/【运镜】|【台词】|【表演方向】|声音：|参考图：|@视频1|【约束】/.test(basic.prompt), basic.prompt)
check('参考顺序：不含镜上静帧', basic.refs.every((r) => !r.label.includes('当前画面构图')), JSON.stringify(basic.refs[0]))
check('角色参考带身份标签', basic.refs.some((r) => r.label === '角色「陈默」外观'), basic.refs.map((r) => r.label).join(','))
check('连线参考图全部送出', basic.refs.length === 6, String(basic.refs.length))
check('默认不省略参考', basic.omitted.length === 0, JSON.stringify(basic.omitted.map((x) => x.label)))
check('参考图槽位不写进正文', !basic.prompt.includes('[图1]'), basic.prompt)
check('调度帧不再进入参考图', !frames.refs.some((r) => r.url === '/s1.jpg'), frames.prompt)
check('旧 3D 视频开关不再产生视频参考', video.mode !== 'video' && video.video === null && !video.prompt.includes('@视频1'), video.prompt)
check('旧 3D 视频开关不再警告视频参考', !video.warnings.some((w) => w.code === 'video-ref-unsupported'), JSON.stringify(video.warnings))
check('模型支持原生音频时恒带音轨并返回音色槽位', native.generateAudio === true && native.audio?.character === '陈默', JSON.stringify(native.audio))
check('原生音频不改写正文', native.prompt === '雨夜追车，镜头推进', native.prompt)
check('相邻镜缺图阻止出片', neighbor.blocking.some((x) => x.code === 'neighbor-missing'), JSON.stringify(neighbor.blocking))
check('参考变化会改变指纹', fpA.fingerprint !== fpB.fingerprint)
check('无快照时正文来源是 video_prompt', unit.noOverride.source === 'video_prompt' && unit.noOverride.text === basic.prompt)
check('存量快照只读优先且不再标记过期', unit.legacy.source === 'legacy-override' && unit.legacy.text === '手改' && unit.legacy.stale === false)
check('存量快照指纹匹配也不影响来源', unit.same.source === 'legacy-override' && unit.same.stale === false)
check('有表演时正文仍逐字', unit.withPerf.prompt === '雨夜追车，镜头推进', unit.withPerf.prompt.slice(0, 120))
check('表演变更不再产生过期状态', unit.perfIgnored.stale === false && unit.perfIgnored.source === 'legacy-override')

// ---------------------------------------------------------------- UI 路径
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(600)
const panel = p.locator('[data-video-prompt-panel]')
check('面板在生成按钮上方可见', (await panel.count()) === 1)
const autoText = await p.locator('[data-video-prompt-text]').innerText()
check('面板正文逐字等于 video_prompt', autoText === shot.video_prompt, autoText.slice(0, 160))
check('图片槽位列出两条参考', (await p.locator('[data-slot="image"] .si-slot-list li').count()) === 2)
check('图片槽位标注角色身份', (await p.locator('[data-slot="image"]').innerText()).includes('角色「陈默」外观'))
check('面板正文不含指令段', !autoText.includes('【表演方向】') && !autoText.includes('[图1]='))
check('生成设置区块可见', (await p.locator('[data-shot-settings]').count()) === 1)
check('提示词槽位标明逐字提交', (await p.locator('[data-slot="prompt"]').innerText()).includes('逐字提交'))

await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1000)
check('拦截到出片请求', posts.length === 1, String(posts.length))
check('预览正文与请求 prompt 逐字一致', posts[0]?.prompt === autoText, `${(posts[0]?.prompt || '').slice(0, 80)}`)
check('请求参考图与清单一致', JSON.stringify(posts[0]?.refImages) === JSON.stringify(['/generated/probe-char.jpg', '/generated/probe-prop.jpg']), JSON.stringify(posts[0]?.refImages))
await p.waitForTimeout(3600)

// 正文编辑：唯一入口在出片面板，保存写回 video_prompt
const edited = '镜头快速推近，陈默抬头说话，雨丝斜切画面，冷青色调，24fps，no overexposure'
check('运镜与语义区块不再有正文输入框', (await p.locator('textarea[placeholder^="只写动作与运镜"]').count()) === 0)
await p.locator('[data-video-prompt-panel] button', { hasText: '编辑正文' }).click()
await p.locator('[data-video-prompt-panel] textarea').fill(edited)
await p.locator('[data-video-prompt-panel] button', { hasText: '保存正文' }).click()
await p.waitForTimeout(300)
check('保存后显示已手改', (await panel.innerText()).includes('已手改'))
check('保存后正文等于编辑全文', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
check('保存后不再有手改快照字段提示', (await p.locator('.vp-field-note').count()) === 0)
const persisted = await readShotS01((x) => x.video_prompt === edited)
check('保存写回 video_prompt', persisted.video_prompt === edited, JSON.stringify(persisted).slice(0, 200))
check('保存不再产生 video_prompt_override', persisted.override === null, JSON.stringify(persisted.override))
check('保存后 handEdited 含 video_prompt', persisted.handEdited.includes('video_prompt'), JSON.stringify(persisted.handEdited))
await p.waitForTimeout(1200)

await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1000)
check('保存后请求逐字使用正文全文', posts[1]?.prompt === edited, (posts[1]?.prompt || '').slice(0, 80))
await p.waitForTimeout(3600)

// 刷新持久化
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await ensureCanvas()
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(600)
check('刷新后仍显示已手改', (await p.locator('[data-video-prompt-panel]').innerText()).includes('已手改'))
check('刷新后正文保留', (await p.locator('[data-video-prompt-text]').innerText()) === edited)

// 改参考：正文保持人工版本，且不再产生过期警告。手工地址就在图片槽位内，无需切页
const addRef = p.locator('[data-slot="image"] .si-slot-manual')
for (const url of ['/generated/probe-x1.jpg', '/generated/probe-x2.jpg', '/generated/probe-x3.jpg']) {
  await addRef.fill(url)
  await addRef.press('Enter')
  await p.waitForTimeout(250)
}
await p.waitForTimeout(300)
check('参考变化后不显示旧快照警告', !(await p.locator('[data-video-prompt-panel]').innerText()).includes('旧快照'))
check('参考变化后正文仍是人工版本', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
const slotText = await p.locator('[data-slot="image"]').innerText()
check(
  '新增参考后全部列出',
  (await p.locator('[data-slot="image"] .si-slot-list li').count()) === 5 && !slotText.includes('省略'),
  slotText.slice(0, 220),
)

// 交由模型重写：解除手改标记但保留正文
await p.locator('[data-video-prompt-panel] button', { hasText: '交由模型重写' }).click()
await p.waitForTimeout(300)
check('解除手改后正文保留', (await p.locator('[data-video-prompt-text]').innerText()) === edited)
check('解除手改后徽章回到正文', (await p.locator('[data-video-prompt-panel]').innerText()).includes('正文') && !(await p.locator('[data-video-prompt-panel]').innerText()).includes('已手改'))
const unlocked = await readShotS01((x) => !x.handEdited.includes('video_prompt'))
check('解除手改后 handEdited 不再含 video_prompt', !unlocked.handEdited.includes('video_prompt'), JSON.stringify(unlocked.handEdited))

// 空正文阻断：把该镜正文置空后刷新，应给出补写入口并禁用出片
await p.evaluate(async () => {
  const r = await fetch('/api/project?name=vp-test')
  const j = await r.json()
  const shots = (j.project?.shots || []).map((s) =>
    s.no === 'S01' ? { ...s, video_prompt: '', video_prompt_override: null, handEdited: [] } : s,
  )
  await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'vp-test', shots }),
  })
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await ensureCanvas()
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(800)
// 槽位版：阻断原因在吸底，正文空态在提示词槽位内
const footNote = await p.locator('[data-shot-footer]').innerText()
check('空正文显示阻断', footNote.includes('正文未填写'), footNote)
check('空正文时提示词槽位显示空态', (await p.locator('[data-vp-empty]').count()) === 1)
check('空正文时出片按钮禁用', await p.locator('button', { hasText: /生成视频|重出视频/ }).first().isDisabled())
check('空正文时给出写正文入口', (await p.locator('[data-video-prompt-panel] button', { hasText: '写正文' }).count()) === 1)

// 存量兼容：旧项目里带 video_prompt_override 的镜头仍按快照逐字出片
await p.evaluate(async () => {
  const legacyText = '升级前保存的旧版正文：镜头缓慢后退，雨停'
  const r = await fetch('/api/project?name=vp-test')
  const j = await r.json()
  const shots = (j.project?.shots || []).map((s) =>
    s.no === 'S01'
      ? {
          ...s,
          video_prompt: '镜头里后来写的正文',
          video_prompt_override: { text: legacyText, fingerprint: 'fp-legacy', createdAt: '2026-01-01' },
          handEdited: ['video_prompt_override'],
        }
      : s,
  )
  await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'vp-test', shots }),
  })
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await ensureCanvas()
await p.locator('.react-flow__node').first().click()
await p.waitForTimeout(800)
const legacyPanel = p.locator('[data-video-prompt-panel]')
check('存量快照显示旧版本正文徽章', (await legacyPanel.innerText()).includes('旧版本正文'))
check('存量快照给出迁移提示', (await p.locator('[data-vp-legacy-note]').count()) === 1)
check('存量快照正文逐字为快照全文', (await p.locator('[data-video-prompt-text]').innerText()) === '升级前保存的旧版正文：镜头缓慢后退，雨停')
const postsBeforeLegacy = posts.length
await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1000)
check('存量快照仍按快照提交', posts[postsBeforeLegacy]?.prompt === '升级前保存的旧版正文：镜头缓慢后退，雨停', (posts[postsBeforeLegacy]?.prompt || '').slice(0, 80))
await p.waitForTimeout(3600)

// 在正文区保存一次即迁移到 video_prompt
await p.locator('[data-video-prompt-panel] button', { hasText: '编辑正文' }).click()
await p.locator('[data-video-prompt-panel] textarea').fill('迁移后的新正文')
await p.locator('[data-video-prompt-panel] button', { hasText: '保存正文' }).click()
await p.waitForTimeout(300)
const migrated = await readShotS01((x) => x.video_prompt === '迁移后的新正文' && x.override === null)
check('保存后旧快照被清空', migrated.override === null, JSON.stringify(migrated.override))
check('保存后正文落到 video_prompt', migrated.video_prompt === '迁移后的新正文', migrated.video_prompt)
check('迁移后不再是旧版本徽章', !(await p.locator('[data-video-prompt-panel]').innerText()).includes('旧版本正文'))

check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.locator('.si-scroll').evaluate((el) => { el.scrollTop = 0 })
await p.screenshot({ path: '/tmp/video-prompt-preview.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
