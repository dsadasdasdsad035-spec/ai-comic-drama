/**
 * 连播 + 共享字幕轨验收：
 * 1) 播放头连续、TTS 音频、字幕 overlay、seek/分段/暂停/键盘
 * 2) 导出 payload 带相对 cue；有 libass 走 SRT，无 libass 带 cue PNG
 * 跑法：node verify-preview-captions.mjs
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const BASE = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const PROJECT = 'pc-test'
const IMG1 = '/generated/blender-bmvl0f76b100fab-0.jpg'
const IMG2 = '/generated/sched-1792822461394-0-bbf5.jpg'
const VOICE = '/voices/voice-1792672115887-aa2555.mp3'
const NATIVE_VIDEO = '/generated/pc-native-test.mp4'
if (!fs.existsSync(`public${NATIVE_VIDEO}`)) {
  execFileSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', [
    '-v', 'error', '-loop', '1', '-t', '3', '-i', `public${IMG1}`, '-i', `public${VOICE}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', `public${NATIVE_VIDEO}`,
  ])
}
const saved = {
  nodes: [
    {
      id: 'n1',
      type: 'shot',
      position: { x: 0, y: 0 },
      data: {
        shotId: 'E01-S01',
        episode: 1,
        no: 'S01',
        seconds: 6,
        size: '中景',
        move: '推',
        dialogue: '陈默：第一句话。第二句话。',
        prompt: '雨夜摊位',
        marks: [],
        refImage: IMG1,
        voiceUrl: VOICE,
        voiceSeconds: 4.8,
        voiceOffset: 0,
        subOffset: 0,
      },
    },
    {
      id: 'n2',
      type: 'shot',
      position: { x: 500, y: 0 },
      data: {
        shotId: 'E01-S02',
        episode: 1,
        no: 'S02',
        seconds: 4,
        size: '近景',
        move: '固定',
        dialogue: '林岚：第三句话。',
        prompt: '雨幕',
        marks: [],
        refImage: IMG2,
        voiceUrl: VOICE,
        voiceSeconds: 2.5,
        voiceOffset: 0,
        subOffset: 0,
      },
    },
    {
      id: 'n3',
      type: 'shot',
      position: { x: 1000, y: 0 },
      data: {
        shotId: 'E01-S03',
        episode: 1,
        no: 'S03',
        seconds: 2,
        size: '中景',
        move: '固定',
        dialogue: '陈默：没有画面的镜头。',
        prompt: '空',
        marks: [],
      },
    },
    {
      id: 'n4',
      type: 'shot',
      position: { x: 1500, y: 0 },
      data: {
        shotId: 'E01-S04',
        episode: 1,
        no: 'S04',
        seconds: 2,
        size: '特写',
        move: '固定',
        dialogue: '旁白：原生声音。',
        prompt: '视频',
        marks: [],
        refImage: IMG1,
        videoUrl: NATIVE_VIDEO,
        audioMode: 'native',
      },
    },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'shot', data: { relation: 'transition' } }],
  characters: [],
  epNo: 1,
  cleared: false,
}
const project = {
  name: PROJECT,
  title: 'Preview captions',
  style: '',
  aspect: '16:9',
  episodes: [{ no: 1, title: 'EP1' }],
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 6,
      size: '中景',
      move: '推',
      keyframe_prompt: '雨夜摊位',
      video_prompt: '镜头缓慢前推',
      keyframe: IMG1,
      dialogue: [{ speaker: '陈默', text: '第一句话。第二句话。' }],
    },
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 4,
      size: '近景',
      move: '固定',
      keyframe_prompt: '雨幕',
      video_prompt: '镜头固定',
      keyframe: IMG2,
      dialogue: [{ speaker: '林岚', text: '第三句话。' }],
    },
    {
      id: 'E01-S03',
      episode: 1,
      no: 'S03',
      seconds: 2,
      size: '中景',
      move: '固定',
      keyframe_prompt: '空',
      video_prompt: '',
      dialogue: [{ speaker: '陈默', text: '没有画面的镜头。' }],
    },
    {
      id: 'E01-S04',
      episode: 1,
      no: 'S04',
      seconds: 2,
      size: '特写',
      move: '固定',
      keyframe_prompt: '视频',
      video_prompt: '固定',
      keyframe: IMG1,
      clip: NATIVE_VIDEO,
      audio_mode: 'native',
      dialogue: [{ speaker: '旁白', text: '原生声音。' }],
    },
  ],
  characters: [],
  assets: [],
  sceneLayouts: [],
  media: { missing: [] },
}
// 故意打乱数组顺序：播放顺序必须由镜号决定，而不是 project.json 数组顺序
saved.nodes = [saved.nodes[2], saved.nodes[0], saved.nodes[3], saved.nodes[1]]
project.shots = [project.shots[3], project.shots[0], project.shots[2], project.shots[1]]

let assReady = true
const assembleBodies = []

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 1050 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
p.on('dialog', (d) => d.accept())
await p.addInitScript(
  ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
  { key: `storyboard-canvas-v1:${encodeURIComponent(PROJECT)}`, data: saved },
)
await p.route('**/api/health', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, hasKey: true, ffmpegAss: assReady }),
  }),
)
await p.route('**/api/project**', async (route) => {
  const req = route.request()
  const u = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: project.shots, characters: [], savedAt: new Date().toISOString() }),
    })
  }
  if (u.searchParams.get('name')) {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      root: '/tmp',
      projects: [
        { name: PROJECT, title: project.title, style: '', aspect: '16:9', episodes: 1, shots: 4, seconds: 14 },
      ],
    }),
  })
})
await p.route('**/api/assemble**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    assembleBodies.push(JSON.parse(req.postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: `a-${assembleBodies.length}` }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      status: 'succeeded',
      url: '/exports/fake.mp4',
      srtUrl: '/exports/fake.srt',
      shots: 2,
      transitions: 0,
      seconds: 10,
      voiced: 1,
      subbed: 1,
      captions: 3,
      overflows: [],
      elapsed: 900,
    }),
  })
})

