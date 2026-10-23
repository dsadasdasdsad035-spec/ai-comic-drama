/**
 * 3D 生成编排回归：上下文、JSON 解析、稳定 id、修复一次、取消、兜底。
 * 跑法：node verify-3d-ai.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-3d-ai-'))
const entry = path.join(outDir, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(root, 'src/scheduleAI.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/scheduleContext.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/scheduleGeometry.ts'))}\n`,
)
const out = path.join(outDir, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${out}`,
])
const ai = await import(out)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const baseScene = ai.fallbackSceneLayout(1, 2, '井道')
const sceneContext = {
  episode: { no: 1, title: '雨夜', hook: '她还活着', scenes: [] },
  scene: { no: 2, slug: '井道', place: '地下泵房', time: '深夜', beats: '陈默发现血迹', characters: ['陈默'], intensity: 7, tone: '悬疑' },
  sceneNo: 2,
  shots: [{ no: 'S03', cast: ['陈默'], prompt: '陈默蹲下看血迹', seconds: 4 }],
  designs: [{ id: 'd1', kind: 'scene', name: '井道', refs: [], summaryCn: '潮湿混凝土', promptEn: 'wet concrete tunnel', keywords: ['井道'] }],
}
const sceneJson = {
  w: 10,
  h: 8,
  walls: [{ x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 }],
  props: [{ name: '铁箱', shape: 'box', x: 2, z: 3, w: 1, d: 0.5, h: 1, rotation: 0, junk: true }],
  zones: [{ name: '表演区', kind: 'action', x: 3, z: 3, w: 4, d: 3 }],
}
let asks = []
const askScene = async (o) => {
  asks.push(o)
  return { json: sceneJson }
}
const scene = await ai.generateSceneLayout({ context: sceneContext, ask: askScene })
check('场景生成使用完整上下文', ['地下泵房', '陈默发现血迹', 'wet concrete tunnel'].every((s) => asks[0].prompt.includes(s)), asks[0].prompt.slice(0, 180))
check('场景生成输出合法布局', scene.value.walls.length === 1 && scene.value.props[0].name === '铁箱', JSON.stringify(scene.value))
check('场景生成标 ai', scene.value.source === 'ai')
check('场景未知字段被忽略', !('junk' in scene.value.props[0]))

const approx = {
  ...sceneJson,
  walls: [{ x1: 0.05, z1: 0, x2: 10.05, z2: 0, height: 2.8, thickness: 0.18 }],
  props: [{ name: '铁箱', shape: 'box', x: 2.1, z: 3.1, w: 1, d: 0.5, h: 1, rotation: 0 }],
}
const scene2 = await ai.normalizeSceneLayout(approx, {
  episode: 1,
  sceneNo: 2,
  existing: scene.value,
})
check('近似几何保留墙体 id', scene2.value.walls[0].id === scene.value.walls[0].id, `${scene.value.walls[0].id} -> ${scene2.value.walls[0].id}`)
check('同名固定物保留 id', scene2.value.props[0].id === scene.value.props[0].id, `${scene.value.props[0].id} -> ${scene2.value.props[0].id}`)

const many = { ...sceneJson, props: Array.from({ length: 40 }, (_, i) => ({ name: `物${i}`, shape: 'box', x: 1, z: 1, w: 1, d: 1, h: 1, rotation: 0 })) }
const limited = await ai.generateSceneLayout({ context: sceneContext, ask: async () => ({ json: many }) })
check('固定物数组上限 32', limited.value.props.length === 32, String(limited.value.props.length))

const blockingContext = {
  scene: baseScene,
  shot: {
    no: 'S03',
    seconds: 4,
    size: '中景',
    move: '推',
    cast: ['A'],
    dialogue: 'A：别动\nB：你晚了',
    prompt: 'A 在门口停下 data:image/png;base64,AAAA',
    videoPrompt: '镜头缓慢前推，雨丝斜切画面',
  },
  characters: [{ id: 'a', name: 'A', role: '主角', lookCn: '', lookEn: 'red raincoat, short hair', palette: '红', keywords: ['雨衣'] }],
  marks: [{ id: 'm1', kind: 'rect', color: '#f00', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
  aspect: '16:9',
}
const badBlocking = {
  keys: [
    { t: 0, actors: [{ name: 'X', x: 0.5, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
    { t: 1, actors: [{ name: 'X', x: 0.6, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.88, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
  ],
}
const fixedBlocking = {
  keys: [
    {
      t: 0,
      actors: [{ name: 'A', x: 0.35, y: 0.5, face: 0 }, { name: 'B', x: 0.65, y: 0.5, face: 180 }],
      camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 },
    },
    {
      t: 1,
      actors: [{ name: 'A', x: 0.45, y: 0.5, face: 8 }, { name: 'B', x: 0.6, y: 0.5, face: 172 }],
      camera: { x: 0.5, y: 0.82, lookX: 0.5, lookY: 0.5, height: 1.7, fov: 42 },
    },
  ],
}
asks = []
const blocking = await ai.generateShotBlocking({
  context: blockingContext,
  roster: ['A', 'B'],
  ask: async (o) => {
    asks.push(o)
    return { json: asks.length === 1 ? badBlocking : fixedBlocking }
  },
})
check('走位上下文含台词/说话人/运动/标注/秒数', ['别动', 'B', '缓慢前推', '画面标注', '4.0s'].every((s) => asks[0].prompt.includes(s)), asks[0].prompt.slice(0, 220))
check('走位上下文含角色锚点', asks[0].prompt.includes('red raincoat'))
check('走位上下文不含图片像素', !asks[0].prompt.includes('data:image') && !asks[0].prompt.includes('base64'))
check('走位上下文含场景 JSON', asks[0].prompt.includes('E01-SC02'))
check('首次非法会请求修复', asks.length === 2, String(asks.length))
check('修复请求带校验错误', asks[1].prompt.includes('校验错误') && asks[1].prompt.includes('不在本镜在场名单'), asks[1].prompt.slice(-300))
check('修复后返回合法走位', blocking.value.keys[0].actors[0].name === 'A' && blocking.value.source === 'ai')

let error = null
try {
  await ai.generateShotBlocking({
    context: blockingContext,
    roster: ['A', 'B'],
    ask: async () => ({ json: badBlocking }),
  })
} catch (e) {
  error = e
}
check('两次都非法时抛 ScheduleAIError', error?.name === 'ScheduleAIError' && Array.isArray(error.issues), String(error?.message))

const ac = new AbortController()
ac.abort()
let cancelled = null
let asked = 0
try {
  await ai.generateShotBlocking({
    context: blockingContext,
    roster: ['A'],
    signal: ac.signal,
    ask: async () => {
      asked++
      return { json: fixedBlocking }
    },
  })
} catch (e) {
  cancelled = e
}
check('取消后不发请求', cancelled?.name === 'AbortError' && asked === 0, String(cancelled?.name))

const fb = ai.fallbackSceneFor(1, 3, '走廊')
check('兜底场景可渲染', fb.source === 'fallback' && fb.walls.length >= 4 && fb.id === 'E01-SC03')

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
