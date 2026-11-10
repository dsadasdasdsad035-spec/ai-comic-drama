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
    `export * from ${abs('src/transitionPresets.ts')}`,
    `export * from ${abs('src/transitionSuggest.ts')}`,
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
check('不提交尾帧：请求 2s、裁到 1.2s', ark.seconds === 2 && ark.trimTo === 1.2)
const s25 = lib.transitionRequestSeconds(1.2, 'seedance-2.5', true)
check('提交尾帧：请求 4s、不裁', s25.seconds === 4 && s25.trimTo === undefined)
const kling = lib.transitionRequestSeconds(1.2, 'kling-v3', true)
check('提交尾帧：Kling 请求 3s、不裁', kling.seconds === 3 && kling.trimTo === undefined)
const onlyFirst = lib.transitionRequestSeconds(1.2, 'seedance-2.5', false)
check('Seedance 2.5 只首帧：请求加余量并裁', onlyFirst.seconds === 4 && onlyFirst.trimTo === 1.2)
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

// ---- 转场衔接正文（shot-transition-continuity）----
const fullA = shot('cA', 'S01', 3, {
  size: '全景',
  move: '推镜',
  prompt: '猫抬头',
  visualBrief: {
    version: 1,
    usedVision: false,
    subjects: [],
    visible: [],
    shotSize: '近景',
    cameraHint: { height: 'low', angle: '仰拍' },
  },
})
const fullB = shot('cB', 'S02', 3, { size: '特写', move: '横移', prompt: '猫跳下' })
const autoFull = lib.autoTransitionVideoPrompt(fullA, fullB, { targetSeconds: 1.2, prompt: '', inheritRefs: true })
check(
  '齐全时出现衔接段',
  autoFull.includes('衔接：') && autoFull.includes('推镜') && autoFull.includes('横移'),
)
check('视觉 brief 景别优先于 size', autoFull.includes('上一镜 近景'))
check('机位提示进正文', autoFull.includes('低机位') && autoFull.includes('仰拍'))

const noSizeA = shot('cA2', 'S01', 3, { prompt: 'a' })
const noSizeB = shot('cB2', 'S02', 3, { prompt: 'b' })
const autoNoSize = lib.autoTransitionVideoPrompt(noSizeA, noSizeB, { targetSeconds: 1.2, prompt: '', inheritRefs: true })
check('缺景别不出景别句', !autoNoSize.includes('景别：'))
check('缺运镜不出运镜句', !autoNoSize.includes('运镜：'))

const sizeOnlyA = shot('cA3', 'S01', 3, { size: '中景', prompt: 'a' })
const sizeOnlyB = shot('cB3', 'S02', 3, { size: '近景', prompt: 'b' })
const autoSizeOnly = lib.autoTransitionVideoPrompt(sizeOnlyA, sizeOnlyB, {
  targetSeconds: 1.2,
  prompt: '',
  inheritRefs: true,
})
check('仅景别无运镜', autoSizeOnly.includes('景别：') && !autoSizeOnly.includes('运镜：'))

const override = lib.effectiveTransitionVideoPrompt(fullA, fullB, {
  targetSeconds: 1.2,
  prompt: '',
  inheritRefs: true,
  videoPromptOverride: '手写整段',
})
check('手改正文逐字、不含衔接段', override.text === '手写整段' && override.source === 'override')

const genG = { targetSeconds: 1.2, prompt: '', inheritRefs: true }
const fp1 = lib.transitionFingerprint(fullA.data, fullB.data, genG)
const fullA2 = { ...fullA, data: { ...fullA.data, size: '远景', visualBrief: undefined } }
const fp2 = lib.transitionFingerprint(fullA2.data, fullB.data, genG)
check('改景别使指纹变化', fp1 !== fp2)
const fpMove1 = lib.transitionFingerprint(fullA.data, fullB.data, genG)
const fullB2 = { ...fullB, data: { ...fullB.data, move: '摇镜' } }
const fpMove2 = lib.transitionFingerprint(fullA.data, fullB2.data, genG)
check('改运镜使指纹变化', fpMove1 !== fpMove2)

