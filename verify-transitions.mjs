/**
 * 转场纯函数回归：默认叠化、接缝解析、时长夹紧、插入/重叠时间账、
 * 非相邻、失效指纹、持久化映射、模型时长分流。
 * 跑法：node verify-transitions.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-transitions-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/transition.ts')}`,
    `export * from ${abs('src/editList.ts')}`,
    `export * from ${abs('src/shotSync.ts')}`,
    `export * from ${abs('src/transitionGen.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

const IMG1 = '/generated/shot-1792653104009-fe6e05.jpg'
const IMG2 = '/generated/shot-1792635049165-29ec33.jpg'
const VID = '/videos/shot-vid-1792813683482-86dc69.mp4'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const near = (a, b) => Math.abs(a - b) < 1e-6

const shot = (id, no, seconds, extra = {}) => ({
  id,
  type: 'shot',
  data: {
    no,
    seconds,
    shotId: `E01-${no}`,
    refImage: '',
    videoUrl: '',
    marks: [],
    ...extra,
  },
})
const edge = (source, target, relation = 'cut') => ({
  id: `e-${source}-${target}`,
  source,
  target,
  type: 'shot',
  data: { relation },
})
const generated = (video, seconds = 1.2, trimTo = 1.2) => ({
  targetSeconds: 1.2,
  prompt: '',
  inheritRefs: true,
  boundary: { out: '/a.jpg', in: '/b.jpg' },
  keyframe: { candidates: ['/k.jpg'], activeIdx: 0, image: '/k.jpg' },
  video: { url: video, seconds, ...(trimTo ? { trimTo } : {}) },
})

// ---- 默认值与效果解析 ----
const def = lib.defaultTransition('E01-S02')
check(
  '默认接缝 = 叠化 0.5s',
  def.mode === 'effect' && def.effect.type === 'dissolve' && def.effect.seconds === 0.5,
)
check('默认 xfade = fade', lib.xfadeName(def.effect) === 'fade')
check(
  '擦除方向映射',
  lib.xfadeName({ type: 'wipe', dir: 'right', seconds: 0.5 }) === 'wiperight',
)
check('推移方向映射', lib.xfadeName({ type: 'slide', dir: 'up', seconds: 0.5 }) === 'slideup')
check('摘要 = 叠化 0.5s', lib.transitionSummary(def) === '叠化 0.5s')

const effectJoin = lib.resolveJoin(def, 3, 3)
check(
  '效果解析：0.5s 重叠',
  effectJoin.mode === 'effect' && effectJoin.seconds === 0.5 && effectJoin.xfade === 'fade',
)
const clamped = lib.resolveJoin({ mode: 'effect', effect: { type: 'wipe', dir: 'left', seconds: 2 } }, 3, 3)
check('时长夹到 1.5s 上限', clamped.mode === 'effect' && clamped.seconds === 1.5)
const short = lib.resolveJoin(def, 0.4, 0.4)
check('短镜夹到 0.32s', short.mode === 'effect' && short.seconds === 0.32)
const tooShort = lib.resolveJoin(
  { mode: 'effect', effect: { type: 'dissolve', seconds: 0.1 } },
  0.4,
  0.4,
)
check('低于 0.2s 退回硬切', tooShort.mode === 'cut')

// ---- 两套配置共存 ----
const dual = lib.normalizeTransitionOut(
  {
    to: 'x',
    mode: 'generated',
    effect: { type: 'wipe', dir: 'right', seconds: 0.8 },
    generated: { targetSeconds: 2.2, prompt: 'p', inheritRefs: false, refIds: ['char-1'] },
  },
  'x',
)
check(
  '效果与生成配置并存',
  dual.mode === 'generated' &&
    dual.effect.type === 'wipe' &&
    dual.generated.targetSeconds === 2.2 &&
    dual.generated.refIds[0] === 'char-1',
)

// ---- 剪辑序列：重叠 ----
const a = shot('n1', 'S01', 3, { transitionOut: lib.defaultTransition('E01-S02') })
const b = shot('n2', 'S02', 3)
const list = lib.buildEditList([a, b], [edge('n1', 'n2', 'transition')])
check('叠化总长 3+3-0.5=5.5', near(list.total, 5.5), `got ${list.total}`)
check('第二镜起点 2.5', near(list.items[1].start, 2.5), `got ${list.items[1].start}`)
check('接缝是效果 0.5', list.items[1].joinIn.kind === 'effect' && list.items[1].joinIn.seconds === 0.5)
check('没有生成片段', list.transitions === 0)

// ---- 剪辑序列：生成转场插入 ----
const b2 = shot('n2b', 'S02', 3)
const a2 = shot('n1b', 'S01', 3, {
  transitionOut: {
    to: 'E01-S02',
    mode: 'generated',
    effect: { type: 'dissolve', seconds: 0.5 },
    generated: generated('/v.mp4'),
  },
})
const fp = lib.transitionFingerprint(a2.data, b2.data, a2.data.transitionOut.generated)
a2.data.transitionOut.meta = { fingerprint: fp, createdAt: 'now' }
const list2 = lib.buildEditList([a2, b2], [edge('n1b', 'n2b', 'transition')])
check('生成转场总长 3+1.2+3-0.4=6.8', near(list2.total, 6.8), `got ${list2.total}`)
check('一个生成片段', list2.transitions === 1)
check(
  '片段时长 1.2、两端 0.2',
  list2.items[1].kind === 'transition' &&
    list2.items[1].duration === 1.2 &&
    list2.items[1].joinIn.seconds === 0.2 &&
    list2.items[2].joinIn.seconds === 0.2,
)
check(
  '生成片段两端固定叠化（不跟效果配置走）',
  list2.items[1].joinIn.effect?.type === 'dissolve' &&
    list2.items[2].joinIn.effect?.type === 'dissolve',
)
check('指纹一致不失效', list2.stale.length === 0)

// ---- 失效 ----
const b3 = { ...b2, data: { ...b2.data, videoUrl: '/changed.mp4' } }
const list3 = lib.buildEditList([a2, b3], [edge('n1b', 'n2b', 'transition')])
check('相邻镜头变化 → 失效', list3.stale.length === 1)

// ---- 生成失败回落效果 ----
const a4 = shot('n4', 'S01', 3, {
  transitionOut: {
    to: 'E01-S02',
    mode: 'generated',
    effect: { type: 'dissolve', seconds: 0.5 },
    generated: { targetSeconds: 1.2, prompt: '', inheritRefs: true },
  },
})
const b4 = shot('n5', 'S02', 3)
const list4 = lib.buildEditList([a4, b4], [edge('n4', 'n5', 'transition')])
check(
  '生成未出片 → 暂按叠化',
  near(list4.total, 5.5) && list4.items[1].joinIn.kind === 'effect' && list4.items[1].joinIn.seconds === 0.5,
)

// ---- 旧存档：只有 relation，没有 transitionOut ----
const oldA = shot('o1', 'S01', 3)
const oldB = shot('o2', 'S02', 3)
const oldList = lib.buildEditList([oldA, oldB], [edge('o1', 'o2', 'transition')])
check('旧边按默认叠化解释', near(oldList.total, 5.5))

// ---- 非相邻 ----
const c = shot('n3', 'S03', 3)
const list5 = lib.buildEditList([a, b, c], [edge('n1', 'n3', 'transition')])
check('非相邻计入 inactive', list5.inactive.length === 1 && list5.inactive[0].edgeId === 'e-n1-n3')
check('非相邻不让总长变短', near(list5.total, 9), `got ${list5.total}`)

// ---- 模型时长分流 ----
const ark = lib.transitionRequestSeconds(1.2, 'doubao-seedance-1-0-pro-250528', false)
check('方舟 1.0：请求 2s、裁到 1.2s', ark.seconds === 2 && ark.trimTo === 1.2)
const s25 = lib.transitionRequestSeconds(1.2, 'seedance-2.5', true)
check('Seedance 2.5：请求 4s、不裁', s25.seconds === 4 && s25.trimTo === undefined)
const kling = lib.transitionRequestSeconds(1.2, 'kling-v3', true)
check('Kling v3：请求 3s、不裁', kling.seconds === 3 && kling.trimTo === undefined)
check('Seedance 1.5 下限 4s', lib.videoMinSeconds('doubao-seedance-1-5-pro') === 4)

// ---- 关键帧参考上限 ----
const many = Array.from({ length: 12 }, (_, i) => `/r${i}.jpg`)
const limited = lib.clampKeyframeRefs(many)
check('参考最多 10 张并报告省略', limited.urls.length === 10 && limited.omitted === 2)
const dupe = lib.clampKeyframeRefs(['/a.jpg', '/a.jpg', '/b.jpg'])
check('参考去重', dupe.urls.length === 2)

// ---- 默认提示词 ----
const pa = shot('p1', 'S01', 3, { prompt: '夜市推车，霓虹反光' })
const pb = shot('p2', 'S02', 3, { prompt: '摊主推过义体手臂' })
const prompt = lib.defaultTransitionPrompt(pa, pb)
check('默认提示词带上两镜内容', prompt.includes('夜市推车') && prompt.includes('义体手臂'))

// ---- 持久化映射 ----
const syncNode = shot('s1', 'S01', 3, {
  transitionOut: {
    to: 'E01-S02',
    mode: 'generated',
    effect: { type: 'dissolve', seconds: 0.5 },
    generated: generated('/v.mp4'),
  },
})
const ps = lib.nodeToShot(syncNode.data, 'E01-S01')
check('nodeToShot 写出 transition_out', ps.transition_out?.to === 'E01-S02')
const back = lib.shotToData(ps, syncNode.data)
check(
  'shotToData 读回生成字段',
  back.transitionOut?.generated?.video?.url === '/v.mp4' &&
    back.transitionOut?.generated?.keyframe?.image === '/k.jpg',
)
const sig1 = lib.bizSignature(syncNode.data)
syncNode.data.transitionOut.effect.seconds = 0.8
const sig2 = lib.bizSignature(syncNode.data)
check('接缝变化进业务签名', sig1 !== sig2)
check('无接缝时签名为空值', lib.bizSignature(shot('x', 'S09', 3).data).includes('"transitionOut":null'))
const cleared = lib.nodeToShot(shot('c1', 'S01', 3).data, 'E01-S01')
check('清除转场写出 null（否则 mergeShots 会保留旧值）', cleared.transition_out === null)
const fallbackWithTransition = {
  ...shot('c2', 'S01', 3).data,
  transitionOut: lib.defaultTransition('E01-S02'),
}
const clearedBack = lib.shotToData({ ...cleared, transition_out: null }, fallbackWithTransition)
check('显式 null 不复活旧转场', clearedBack.transitionOut === undefined)
const { transition_out: _omit, ...withoutTransition } = cleared
const absentBack = lib.shotToData(withoutTransition, fallbackWithTransition)
check('字段缺失（旧项目）才沿用画布值', absentBack.transitionOut?.to === 'E01-S02')

// ---- 摘要 ----
const genSummary = lib.transitionSummary({
  to: 'E01-S02',
  mode: 'generated',
  effect: { type: 'dissolve', seconds: 0.5 },
  generated: generated('/v.mp4'),
})
check('生成摘要 = 生成 1.2s', genSummary === '生成 1.2s', genSummary)

// ---- 边界帧：有视频抽首尾，无视频回退当前画面（需要 dev server）----
const health = await fetch('http://127.0.0.1:5273/api/health').catch(() => null)
if (health?.ok) {
  const origFetch = globalThis.fetch
  globalThis.fetch = (u, init) =>
    origFetch(typeof u === 'string' && u.startsWith('/') ? `http://127.0.0.1:5273${u}` : u, init)
  try {
    const s = { id: 'v1', type: 'shot', data: { videoUrl: VID, refImage: IMG1 } }
    const t = { id: 'v2', type: 'shot', data: { videoUrl: VID, refImage: IMG2 } }
    const b = await lib.ensureTransitionBoundary(s, t)
    check(
      '有视频时抽到首尾两帧',
      Boolean(b.boundary.out?.startsWith('/generated/') && b.boundary.in?.startsWith('/generated/')),
      JSON.stringify(b.boundary),
    )
    const s2 = { id: 'v3', type: 'shot', data: { refImage: IMG1 } }
    const t2 = { id: 'v4', type: 'shot', data: { refImage: IMG2 } }
    const b2 = await lib.ensureTransitionBoundary(s2, t2)
    check('无视频时回退当前画面', b2.boundary.out === IMG1 && b2.boundary.in === IMG2)
  } finally {
    globalThis.fetch = origFetch
  }
} else {
  console.log('⚠️ dev server 不在，跳过边界帧集成')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
