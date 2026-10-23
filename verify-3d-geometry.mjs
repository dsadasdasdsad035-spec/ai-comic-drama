/**
 * 3D 调度纯几何/上下文回归。
 * 用仓库里已有的 esbuild 把 TS 模块打成临时 ESM；不新增测试框架、不碰网络。
 *
 * 跑法：node verify-3d-geometry.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-3d-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

const geo = await import(bundle('src/scheduleGeometry.ts', 'geometry'))
const ctx = await import(bundle('src/scheduleContext.ts', 'context'))
const types = await import(bundle('src/types.ts', 'types'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

check('有效时长夹取 2~12 秒', types.effectiveSeconds(1) === 2 && types.effectiveSeconds(6) === 6 && types.effectiveSeconds(20) === 12)

// ---------------------------------------------------------------- 场景 sanitize / 墙体
const rawScene = {
  w: 10,
  h: 8,
  walls: [
    { x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 },
    { x1: 0, z1: 8, x2: 10, z2: 8, height: 2.8, thickness: 0.18, openings: [{ at: 3, width: 1, height: 2.1, kind: 'door' }] },
    { x1: 3, z1: 8, x2: 3, z2: 8, height: 2.8, thickness: 0.18 },
    { x1: 4, z1: 1, x2: 4, z2: 7, height: 2.8, thickness: 0.2, openings: [{ at: 2, width: 2, height: 1.2, kind: 'window', sill: 0.9 }] },
    { x1: 10, z1: 0, x2: 10, z2: 8, height: 2.8, thickness: 0.18 },
    'bad',
  ],
  props: [
    { name: '货架', shape: 'box', x: 2, z: 2, w: 1, d: 0.5, h: 2, rotation: 0 },
    { name: '坏物', shape: 'nope', x: 1, z: 1, w: 0, d: 1, h: 1 },
  ],
  zones: [{ name: '表演区', kind: 'action', x: 2, z: 2, w: 4, d: 3 }],
}
const { layout, warnings } = geo.sanitizeSceneLayout(rawScene, { episode: 1, sceneNo: 2, sceneSlug: '井道' })
check('sanitize 保留合法墙并丢掉坏墙', layout.walls.length === 4, String(layout.walls.length))
check('sanitize 丢掉坏固定物', layout.props.length === 1, String(layout.props.length))
check('sanitize 记录 warning', warnings.length >= 2, warnings.join(' | '))
check('sanitize 场景键', layout.id === 'E01-SC02' && layout.sceneSlug === '井道', layout.id)
const segs = geo.wallSegments(layout.walls[1])
check('门洞切段：两侧墙 + 门楣', segs.length === 3, JSON.stringify(segs))
check('门洞位置正确', segs.some((s) => s.a === 3 && s.b === 4 && s.y0 === 2.1 && s.y1 === 2.8), JSON.stringify(segs))
const winSegs = geo.wallSegments(layout.walls[2])
check('窗洞切段：窗台 + 窗楣', winSegs.some((s) => s.y1 === 0.9) && winSegs.some((s) => s.y0 === 2.1), JSON.stringify(winSegs))

// ---------------------------------------------------------------- 走位校验
const base = geo.fallbackSceneLayout(1, 2, '井道')
const roster = ['A', 'B']
const good = {
  keys: [
    {
      t: 0,
      actors: [{ name: 'A', x: 0.3, y: 0.5, face: 0 }, { name: 'B', x: 0.7, y: 0.5, face: 180 }],
      camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 },
    },
    {
      t: 1,
      actors: [{ name: 'A', x: 0.42, y: 0.5, face: 8 }, { name: 'B', x: 0.62, y: 0.5, face: 172 }],
      camera: { x: 0.5, y: 0.86, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 42 },
    },
  ],
  source: 'ai',
}
let v = geo.validateBlocking(good, { layout: base, roster })
check('合法走位通过', v.errors.length === 0, JSON.stringify(v.errors))

v = geo.validateBlocking({ ...good, keys: [{ ...good.keys[0], actors: [{ name: 'C', x: 0.5, y: 0.5, face: 0 }] }] }, { layout: base, roster })
check('编造角色被拒', v.errors.some((e) => e.code === 'actor-unknown'), JSON.stringify(v.errors))

v = geo.validateBlocking({ ...good, keys: [{ ...good.keys[0], actors: [{ name: 'A', x: 0.01, y: 0.5, face: 0 }, { name: 'B', x: 0.7, y: 0.5, face: 180 }] }] }, { layout: base, roster })
check('墙内站位被拒', v.errors.some((e) => e.code === 'actor-wall'), JSON.stringify(v.errors))

const blocked = {
  ...base,
  walls: [
    ...base.walls,
    { id: 'inner', x1: 4.8, z1: 1, x2: 4.8, z2: 7, height: 2.8, thickness: 0.2 },
  ],
}
v = geo.validateBlocking(
  {
    keys: [
      { t: 0, actors: [{ name: 'A', x: 0.1, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.95, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
      { t: 1, actors: [{ name: 'A', x: 0.9, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.95, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
    ],
    source: 'ai',
  },
  { layout: blocked, roster: ['A'] },
)
check('路径穿墙被拒', v.errors.some((e) => e.code === 'actor-path-wall'), JSON.stringify(v.errors))

v = geo.validateBlocking({ ...good, keys: [{ ...good.keys[1] }, { ...good.keys[0] }] }, { layout: base, roster })
check('关键帧倒序被拒', v.errors.some((e) => e.code === 'key-order'), JSON.stringify(v.errors))

// ---------------------------------------------------------------- 插值 / 文案 / 指纹
const mid = geo.interpolateBlocking(good, 0.5)
check('插值角色位置', Math.abs(mid.actors[0].x - 0.36) < 0.001, JSON.stringify(mid.actors[0]))
const turn = geo.interpolateBlocking(
  {
    keys: [
      { t: 0, actors: [{ name: 'A', x: 0.5, y: 0.5, face: 350 }], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
      { t: 1, actors: [{ name: 'A', x: 0.5, y: 0.5, face: 10 }], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
    ],
    source: 'ai',
  },
  0.5,
)
check('朝向走最短弧', Math.abs(geo.angleDelta(0, turn.actors[0].face)) <= 20, String(turn.actors[0].face))

const note = geo.motionNoteOf(base, good, 3, '推')
check('运镜文案含真实距离', /0\.5 米/.test(note), note)
check('运镜文案不再写死 0.6 米', !note.includes('0.6 米'), note)
const pan = {
  keys: [
    { t: 0, actors: [], camera: { x: 0.5, y: 0.9, lookX: 0.45, lookY: 0.5, height: 1.6, fov: 45 } },
    { t: 1, actors: [], camera: { x: 0.5, y: 0.9, lookX: 0.55, lookY: 0.5, height: 1.6, fov: 45 } },
  ],
  source: 'ai',
}
const panNote = geo.motionNoteOf(base, pan, 4, '摇')
check('摇镜文案含摇摄', panNote.includes('摇'), panNote)
const fixedNote = geo.motionNoteOf(base, geo.fallbackBlocking(['A'], base), 2, '固定')
check('固定机位文案', fixedNote.includes('机位固定'), fixedNote)

const fpInput = { layout: base, blocking: good, duration: 3, aspect: '16:9', mode: 'clean' }
const fp = geo.scheduleFingerprint(fpInput)
const fp2 = geo.scheduleFingerprint({ ...fpInput, blocking: { ...good, notes: 'x' } })
check('指纹忽略 notes', fp === fp2, `${fp} / ${fp2}`)
check('指纹随时长变化', fp !== geo.scheduleFingerprint({ ...fpInput, duration: 4 }))
check('指纹随模式变化', fp !== geo.scheduleFingerprint({ ...fpInput, mode: 'review' }))
check(
  '指纹键序无关',
  fp === geo.scheduleFingerprint({
    mode: 'clean',
    aspect: '16:9',
    duration: 3,
    blocking: good,
    layout: JSON.parse(JSON.stringify(base)),
  }),
)
check(
  'fresh 只认 clean',
  geo.isScheduleFresh({ version: 1, fingerprint: fp, mode: 'clean', duration: 3, aspect: '16:9', width: 960, height: 540, renderedAt: '' }, fpInput) &&
    !geo.isScheduleFresh({ version: 1, fingerprint: fp, mode: 'review', duration: 3, aspect: '16:9', width: 960, height: 540, renderedAt: '' }, fpInput),
)

// ---------------------------------------------------------------- 角色名单 / 上下文
check('roster 合并 cast 与说话人', eq(geo.rosterOf(['A'], 'A：一\nB：二'), ['A', 'B']), JSON.stringify(geo.rosterOf(['A'], 'A：一\nB：二')))
check('roster 忽略旁白', eq(geo.rosterOf([], '旁白：风很冷'), ['旁白']), JSON.stringify(geo.rosterOf([], '旁白：风很冷')))
check('roster 去重', eq(geo.rosterOf(['A', 'A'], 'A：一\nA：二'), ['A']))

const sceneText = ctx.buildSceneContext({
  episode: { no: 1, title: '雨夜', hook: '她还活着', scenes: [] },
  scene: { no: 2, slug: '井道', place: '地下泵房', time: '深夜', beats: '陈默发现血迹', characters: ['陈默'], intensity: 7, tone: '悬疑' },
  sceneNo: 2,
  shots: [{ no: 'S03', cast: ['陈默'], prompt: '陈默蹲下看血迹', seconds: 4 }],
  designs: [{ id: 'd1', kind: 'scene', name: '井道', refs: [], summaryCn: '潮湿的混凝土井道', promptEn: 'wet concrete tunnel, flickering light', keywords: ['井道'] }],
}).text
check('场景上下文含场次文本', ['地下泵房', '深夜', '陈默发现血迹', '冲突强度', '悬疑', 'S03'].every((s) => sceneText.includes(s)), sceneText.slice(0, 200))
check('场景上下文含场景卡', sceneText.includes('wet concrete tunnel'), sceneText.slice(-200))

const blockingText = ctx.buildBlockingContext({
  scene: base,
  shot: {
    no: 'S03',
    seconds: 4,
    size: '中景',
    move: '推',
    cast: ['A'],
    dialogue: 'A：别动\nB：你晚了',
    prompt: 'A 在门口停下',
    videoPrompt: '镜头缓慢前推，雨丝斜切画面',
  },
  characters: [{ id: 'a', name: 'A', role: '主角', lookCn: '', lookEn: 'red raincoat, short hair', palette: '红', keywords: ['雨衣'] }],
  designs: [{ id: 'p1', kind: 'prop', name: '铁箱', refs: [], summaryCn: '生锈铁箱', promptEn: 'rusty iron box', keywords: [] }],
  marks: [{ id: 'm1', kind: 'rect', color: '#f00', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
  aspect: '16:9',
}).replaceAll('data:image/png;base64,AAAA', '')
check('走位上下文含台词/运动/标注/秒数', ['别动', 'B', '缓慢前推', '画面标注', '4.0s'].every((s) => blockingText.includes(s)), blockingText.slice(0, 220))
check('走位上下文含角色锚点', blockingText.includes('red raincoat'), blockingText.slice(-300))
check('走位上下文不含图片像素', !blockingText.includes('data:image') && !blockingText.includes('base64'), blockingText.slice(0, 100))
check('走位上下文含场景 JSON', blockingText.includes('"id":"E01-SC02"'), blockingText.slice(-160))

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
