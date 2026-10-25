/**
 * 字幕轨验收：cue 构建/校验/SRT + 真实 ffmpeg 字幕导出/sidecar。
 * 连播 UI 和 PNG payload 由 verify-preview-captions.mjs 覆盖。
 * 跑法：node verify-subs.mjs
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)

const unit = await p.evaluate(async () => {
  const m = await import('/src/captions.ts')
  const voice = m.buildShotCaptions({
    shotId: 's1',
    dialogue: '陈默：第一句。第二句！第三句？',
    shotSeconds: 6,
    voiceSeconds: 4.8,
    voiceOffset: 0,
    subOffset: 0,
    audioMode: 'off',
  })
  const shifted = m.buildShotCaptions({
    shotId: 's2',
    dialogue: '陈默：第一句。第二句。',
    shotSeconds: 6,
    voiceSeconds: 4.8,
    subOffset: 2,
    audioMode: 'off',
  })
  const native = m.buildShotCaptions({
    shotId: 's3',
    dialogue: '林岚：原生音频。',
    shotSeconds: 4,
    audioMode: 'native',
  })
  const overlap = [
    { id: 'a', shotId: 's', text: 'A', startOffsetMs: 0, endOffsetMs: 2000, timing: 'voice', estimated: false },
    { id: 'b', shotId: 's', text: 'B', startOffsetMs: 1500, endOffsetMs: 3000, timing: 'voice', estimated: false },
  ]
  const fast = [
    { id: 'c', shotId: 's', text: '一'.repeat(20), startOffsetMs: 0, endOffsetMs: 1000, timing: 'shot', estimated: true },
  ]
  const srt = m.serializeSrt([
    { startMs: 0, endMs: 1100, text: '第一句。' },
    { startMs: 1200, endMs: 1900, text: '第二句。\n第二行' },
  ])
  return {
    voice,
    shifted,
    native,
    overlapIssues: m.validateCaptions(overlap, 4),
    fastIssues: m.validateCaptions(fast, 4),
    srt,
    style: m.CAPTION_STYLE,
  }
})

check('按句生成 cue', unit.voice.length === 3, JSON.stringify(unit.voice.map((c) => c.text)))
check('cue 使用 TTS 区间', unit.voice[0]?.startOffsetMs === 0 && unit.voice[2]?.endOffsetMs === 4800, JSON.stringify(unit.voice))
check('cue 不重叠', unit.voice.every((c, i) => i === 0 || c.startOffsetMs >= unit.voice[i - 1].endOffsetMs), JSON.stringify(unit.voice))
check('subOffset 夹到镜头内', unit.shifted.some((c) => c.clamped), JSON.stringify(unit.shifted))
check('native 标记估算', unit.native[0]?.timing === 'native-estimate' && unit.native[0]?.estimated === true, JSON.stringify(unit.native))
check('重叠校验报错', unit.overlapIssues.some((i) => i.level === 'error' && i.code === 'overlap'), JSON.stringify(unit.overlapIssues))
check('阅读速度校验报错', unit.fastIssues.some((i) => i.level === 'error' && i.code === 'reading-speed'), JSON.stringify(unit.fastIssues))
check(
  'SRT 时间与换行',
  unit.srt.includes('00:00:00,000 --> 00:00:01,100') &&
    unit.srt.includes('00:00:01,200 --> 00:00:01,900') &&
    unit.srt.includes('第二行'),
  unit.srt,
)
check('共享样式存在', unit.style.fontRatio === 0.044 && unit.style.maxLines === 2, JSON.stringify(unit.style))

const post = async (segments, extra = {}) => {
  const r = await fetch(`${BASE}/api/assemble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments,
      resolution: '480p',
      joins: segments.map(() => ({ mode: 'cut' })),
      captionStyle: unit.style,
      ...extra,
    }),
  })
  return r.json()
}
const waitJob = async (id) => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = await (await fetch(`${BASE}/api/assemble?id=${encodeURIComponent(id)}`)).json()
    if (s.status === 'succeeded' || s.status === 'failed') return s
  }
  return { status: 'timeout' }
}

const job = await post([
  {
    kind: 'shot',
    seconds: 2,
    image: '/generated/blender-bmvl0f76b100fab-0.jpg',
    audioMode: 'none',
    captions: [
      { startOffsetMs: 0, endOffsetMs: 1000, text: '第一句。' },
      { startOffsetMs: 1100, endOffsetMs: 1900, text: '第二句。' },
    ],
  },
  {
    kind: 'shot',
    seconds: 2,
    image: '/generated/sched-1792822461394-0-bbf5.jpg',
    audioMode: 'none',
    captions: [{ startOffsetMs: 0, endOffsetMs: 1500, text: '第三句。' }],
  },
])
check('提交真实字幕导出', job.ok === true, JSON.stringify(job))
const result = await waitJob(job.id)
check('真实导出成功', result.status === 'succeeded', JSON.stringify(result))
check('回报 cue 数', result.captions === 3, String(result.captions))
check('回报字幕镜头数', result.subbed === 2, String(result.subbed))
check('返回 SRT sidecar', Boolean(result.srtUrl), String(result.srtUrl))
if (result.srtUrl) {
  const srt = await (await fetch(BASE + result.srtUrl)).text()
  check(
    'sidecar 与 cue 一致',
    srt.includes('第一句。') &&
      srt.includes('第二句。') &&
      srt.includes('第三句。') &&
      srt.includes('00:00:02,000 --> 00:00:03,500'),
    srt,
  )
}

const cuePng = await p.evaluate(async (style) => {
  const m = await import('/src/subtitles.ts')
  return m.renderSubtitlePng({ width: 854, height: 480, text: 'PNG 字幕。', style })
}, unit.style)
check('前端生成 cue PNG', String(cuePng || '').startsWith('data:image/png'))
const pngJob = await post(
  [
    {
      kind: 'shot',
      seconds: 2,
      image: '/generated/blender-bmvl0f76b100fab-0.jpg',
      audioMode: 'none',
      captions: [{ startOffsetMs: 200, endOffsetMs: 1200, text: 'PNG 字幕。', sub: cuePng }],
    },
  ],
  { captionMode: 'png' },
)
const pngResult = await waitJob(pngJob.id)
check('无 libass 兜底导出成功', pngResult.status === 'succeeded', JSON.stringify(pngResult))
check('PNG 路径仍有 SRT sidecar', Boolean(pngResult.srtUrl), String(pngResult.srtUrl))

const badJob = await post([
  {
    kind: 'shot',
    seconds: 2,
    image: '/generated/blender-bmvl0f76b100fab-0.jpg',
    audioMode: 'none',
    captions: [{ startOffsetMs: 0, endOffsetMs: 5000, text: '越界字幕。' }],
  },
])
const badResult = await waitJob(badJob.id)
check(
  '越界 cue 被服务端夹紧并回报',
  badResult.status === 'succeeded' && (badResult.captionWarnings || []).some((w) => w.includes('超出真实时长')),
  JSON.stringify({ status: badResult.status, warnings: badResult.captionWarnings }),
)

check('无 pageerror', errors.length === 0, errors[0] || '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
