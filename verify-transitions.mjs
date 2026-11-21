/**
 * 接缝纯函数回归：默认叠化、接缝解析、时长夹紧、重叠时间账、非相邻、
 * 持久化映射、旧生成配置降级。
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
    `export * from ${abs('src/transitionPresets.ts')}`,
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

// ---- 旧存档里的生成配置被剥离 ----
const legacy = lib.normalizeTransitionOut(
  {
    to: 'x',
    mode: 'generated',
    effect: { type: 'wipe', dir: 'right', seconds: 0.8 },
    generated: { targetSeconds: 2.2, prompt: 'p', inheritRefs: false, refIds: ['char-1'] },
  },
  'x',
)
check('mode 收敛为 effect', legacy.mode === 'effect')
check('generated 被剥离', !('generated' in legacy))
check('效果配置保留', legacy.effect.type === 'wipe' && legacy.effect.seconds === 0.8)
const legacyJoin = lib.resolveJoin(legacy, 3, 3)
check('旧生成数据按效果渲染', legacyJoin.mode === 'effect' && legacyJoin.seconds === 0.8)

// ---- 剪辑序列：重叠 ----
const a = shot('n1', 'S01', 3, { transitionOut: lib.defaultTransition('E01-S02') })
const b = shot('n2', 'S02', 3)
const list = lib.buildEditList([a, b], [edge('n1', 'n2', 'transition')])
check('叠化总长 3+3-0.5=5.5', near(list.total, 5.5), `got ${list.total}`)
check('第二镜起点 2.5', near(list.items[1].start, 2.5), `got ${list.items[1].start}`)
check('接缝是效果 0.5', list.items[1].joinIn.kind === 'effect' && list.items[1].joinIn.seconds === 0.5)
check('序列里只有镜头条目', list.items.every((x) => x.kind === 'shot'))
check('序列没有 transitions 计数', !('transitions' in list))
check('序列没有 stale 列表', !('stale' in list))

// ---- 旧存档：只有 relation，没有 transitionOut ----
const oldA = shot('o1', 'S01', 3)
const oldB = shot('o2', 'S02', 3)
const oldList = lib.buildEditList([oldA, oldB], [edge('o1', 'o2', 'transition')])
check('旧边按默认叠化解释', near(oldList.total, 5.5))

// ---- 旧存档带生成产物：按叠化渲染，不插入片段 ----
const legacyA = shot('g1', 'S01', 3, {
  transitionOut: {
    to: 'E01-S02',
    mode: 'generated',
    effect: { type: 'dissolve', seconds: 0.5 },
    generated: { targetSeconds: 1.2, prompt: '', inheritRefs: true, video: { url: '/v.mp4' } },
  },
})
const legacyB = shot('g2', 'S02', 3)
const legacyList = lib.buildEditList([legacyA, legacyB], [edge('g1', 'g2', 'transition')])
check('生成产物不插入片段', legacyList.items.length === 2, String(legacyList.items.length))
check('生成产物按叠化重叠', near(legacyList.total, 5.5), `got ${legacyList.total}`)

// ---- 非相邻 ----
const c = shot('n3', 'S03', 3)
const list5 = lib.buildEditList([a, b, c], [edge('n1', 'n3', 'transition')])
check('非相邻计入 inactive', list5.inactive.length === 1 && list5.inactive[0].edgeId === 'e-n1-n3')
check('非相邻不让总长变短', near(list5.total, 9), `got ${list5.total}`)

// ---- 持久化映射 ----
const syncNode = shot('s1', 'S01', 3, {
  transitionOut: {
    to: 'E01-S02',
    mode: 'generated',
    effect: { type: 'dissolve', seconds: 0.5 },
    generated: { targetSeconds: 1.2, prompt: 'p', inheritRefs: true, video: { url: '/v.mp4' } },
  },
})
const ps = lib.nodeToShot(syncNode.data, 'E01-S01')
check('nodeToShot 写出 transition_out', ps.transition_out?.to === 'E01-S02')
check('nodeToShot 不写 generated', !('generated' in (ps.transition_out ?? {})))
const back = lib.shotToData(ps, syncNode.data)
check('shotToData 读回效果字段', back.transitionOut?.effect?.seconds === 0.5)
check('shotToData 不读回 generated', !('generated' in (back.transitionOut ?? {})))
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
check(
  '擦除摘要带方向',
  lib.transitionSummary({ to: 'x', mode: 'effect', effect: { type: 'wipe', dir: 'right', seconds: 0.6 } }) ===
    '擦除→ 0.6s',
)

// ---- 效果预设 ----
check('预设不少于 12 项', lib.PRESET_COUNT >= 12)
check('黑场预设映射 fadeblack', lib.xfadeName({ presetId: 'fadeblack', type: 'dissolve', seconds: 0.5 }) === 'fadeblack')
check('无效预设回退叠化', lib.normalizeEffect({ presetId: 'no-such-preset', seconds: 0.5 }).presetId === 'dissolve')
check('旧擦除兼容 wiperight', lib.xfadeName({ type: 'wipe', dir: 'right', seconds: 0.5 }) === 'wiperight')

// ---- 不再导出的生成侧 API ----
for (const name of [
  'normalizeGenerated',
  'generatedFade',
  'generatedClipSeconds',
  'hasGeneratedVideo',
  'transitionFingerprint',
]) {
  check(`生成侧 API 已移除：${name}`, typeof lib[name] === 'undefined')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
