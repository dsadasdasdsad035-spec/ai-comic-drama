/**
 * 场景布局与镜头场次/走位的项目级持久化回归。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-scene-blocking-api.mjs
 */
const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const STAMP = Date.now()
const A = `v3dapi-${STAMP}`
const B = `v3dapib-${STAMP}`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => {
  const r = await fetch(`${URL}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    j = { ok: false, message: `HTTP ${r.status}` }
  }
  return { status: r.status, j }
}
const ensureProject = async (name) => {
  const r = await api(`/api/project?name=${encodeURIComponent(name)}`)
  if (r.j?.ok) return
  const made = await api(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: name, aspect: '16:9' }),
  })
  if (!made.j?.ok) throw new Error(`创建项目失败：${made.j?.message || made.status}`)
}
const post = (name, body) =>
  api(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const get = async (name) => {
  const r = await api(`/api/project?name=${encodeURIComponent(name)}`)
  if (!r.j?.ok) throw new Error(r.j?.message || '读取项目失败')
  return r.j.project
}
const layout = (id, sceneNo, w = 10) => ({
  id,
  episode: 1,
  sceneNo,
  sceneSlug: `场 ${sceneNo}`,
  w,
  h: 8,
  walls: [{ id: 'w1', x1: 0, z1: 0, x2: w, z2: 0, height: 2.8, thickness: 0.18 }],
  props: [{ id: 'p1', name: '货架', shape: 'box', x: 2, z: 2, w: 1, d: 0.5, h: 2, rotation: 0 }],
  zones: [{ id: 'z1', name: '表演区', kind: 'action', x: 2, z: 2, w: 4, d: 3 }],
  axis: { a: { x: 3, z: 4 }, b: { x: 7, z: 4 } },
  source: 'manual',
})
const shot = (id, sceneNo) => ({
  id,
  episode: 1,
  no: id.split('-').pop(),
  scene_no: sceneNo,
  scene_slug: `场 ${sceneNo}`,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: '测试镜头',
  cast: ['甲'],
  keyframe_prompt: 'test',
  shot_blocking: {
    keys: [
      {
        t: 0,
        actors: [{ name: '甲', x: 0.5, y: 0.5, face: 0 }],
        camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 },
      },
    ],
    source: 'manual',
  },
  schedule_meta: {
    version: 1,
    fingerprint: 'abcd1234abcd1234',
    mode: 'clean',
    duration: 3,
    aspect: '16:9',
    width: 960,
    height: 540,
    renderedAt: new Date().toISOString(),
  },
  layout: { actors: [{ name: '甲', x: 0.5, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5 }, w: 10, h: 8 },
})

await ensureProject(A)
await ensureProject(B)
const emptyB = await get(B)
check('新项目默认 sceneLayouts 为空数组', Array.isArray(emptyB.sceneLayouts) && emptyB.sceneLayouts.length === 0, JSON.stringify(emptyB.sceneLayouts))

let r = await post(A, { sceneLayouts: [layout('E01-SC01', 1), layout('E01-SC02', 2, 12)] })
check('写入两种场景布局', r.j?.ok, JSON.stringify(r.j))
let a = await get(A)
check('布局重读完整', a.sceneLayouts?.length === 2 && a.sceneLayouts[1].w === 12, JSON.stringify(a.sceneLayouts))
check('布局按 id 排序', a.sceneLayouts?.[0]?.id === 'E01-SC01' && a.sceneLayouts?.[1]?.id === 'E01-SC02')

r = await post(A, { shots: [shot('E01-S01', 1), shot('E01-S02', 2)] })
check('写入镜头场次/走位/渲染元数据', r.j?.ok, JSON.stringify(r.j))
a = await get(A)
const s1 = a.shots?.find((x) => x.id === 'E01-S01')
const s2 = a.shots?.find((x) => x.id === 'E01-S02')
check('镜头场次字段往返', s1?.scene_no === 1 && s2?.scene_no === 2, JSON.stringify({ s1: s1?.scene_no, s2: s2?.scene_no }))
check('走位关键帧往返', s1?.shot_blocking?.keys?.[0]?.actors?.[0]?.name === '甲', JSON.stringify(s1?.shot_blocking))
check('渲染元数据往返', s1?.schedule_meta?.mode === 'clean' && s1?.schedule_meta?.duration === 3, JSON.stringify(s1?.schedule_meta))
check('旧 layout 仍保留', s1?.layout?.w === 10)

r = await post(B, { sceneLayouts: [layout('E01-SC01', 1, 20)] })
check('项目 B 写入自己的布局', r.j?.ok, JSON.stringify(r.j))
const b = await get(B)
check('项目 A/B 布局隔离', a.sceneLayouts?.[0]?.w === 10 && b.sceneLayouts?.[0]?.w === 20, JSON.stringify({ a: a.sceneLayouts?.[0]?.w, b: b.sceneLayouts?.[0]?.w }))

r = await post(A, { sceneLayouts: 'bad' })
check('非法 sceneLayouts 被拒', r.status === 400 && r.j?.ok === false, JSON.stringify(r.j))
r = await post(A, { sceneLayouts: [{ id: 'bad' }] })
check('缺尺寸的布局被拒', r.status === 400 && r.j?.ok === false, JSON.stringify(r.j))
const afterBad = await get(A)
check('拒绝写入后旧布局不变', afterBad.sceneLayouts?.length === 2, String(afterBad.sceneLayouts?.length))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