const openPreview = async () => {
  await p.getByRole('button', { name: /连播/ }).click()
  await p.locator('.pv').waitFor({ timeout: 10000 })
  await p.waitForTimeout(350)
}
const setRange = async (selector, value) => {
  await p.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1800)
const canvasKey = `storyboard-canvas-v1:${encodeURIComponent(PROJECT)}`
const shotDataBefore = await p.evaluate(
  (key) =>
    JSON.parse(localStorage.getItem(key) || '{}').nodes?.map((n) => ({
      no: n.data?.no,
      dialogue: n.data?.dialogue,
      voiceUrl: n.data?.voiceUrl,
      voiceSeconds: n.data?.voiceSeconds,
      subOffset: n.data?.subOffset,
    })),
  canvasKey,
)
check('时间线字幕行显示多条 cue', (await p.locator('.ntl-clip.sub').count()) === 5, String(await p.locator('.ntl-clip.sub').count()))
const cueTitles = await p.locator('.ntl-clip.sub').evaluateAll((els) => els.map((el) => el.getAttribute('title') || ''))
check('cue 标题含角色和估算标记', cueTitles.some((t) => t.includes('陈默')) && cueTitles.some((t) => t.includes('估算')), JSON.stringify(cueTitles))
const cueTexts = await p.locator('.ntl-clip.sub .ntl-clip-t').allInnerTexts()
check('时间线 cue 按镜号排序', cueTexts[0]?.includes('第一句话') && cueTexts[1]?.includes('第二句话'), JSON.stringify(cueTexts))
await openPreview()