const previewG = {
  targetSeconds: 1.2,
  prompt: '',
  inheritRefs: true,
  bridging: 'morph',
  boundary: { out: '/a.jpg', in: '/b.jpg' },
}
const prev = lib.buildTransitionVideoPreview({ source: fullA, target: fullB, generated: previewG })
check('预览与自动正文一致含衔接', prev.prompt.includes('衔接：') && prev.promptSource === 'auto')
const noBoundaryPrev = lib.buildTransitionVideoPreview({
  source: fullA,
  target: fullB,
  generated: { targetSeconds: 1.2, prompt: '', inheritRefs: true, bridging: 'morph' },
  model: { model: 'seedance-2.5', features: { lastFrame: true, textToVideo: true } },
})
check(
  '缺边界不再 blocking',
  !noBoundaryPrev.blocking.some((b) => b.code === 'transition-boundary-missing'),
  JSON.stringify(noBoundaryPrev.blocking.map((b) => b.code)),
)
check('缺边界时输入模式为纯文本', noBoundaryPrev.inputMode === 'text')
const panelModel = lib.transitionPreviewToPromptPanelModel(prev, '720p')
check('panel 前缀含首尾帧', panelModel.refPrefix.length === 2 && panelModel.refPrefix[0]?.bold === '首帧')
check('blocking 为 issue 结构', prev.warnings.every((w) => w.code && w.level))
check('预览含衔接块字段', prev.continuityPreview.includes('衔接：'))
check('首尾直变风格参考未提交', prev.submittedStyleCount === 0)

const reqBundle = lib.buildTransitionVideoRequest({
  source: fullA,
  target: fullB,
  generated: previewG,
  model: { model: 'seedance-2.5', features: { lastFrame: true }, label: '2.5' },
})
check('请求正文与预览一致', reqBundle.prompt === prev.prompt)
check('morph 下 refImages 为空', reqBundle.refImages.length === 0)

const refShotA = shot('ra', 'S01', 3, { refExtras: ['/extra-a.jpg'] })
const refShotB = shot('rb', 'S02', 3, { refExtras: ['/extra-b.jpg'] })
const mergePrev = lib.buildTransitionVideoPreview({
  source: refShotA,
  target: refShotB,
  generated: {
    ...previewG,
    refIds: ['extra:/extra-a.jpg', 'extra:/extra-b.jpg'],
  },
  nodes: [refShotA, refShotB],
  characters: [],
  missingMedia: new Set(),
})
check('双镜合并手工参考', mergePrev.refs.length === 2, String(mergePrev.refs.length))
check(
  '转场正文含参考图槽位描述',
  mergePrev.prompt.includes('参考图：') &&
    mergePrev.prompt.includes('[图1]=手工参考图') &&
    mergePrev.prompt.includes('[首帧]='),
)
check('合并 refs 槽位同构', mergePrev.refs[0]?.slot === 'image' && mergePrev.refs[0]?.index === 1)

const kfGen = {
  targetSeconds: 1.2,
  prompt: '',
  bridging: 'keyframe',
  keyframe: { image: '/k.jpg', candidates: ['/k.jpg'], activeIdx: 0 },
  refIds: ['extra:/extra-a.jpg', 'extra:/extra-b.jpg'],
}
const kfReq = lib.buildTransitionVideoRequest({
  source: refShotA,
  target: refShotB,
  generated: kfGen,
  nodes: [refShotA, refShotB],
  model: { model: 'doubao-seedance-1-0', features: { lastFrame: false } },
})
check('关键帧模式可提交参考图', kfReq.refImages.length === 2, String(kfReq.refImages.length))

const noInherit = lib.buildTransitionVideoPreview({
  source: refShotA,
  target: refShotB,
  generated: { ...previewG, inheritRefs: false, refIds: [] },
  nodes: [refShotA, refShotB],
})
check('无 refIds 则不含风格参考', noInherit.refs.length === 0)

