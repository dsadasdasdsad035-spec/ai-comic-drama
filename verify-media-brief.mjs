/**
 * 媒体 brief：带标签参考板 → vision mock → 缓存；无视觉回退；视频关键帧。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-media-brief.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const errors = []
let visionCalls = 0
let videoVisionCalls = 0
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api/vision', (route) => {
  visionCalls++
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: {
        summary: '冷色井道，主体在左侧',
        items: [{ key: 'image:test', description: '红色方块，前景居中', subjects: ['方块'], composition: '居中', style: '冷色', camera: '平视' }],
      },
      text: '',
      model: 'mock-vision',
      modelKey: 'vision',
      modelLabel: 'Mock Vision',
    }),
  })
})
await page.route('**/api/video-vision', (route) => {
  videoVisionCalls++
  return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, kind: 'unsupported-video-input', message: 'local video' }) })
})
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)

const result = await page.evaluate(async () => {
  const { buildMediaBrief, mediaBriefText, clearMediaBriefCache } = await import('/src/mediaBrief.ts')
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 32
  const x = c.getContext('2d')
  x.fillStyle = '#d22'
  x.fillRect(0, 0, 32, 32)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const bytes = await blob.arrayBuffer()
  const asset = {
    payload: { key: 'image:test', kind: 'image', label: '测试图', mime: 'image/png', bytes, width: 32, height: 32 },
    ref: { key: 'image:test', url: '/generated/test.png', kind: 'image', source: 'image', label: '测试图', contentHash: 'hash-test' },
  }
  const settings = {
    providers: [{ id: 'p', label: 'Mock', kind: 'openai', baseUrl: 'https://mock', caps: ['text'], apiKey: 'mock' }],
    models: [{ key: 'vision', label: 'Vision', cap: 'vision', provider: 'p', model: 'mock-vision' }],
    defaults: { vision: 'vision' },
    apiKey: '',
    rules: {},
  }
  const first = await buildMediaBrief({ assets: [asset], settings })
  const second = await buildMediaBrief({ assets: [asset], settings })
  clearMediaBriefCache()
  const noVision = await buildMediaBrief({
    assets: [asset],
    settings: { ...settings, models: [], defaults: {} },
  })
  const text = mediaBriefText(first.brief)
  return {
    first: first.brief,
    second: second.brief,
    noVision: noVision.brief,
    noVisionWarnings: noVision.warnings,
    text,
    assetCount: first.brief.items.length,
  }
})
check('媒体 brief 使用视觉模型', result.first.usedVision && result.assetCount === 1, JSON.stringify(result.first).slice(0, 300))
check('brief 含描述/构图/风格', result.first.items[0]?.description?.includes('红色') && result.first.items[0]?.composition === '居中')
check('brief 缓存命中', visionCalls === 1, String(visionCalls))
check('brief 文本可拼进 prompt', result.text.includes('冷色井道') && result.text.includes('image:test'))
check('无视觉模型回退标签', !result.noVision.usedVision && result.noVisionWarnings.length > 0, JSON.stringify(result.noVisionWarnings))
check('brief 不含 dataURL', !/data:image\//i.test(JSON.stringify(result.first)))

const video = await page.evaluate(async () => {
  const v = await (await fetch('/api/videos')).json()
  const url = (v.videos || [])[0]?.url
  if (!url) return { skipped: true }
  const { ensureVideoFrames, videoFrameInputs } = await import('/src/videoFrames.ts')
  const set = await ensureVideoFrames(url, 3)
  const inputs = await videoFrameInputs([{ url, label: '参考视频', videoDuration: set.duration }], 3)
  return { url, set, inputs: inputs.inputs }
})
if (video.skipped) {
  console.log('⚠️ 没有现成视频，跳过关键帧检查')
} else {
  check('视频抽取 3 帧', video.set.frames?.length === 3, JSON.stringify(video.set))
  check('视频关键帧进入代码素材', video.inputs.length === 3 && video.inputs.every((x) => x.kind === 'video-frame'), JSON.stringify(video.inputs.map((x) => x.key)))
  check('视频时长为正', video.set.duration > 0, String(video.set.duration))
}
check('聊天链路不发视频理解请求', videoVisionCalls === 0, String(videoVisionCalls))
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