check('连播打开在第一个镜头', (await p.locator('.pv-no').innerText()).trim() === 'S01')
const segNos = await p.locator('.pv-seg span').allInnerTexts()
check('连播按镜号排序', segNos.join(',') === 'S01,S02,S03,S04', segNos.join(','))
check('连播是模态对话框', (await p.locator('.pv[role="dialog"][aria-modal="true"]').count()) === 1)
check('打开后焦点在播放按钮', (await p.evaluate(() => document.activeElement?.getAttribute('data-pv-play'))) !== null)
check('预加载下一段媒体', (await p.locator('[data-pv-preload]').count()) === 1 && (await p.locator('[data-pv-preload]').innerHTML()).includes('sched-1792822461394'), await p.locator('[data-pv-preload]').innerHTML())
const t0 = await p.locator('.pv-time').innerText()
await p.waitForTimeout(900)
const t1 = await p.locator('.pv-time').innerText()
check('播放头时间连续变化', t0 !== t1, `${t0} -> ${t1}`)
check('开头就显示第一句字幕', (await p.locator('.pv-caption').innerText()).includes('第一句话'), await p.locator('.pv-caption').innerText())

const audio = await p.evaluate(() =>
  Array.from(document.querySelectorAll('.pv audio')).map((el) => ({
    paused: el.paused,
    t: el.currentTime,
    src: el.getAttribute('src'),
  })),
)
check('挂载了 TTS 音频', audio.length > 0, JSON.stringify(audio))
check('TTS 正在播放', audio.some((a) => !a.paused && a.t > 0), JSON.stringify(audio))

// 镜头内 seek -> 第二条字幕
await setRange('.pv-seek', '3')
await p.waitForTimeout(350)
check('seek 后显示第二句字幕', (await p.locator('.pv-caption').innerText()).includes('第二句话'), await p.locator('.pv-caption').innerText())
check('seek 后时间接近 3s', Number((await p.locator('.pv-time').innerText()).split('/')[0]) >= 2.8, await p.locator('.pv-time').innerText())
await p.screenshot({ path: '/tmp/preview-captions.png' })

// 转场重叠：S01 结束前 0.5s，S02 已经进入，两段音频都应挂载
await p.locator('[data-pv-play]').click()
await p.waitForTimeout(200)
await setRange('.pv-seek', '5.6')
await p.waitForTimeout(400)
const overlapAudio = await p.evaluate(() =>
  Array.from(document.querySelectorAll('.pv audio')).map((el) => ({
    src: el.getAttribute('src'),
    paused: el.paused,
  })),
)
check('转场重叠时两段音频都挂载', overlapAudio.length === 2 && overlapAudio.some((a) => String(a.src).includes('aa2555')), JSON.stringify(overlapAudio))
await p.locator('[data-pv-play]').click()
await p.waitForTimeout(200)
await setRange('.pv-seek', '0')
await p.waitForTimeout(200)

// 预览字幕开关
const previewSub = p.locator('.pv-subs', { hasText: '预览字幕' }).locator('input')
await previewSub.uncheck()
await p.waitForTimeout(200)
check('关闭预览字幕后 overlay 消失', (await p.locator('.pv-caption').count()) === 0)
await p.screenshot({ path: '/tmp/preview-captions-off.png' })
await previewSub.check()
await p.waitForTimeout(200)
check('重新打开预览字幕', (await p.locator('.pv-caption').count()) === 1)

// 暂停
await p.locator('[data-pv-play]').click()
await p.waitForTimeout(250)
const pausedAt = await p.locator('.pv-time').innerText()
await p.waitForTimeout(600)
check('暂停后时间停住', (await p.locator('.pv-time').innerText()) === pausedAt, pausedAt)
check('暂停状态可见', (await p.locator('.pv-paused').count()) === 1)
await p.locator('[data-pv-play]').click()

// 分段跳转
await p.locator('.pv-seg').nth(1).click()
await p.waitForTimeout(350)
check('点击分段跳到 S02', (await p.locator('.pv-no').innerText()).trim() === 'S02', await p.locator('.pv-no').innerText())
check('S02 显示 TTS 状态', (await p.locator('.pv-head').innerText()).includes('TTS 2.5s'), await p.locator('.pv-head').innerText())
check('S02 显示第三句字幕', (await p.locator('.pv-caption').innerText()).includes('第三句话'), await p.locator('.pv-caption').innerText())