const assetCanvas = {
  id: 'asset-scene-canvas',
  type: 'asset',
  data: { title: '厨房', kind: 'scene', url: '/canvas/kitchen.jpg' },
}
const canvasSuppPrev = lib.buildTransitionVideoPreview({
  source: refShotA,
  target: refShotB,
  generated: {
    ...previewG,
    inheritRefs: false,
    refIds: ['asset-scene-canvas'],
    bridging: 'keyframe',
    keyframe: { image: '/k.jpg', candidates: ['/k.jpg'], activeIdx: 0 },
  },
  nodes: [refShotA, refShotB, assetCanvas],
  characters: [],
  missingMedia: new Set(),
})
check(
  '画布 supplemental refIds 进入预览 refs',
  canvasSuppPrev.refs.some((r) => r.url === '/canvas/kitchen.jpg'),
  JSON.stringify(canvasSuppPrev.refs.map((r) => r.url)),
)
check(
  'supplemental 标记为 added',
  canvasSuppPrev.styleRefs.some(
    (r) => r.token === 'asset-scene-canvas' && r.kind === 'added' && r.url === '/canvas/kitchen.jpg',
  ),
)

const trEid = lib.transitionRefEdgeId('seq-n1-n2', 'asset-scene-canvas')
const trParsed = lib.parseTransitionRefEdgeId(trEid)
check(
  '转场参考边 id 往返',
  trParsed?.edgeId === 'seq-n1-n2' && trParsed?.refSourceId === 'asset-scene-canvas',
)
check('非法 ref-tr 解析为 null', lib.parseTransitionRefEdgeId('ref-tr|only') === null)

const sigBase = {
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '固定',
  dialogue: '',
  prompt: '',
  marks: [],
  transitionOut: lib.normalizeTransitionOut(
    { to: 'E01-S02', mode: 'generated', generated: { targetSeconds: 1.2, refIds: [] } },
    'E01-S02',
  ),
}
const bizSigEmpty = lib.bizSignature(sigBase)
const bizSigWithRef = lib.bizSignature({
  ...sigBase,
  transitionOut: lib.normalizeTransitionOut(
    {
      to: 'E01-S02',
      mode: 'generated',
      generated: { targetSeconds: 1.2, refIds: ['asset-scene-canvas'] },
    },
    'E01-S02',
  ),
})
check('generated.refIds 变化触发 bizSignature', bizSigEmpty !== bizSigWithRef)

const fpPrompt1 = lib.transitionVideoPromptFingerprint(fullA, fullB, previewG, [])
const fpPrompt2 = lib.transitionVideoPromptFingerprint(fullA, fullB, {
  ...previewG,
  boundary: { out: '/a.jpg', in: '/c.jpg' },
}, [])
check('改 boundary 使 prompt 指纹变化', fpPrompt1 !== fpPrompt2)
const fpPrompt3 = lib.transitionVideoPromptFingerprint(fullA, fullB, {
  ...previewG,
  videoPromptOverride: { text: 'x', fingerprint: 'same', createdAt: 'now' },
}, [])
check('override 不改变 prompt 指纹', fpPrompt1 === fpPrompt3)
const staleOverride = lib.effectiveTransitionVideoPrompt(
  fullA,
  fullB,
  {
    ...previewG,
    videoPromptOverride: { text: '手改', fingerprint: 'old-fp', createdAt: 'now' },
  },
  [],
)
check('手改指纹不匹配标 stale', staleOverride.stale === true)

const fpRef1 = lib.transitionFingerprint(fullA.data, fullB.data, { ...previewG, refIds: ['char-x'] })
const fpRef2 = lib.transitionFingerprint(fullA.data, fullB.data, { ...previewG, refIds: ['char-y'] })
check('refIds 进指纹', fpRef1 !== fpRef2)
const fpEx1 = lib.transitionFingerprint(fullA.data, fullB.data, {
  ...previewG,
  excludeRefIds: ['char-a'],
})
const fpEx2 = lib.transitionFingerprint(fullA.data, fullB.data, {
  ...previewG,
  excludeRefIds: ['char-b'],
})
check('excludeRefIds 进指纹', fpEx1 !== fpEx2)

// ---- 效果预设 ----
check('预设不少于 12 项', lib.PRESET_COUNT >= 12)
check('黑场预设映射 fadeblack', lib.xfadeName({ presetId: 'fadeblack', type: 'dissolve', seconds: 0.5 }) === 'fadeblack')
check('无效预设回退叠化', lib.normalizeEffect({ presetId: 'no-such-preset', seconds: 0.5 }).presetId === 'dissolve')
check('旧擦除兼容 wiperight', lib.xfadeName({ type: 'wipe', dir: 'right', seconds: 0.5 }) === 'wiperight')