// 键盘换镜
await p.locator('.pv-seg').first().click()
await p.waitForTimeout(200)
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(250)
check('右方向键到下一镜', (await p.locator('.pv-no').innerText()).trim() === 'S02', await p.locator('.pv-no').innerText())
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(250)
check('左方向键回上一镜', (await p.locator('.pv-no').innerText()).trim() === 'S01', await p.locator('.pv-no').innerText())

// 缺失画面
await p.locator('.pv-seg').nth(2).click()
await p.waitForTimeout(300)
check('缺失画面显示明确状态', (await p.locator('.pv-empty').innerText()).includes('还没有画面'), await p.locator('.pv-empty').innerText())
check('缺失画面镜头显示无配音', (await p.locator('.pv-head').innerText()).includes('无配音'), await p.locator('.pv-head').innerText())
await p.locator('.pv-seg').first().click()
await p.waitForTimeout(200)

// native 视频音轨 + 静音
await p.locator('.pv-seg').nth(3).click()
await p.waitForTimeout(900)
check('S04 显示原生音轨', (await p.locator('.pv-head').innerText()).includes('原生音轨'), await p.locator('.pv-head').innerText())
const nativeAudio = await p.evaluate(() =>
  Array.from(document.querySelectorAll('.pv audio')).map((el) => ({
    src: el.getAttribute('src'),
    paused: el.paused,
    muted: el.muted,
  })),
)
check('原生音轨挂载视频音频', nativeAudio.some((a) => String(a.src).includes('.mp4')), JSON.stringify(nativeAudio))
await p.locator('.pv-icon[aria-label="静音"]').click()
await p.waitForTimeout(300)
const mutedAudio = await p.evaluate(() => Array.from(document.querySelectorAll('.pv audio')).every((el) => el.muted))
check('静音作用于音频池', mutedAudio)
await p.locator('.pv-icon[aria-label="取消静音"]').click()
await p.locator('.pv-seg').first().click()
await p.waitForTimeout(200)

// 全屏
await p.locator('.pv-x[aria-label="全屏"]').click()
await p.waitForTimeout(500)
const full = await p.evaluate(() => Boolean(document.fullscreenElement))
check('全屏按钮进入全屏', full)
if (full) {
  await p.keyboard.press('Escape')
  await p.waitForTimeout(350)
  check('Esc 退出全屏但保留连播', (await p.locator('.pv').count()) === 1 && !(await p.evaluate(() => Boolean(document.fullscreenElement))), JSON.stringify({ pv: await p.locator('.pv').count(), fs: await p.evaluate(() => Boolean(document.fullscreenElement)) }))
}

// 导出：有 libass -> 不带 PNG，带相对 cue 和样式
await p.getByRole('button', { name: '导出成片' }).click()
await p.waitForTimeout(2600)
check('捕获到导出请求', assembleBodies.length === 1, String(assembleBodies.length))
const srtBody = assembleBodies[0] || {}
const srtShots = (srtBody.segments || []).filter((s) => s.kind === 'shot')
check('导出带 captionStyle', Boolean(srtBody.captionStyle?.fontRatio), JSON.stringify(srtBody.captionStyle))
check('S01 有两条相对 cue', (srtShots[0]?.captions || []).length === 2, JSON.stringify(srtShots[0]?.captions))
check('cue 已去说话人前缀', (srtShots[0]?.captions || []).every((c) => !String(c.text).includes('陈默')), JSON.stringify(srtShots[0]?.captions))
check('libass 路径不发送 cue PNG', (srtShots[0]?.captions || []).every((c) => !c.sub))
check('导出后出现 SRT 下载', (await p.locator('.pv-export a', { hasText: '下载 SRT' }).count()) === 1)
check('导出结果显示字幕', (await p.locator('.pv-msg.ok').innerText()).includes('字幕'), await p.locator('.pv-msg.ok').innerText())
await p.screenshot({ path: '/tmp/preview-captions-export.png' })

await p.locator('.pv-x').last().click()
await p.waitForTimeout(300)
check('Esc/关闭后连播消失', (await p.locator('.pv').count()) === 0)