// ---- 智能建议 ----
const sA = shot('sA', 'S01', 3, { size: '全景', sceneNo: 1, sceneSlug: '街口', move: '固定' })
const sB = shot('sB', 'S02', 3, { size: '特写', sceneNo: 2, sceneSlug: '室内', move: '推镜', videoUrl: '/v.mp4' })
const sug = lib.suggestTransition({ source: sA.data, target: sB.data })
check('跨场建议有效', sug.mode === 'effect' || sug.mode === 'generated')
const applied = lib.applyTransitionSuggestion(
  { mode: 'generated', rationale: 't', generated: { prompt: '动作过桥', recipeIds: ['match-cut-action'] } },
  lib.defaultTransition('E01-S02'),
  { preserveVideoPromptOverride: true },
)
check('应用建议写入生成', applied.mode === 'generated' && applied.generated.prompt.includes('动作过桥'))
const withOverride = {
  ...lib.defaultTransition('E01-S02'),
  generated: {
    ...lib.normalizeGenerated({ targetSeconds: 1.2, prompt: '', inheritRefs: true }),
    videoPromptOverride: '手改全文',
  },
}
const appliedKeep = lib.applyTransitionSuggestion(
  { mode: 'generated', rationale: 't', generated: { prompt: '新句' } },
  withOverride,
  { preserveVideoPromptOverride: true },
)
check(
  '应用建议保留 override',
  (typeof appliedKeep.generated.videoPromptOverride === 'string'
    ? appliedKeep.generated.videoPromptOverride
    : appliedKeep.generated.videoPromptOverride?.text) === '手改全文',
)
const fpEff1 = lib.transitionFingerprint(sA.data, sB.data, { targetSeconds: 1.2, prompt: '', inheritRefs: true }, {
  presetId: 'fadeblack',
  type: 'dissolve',
  seconds: 0.5,
})
const fpEff2 = lib.transitionFingerprint(sA.data, sB.data, { targetSeconds: 1.2, prompt: '', inheritRefs: true }, {
  presetId: 'radial',
  type: 'dissolve',
  seconds: 0.5,
})
check('效果预设进指纹', fpEff1 !== fpEff2)
const autoAfter = lib.autoTransitionVideoPrompt(
  sA,
  sB,
  lib.normalizeGenerated({ ...applied.generated, targetSeconds: 1.2, inheritRefs: true }),
)
check('应用后自动正文仍含衔接', autoAfter.includes('衔接：'))

// ---- 边界来源标签与候选（不依赖 dev server）----
check('来源标签：上镜尾帧', lib.boundarySourceLabel('source-tail') === '上镜尾帧')
check('来源标签：媒体库', lib.boundarySourceLabel('library') === '媒体库')
check('来源标签：未知给中性文案', lib.boundarySourceLabel(undefined) === '已选画面')
const legacyBoundary = lib.normalizeGenerated({
  targetSeconds: 1.2,
  prompt: '',
  boundary: { out: IMG1, in: IMG2 },
})
check('旧边界无来源字段仍保留 URL', legacyBoundary.boundary?.out === IMG1 && !legacyBoundary.boundary?.outFrom)
const sourcedBoundary = lib.normalizeGenerated({
  targetSeconds: 1.2,
  prompt: '',
  boundary: { out: IMG1, in: IMG2, outFrom: 'library', inFrom: 'bogus' },
})
check(
  '来源透传且非法值丢弃',
  sourcedBoundary.boundary?.outFrom === 'library' && sourcedBoundary.boundary?.inFrom === undefined,
)
const boundarySource = shot('c1', 'C01', 3, { refImage: IMG1, videoUrl: '' })
const boundaryTarget = shot('c2', 'C02', 3, { refImage: '/generated/target.jpg', videoUrl: '' })
const noVideoBoundary = await lib.ensureTransitionBoundary(boundarySource, boundaryTarget)
check(
  '没有成片不回退静帧',
  noVideoBoundary.boundary.out === undefined && noVideoBoundary.boundary.in === undefined,
  JSON.stringify(noVideoBoundary.boundary),
)
check(
  '没有成片给出可执行提示',
  noVideoBoundary.warnings.some((w) => w.includes('还没有成片')),
  noVideoBoundary.warnings.join('；'),
)

// ---- 输入模式降级链与来源标签 ----
const textCapModel = {
  model: 'seedance-2.5',
  providerKind: 'apimart',
  features: { lastFrame: true, textToVideo: true },
}
const noTextCapModel = { model: 'kling-v3', providerKind: 'apimart', features: { lastFrame: true } }
const modeText = lib.buildTransitionVideoPreview({
  source: sA,
  target: sB,
  generated: lib.normalizeGenerated({ targetSeconds: 1.2, prompt: '' }),
  model: textCapModel,
})
check('纯文本模式：无输入但模型支持', modeText.inputMode === 'text' && modeText.blocking.length === 0)
const modeNone = lib.buildTransitionVideoPreview({
  source: sA,
  target: sB,
  generated: lib.normalizeGenerated({ targetSeconds: 1.2, prompt: '' }),
  model: noTextCapModel,
})
check(
  '不支持文生视频时 blocking',
  modeNone.inputMode === 'none' &&
    modeNone.blocking.some((b) => b.code === 'transition-no-input'),
  JSON.stringify(modeNone.blocking.map((b) => b.code)),
)
const modeFirst = lib.buildTransitionVideoPreview({
  source: sA,
  target: sB,
  generated: lib.normalizeGenerated({
    targetSeconds: 1.2,
    prompt: '',
    boundary: { out: IMG1, outFrom: 'source-tail' },
  }),
  model: textCapModel,
})
check('只选首帧 → first-frame', modeFirst.inputMode === 'first-frame' && Boolean(modeFirst.trimTo))
check(
  '只选首帧不要求模型支持尾帧',
  !modeFirst.blocking.some((b) => b.code === 'transition-no-last-frame'),
)
const modeBoundary = lib.buildTransitionVideoPreview({
  source: sA,
  target: sB,
  generated: lib.normalizeGenerated({
    targetSeconds: 1.2,
    prompt: '',
    boundary: { out: IMG1, in: IMG2 },
  }),
  model: textCapModel,
})
check(
  '两帧齐全 → boundary 且不裁剪',
  modeBoundary.inputMode === 'boundary' &&
    modeBoundary.submitsLastFrame &&
    modeBoundary.trimTo === undefined,
)
check(
  '纯文本模式判定的五种输入',
  lib.resolveTransitionInputMode({ boundary: { out: 'a', in: 'b' }, refCount: 0, hasVideoRef: false }) ===
    'boundary' &&
    lib.resolveTransitionInputMode({ boundary: { out: 'a' }, refCount: 0, hasVideoRef: false }) ===
      'first-frame' &&
    lib.resolveTransitionInputMode({ refCount: 2, hasVideoRef: false }) === 'reference' &&
    lib.resolveTransitionInputMode({ refCount: 0, hasVideoRef: true }) === 'video-reference' &&
    lib.resolveTransitionInputMode({ refCount: 0, hasVideoRef: false, features: { textToVideo: true } }) ===
      'text',
)
const sourcedPreview = lib.buildTransitionVideoPreview({
  source: sA,
  target: sB,
  generated: lib.normalizeGenerated({
    targetSeconds: 1.2,
    prompt: '',
    boundary: { out: IMG1, in: IMG2, outFrom: 'library', inFrom: 'target-head' },
  }),
  model: { model: 'seedance-2.5', providerKind: 'apimart', features: { lastFrame: true } },
})
check(
  '附件标签使用实际来源',
  sourcedPreview.attachments.some((a) => a.label === '首帧 · 媒体库') &&
    sourcedPreview.attachments.some((a) => a.label === '尾帧 · 下镜首帧'),
  JSON.stringify(sourcedPreview.attachments.map((a) => a.label)),
)
const appSource = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const genBlock = appSource.slice(appSource.indexOf('const generateTransitionVideo'))
check(
  '生成路径不再调用自动抽帧',
  !genBlock.slice(0, genBlock.indexOf('const cancelTransitionVideo') > 0 ? genBlock.indexOf('const cancelTransitionVideo') : 12000).includes('ensureTransitionBoundary'),
)
check(
  '服务端不再因缺边界拒绝转场',
  !fs
    .readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    .includes('首尾直变需要首帧与尾帧，请先在「选择出片参考 → 首尾帧」'),
)
const modalSource = fs.readFileSync(path.join(root, 'src/OutgoingReferencePickerModal.tsx'), 'utf8')
check(
  '弹窗槽位由 boundarySlots 驱动且空值也渲染',
  modalSource.includes('boundarySlots.map(') && !modalSource.includes('boundaryRows'),
)
check(
  '弹窗不再有候选网格/媒体库入口',
  !modalSource.includes('orp-cand') &&
    !modalSource.includes('MediaPicker') &&
    modalSource.includes('onClearBoundary') &&
    modalSource.includes('抽取两镜成片帧'),
)
const panelSource = fs.readFileSync(path.join(root, 'src/TransitionPanel.tsx'), 'utf8')
check(
  '面板 morph 时构造两个槽位',
  panelSource.includes("preview.bridging !== 'morph'") &&
    panelSource.includes("label: '首帧 · 过渡起点'") &&
    panelSource.includes("label: '尾帧 · 过渡终点'"),
)
check(
  '抽取即写入两侧来源',
  panelSource.includes("'source-tail' as const") && panelSource.includes("'target-head' as const"),
)