// 无 libass -> 每条 cue 带 PNG
assReady = false
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
await openPreview()
await p.getByRole('button', { name: '导出成片' }).click()
await p.waitForTimeout(2600)
const pngBody = assembleBodies[1] || {}
const pngShots = (pngBody.segments || []).filter((s) => s.kind === 'shot')
check('无 libass 时仍然带 cue', (pngShots[0]?.captions || []).length === 2, JSON.stringify(pngShots[0]?.captions))
const pngOk = (pngShots[0]?.captions || []).every((c) =>
  String(c.sub || '').startsWith('data:image/png'),
)
check('无 libass 时每条 cue 带 PNG', pngOk, pngOk ? '' : 'missing png')

await p.keyboard.press('Escape')
await p.waitForTimeout(300)
check('Escape 关闭连播', (await p.locator('.pv').count()) === 0)

const shotDataAfter = await p.evaluate(
  (key) =>
    JSON.parse(localStorage.getItem(key) || '{}').nodes?.map((n) => ({
      no: n.data?.no,
      dialogue: n.data?.dialogue,
      voiceUrl: n.data?.voiceUrl,
      voiceSeconds: n.data?.voiceSeconds,
      subOffset: n.data?.subOffset,
    })),
  canvasKey,
)
check('预览/导出不改镜头台词与配音', JSON.stringify(shotDataAfter) === JSON.stringify(shotDataBefore), JSON.stringify({ before: shotDataBefore, after: shotDataAfter }))

// 时间线拖动：整组 cue 同步平移
const cueBlocks = p.locator('.ntl-clip.sub')
const beforeLefts = await cueBlocks.evaluateAll((els) => els.slice(0, 2).map((el) => parseFloat(el.style.left) || 0))
const firstBox = await cueBlocks.first().boundingBox()
if (firstBox) {
  await p.mouse.move(firstBox.x + 20, firstBox.y + firstBox.height / 2)
  await p.mouse.down()
  await p.mouse.move(firstBox.x + 60, firstBox.y + firstBox.height / 2, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(500)
}
const afterLefts = await cueBlocks.evaluateAll((els) => els.slice(0, 2).map((el) => parseFloat(el.style.left) || 0))
check(
  '拖动字幕行整组 cue 同步平移',
  beforeLefts.length === 2 && afterLefts.length === 2 &&
    afterLefts[0] > beforeLefts[0] + 20 &&
    Math.abs(afterLefts[0] - beforeLefts[0] - (afterLefts[1] - beforeLefts[1])) < 2,
  JSON.stringify({ beforeLefts, afterLefts }),
)

// 画面轨拖动不改变顺序/镜号
const orderBefore = await p.evaluate(
  (key) => JSON.parse(localStorage.getItem(key) || '{}').nodes?.map((n) => n.data?.no),
  canvasKey,
)
const pic = p.locator('.ntl-clip.pic').first()
const picBox = await pic.boundingBox()
if (picBox) {
  await p.mouse.move(picBox.x + 20, picBox.y + picBox.height / 2)
  await p.mouse.down()
  await p.mouse.move(picBox.x + 140, picBox.y + picBox.height / 2, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(400)
}
const orderAfter = await p.evaluate(
  (key) => JSON.parse(localStorage.getItem(key) || '{}').nodes?.map((n) => n.data?.no),
  canvasKey,
)
const picNos = await p.locator('.ntl-clip.pic .ntl-clip-t').allInnerTexts()
check('画面轨拖动不改顺序/镜号', JSON.stringify(orderAfter) === JSON.stringify(orderBefore), JSON.stringify({ before: orderBefore, after: orderAfter }))
check('画面轨仍按镜号排列', picNos.join(',') === 'S01,S02,S03,S04', picNos.join(','))

// 夜间主题下的同一预览
await p.getByRole('button', { name: '夜间' }).click()
await p.waitForTimeout(300)
await openPreview()
await p.waitForTimeout(400)
await p.screenshot({ path: '/tmp/preview-captions-night.png' })
await p.locator('.pv-x[aria-label="关闭连播"]').click()
await p.waitForTimeout(200)
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/preview-captions-after.png' })
await b.close()
fs.rmSync(`public${NATIVE_VIDEO}`, { force: true })
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