// ---- 边界帧：有视频抽首尾；缺视频/抽帧失败不回退（需要 dev server）----
const health = await fetch('http://127.0.0.1:5273/api/health').catch(() => null)
if (health?.ok) {
  const origFetch = globalThis.fetch
  globalThis.fetch = (u, init) =>
    origFetch(typeof u === 'string' && u.startsWith('/') ? `http://127.0.0.1:5273${u}` : u, init)
  try {
    // 用真实存在的成片夹具；没有就退化为「只断言不回退」
    const videosDir = path.join(root, 'public', 'videos')
    const realVideo = fs.existsSync(videosDir)
      ? fs.readdirSync(videosDir).find((f) => /\.(mp4|webm)$/i.test(f))
      : undefined
    if (realVideo) {
      const vidUrl = `/videos/${realVideo}`
      const s = { id: 'v1', type: 'shot', data: { videoUrl: vidUrl, refImage: IMG1 } }
      const t = { id: 'v2', type: 'shot', data: { videoUrl: vidUrl, refImage: IMG2 } }
      const b = await lib.ensureTransitionBoundary(s, t)
      check(
        '有成片时抽到首尾两帧',
        Boolean(b.boundary.out?.startsWith('/generated/') && b.boundary.in?.startsWith('/generated/')),
        JSON.stringify(b.boundary),
      )
    } else {
      console.log('⚠️ public/videos 无成片夹具，跳过真实抽帧')
    }
    const s2 = { id: 'v3', type: 'shot', data: { refImage: IMG1 } }
    const t2 = { id: 'v4', type: 'shot', data: { refImage: IMG2 } }
    const b2 = await lib.ensureTransitionBoundary(s2, t2)
    check(
      '无成片不回退静帧',
      b2.boundary.out === undefined && b2.boundary.in === undefined,
      JSON.stringify(b2.boundary),
    )
    // 成片 URL 指向不存在的文件：抽帧失败，也必须留空而不是拿 refImage 顶上
    const sBad = { id: 'v5', type: 'shot', data: { videoUrl: VID, refImage: IMG1 } }
    const tBad = { id: 'v6', type: 'shot', data: { videoUrl: VID, refImage: IMG2 } }
    const bBad = await lib.ensureTransitionBoundary(sBad, tBad)
    check(
      '抽帧失败不回退静帧',
      bBad.boundary.out === undefined &&
        bBad.boundary.in === undefined &&
        bBad.warnings.some((w) => w.includes('抽取失败')),
      JSON.stringify(bBad.boundary),
    )
  } finally {
    globalThis.fetch = origFetch
  }
} else {
  console.log('⚠️ dev server 不在，跳过边界帧集成')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
