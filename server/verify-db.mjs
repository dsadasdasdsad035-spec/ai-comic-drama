/**
 * SQLite 数据层验证：迁移对账 + 合并语义。
 *
 * 用临时目录拷贝真实 project.json 再迁移，绝不碰原数据。
 * 跑法：node server/verify-db.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const SRC = path.resolve(import.meta.dirname, '../../manga-pipeline/projects')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbdb-'))
// 迁移对账需要一份真实项目样本；样本不在时只跑不依赖样本的合并语义断言，
// 并明确打 SKIP，避免「跑绿了但其实一条都没测」。
const hasFixture = fs.existsSync(SRC)
if (hasFixture) {
  // 只拷 project.json / source.md 等数据文件；真实目录里的 storyboard.sqlite* 不能带过去，
  // 否则 tmp 直接带着旧库跳过迁移，测的就是「读」而不是「迁移」了
  for (const name of fs.readdirSync(SRC)) {
    if (name.startsWith('storyboard.sqlite')) continue
    fs.cpSync(path.join(SRC, name), path.join(tmp, name), { recursive: true })
  }
} else {
  console.log(`⚠️ 跳过迁移对账：样本目录不存在 ${SRC}（只跑合并语义）`)
}

const now = Date.now()

// 给 recycle 加一个带 extra 画布字段的镜头，验证 extra 兜底不丢
const pj = path.join(tmp, 'recycle', 'project.json')
/** 样本的原始 json；没有样本时为 null（迁移对账整段跳过） */
let orig = null
if (hasFixture) {
  const data = JSON.parse(fs.readFileSync(pj, 'utf8'))
  data.shots[0].marks = { strokes: [[1, 2], [3, 4]] }
  data.shots[0].candidates = ['/generated/a.jpg', '/generated/b.jpg']
  fs.writeFileSync(pj, JSON.stringify(data))
  orig = JSON.parse(fs.readFileSync(pj, 'utf8'))
}

const db = await import('./db.mjs')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// ---- 迁移对账：逐字段与源 json 全等（需要样本目录） ----
if (orig) {
  const list = db.listProjects(tmp)
  check('项目列表', list.length === 1 && list[0].name === 'recycle', JSON.stringify(list[0]))

  const got = db.readProject(tmp, 'recycle')
  check('shots 数量', got.shots.length === orig.shots.length, `${got.shots.length}/${orig.shots.length}`)
  check('集数量', got.episodes.length === orig.episodes.length)
  check('角色数量', got.characters.length === orig.characters.length)
  const origDesigns = Array.isArray(orig.designs) ? orig.designs.length : 0
  const origAssets = Array.isArray(orig.assets) ? orig.assets.length : 0
  if (origDesigns) {
    check('designs 数量', got.designs?.length === origDesigns, `${got.designs?.length}/${origDesigns}`)
  }
  if (origAssets) {
    check('assets 数量', got.assets?.length === origAssets, `${got.assets?.length}/${origAssets}`)
  }

  let shotDiff = 0
  // DB 读出会把缺失字段归一化成 '' / [] —— undefined 与空值等价，不算差异
  const norm = (v) => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) && v.length === 0 ? '' : JSON.stringify(v))
  for (let i = 0; i < orig.shots.length; i++) {
    const a = orig.shots[i]
    const b = got.shots[i]
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'hand_edited') continue // handEdited 归一化，后面单独查
      if (norm(a[k]) !== norm(b[k])) {
        shotDiff++
        console.log(`   差异 shot[${i}].${k}: ${JSON.stringify(a[k])?.slice(0, 60)} -> ${JSON.stringify(b[k])?.slice(0, 60)}`)
      }
    }
  }
  check('41 镜逐字段全等', shotDiff === 0, `${shotDiff} 处差异`)

  const epDiff = JSON.stringify(got.episodes) !== JSON.stringify(orig.episodes)
  check('集+场景含 intensity/tone 全等', !epDiff)
  check(
    '画布 extra 字段不丢',
    JSON.stringify(got.shots[0].marks) === JSON.stringify(orig.shots[0].marks) && Array.isArray(got.shots[0].candidates),
  )

  // ---- 合并语义：只传部分字段不丢其它 ----
  const saved = db.writeProject(tmp, 'recycle', { style: '赛博废土' })
  check('writeProject 只改 style', saved.style === '赛博废土' && saved.logline === orig.logline)
  check('writeProject 不动 shots', saved.shots.length === orig.shots.length)
  check('writeProject 不动集', JSON.stringify(saved.episodes) === JSON.stringify(orig.episodes))

  const r2 = db.readProject(tmp, 'recycle')
  check('落库后读回 style', r2.style === '赛博废土')
}

// mergeShots 回归：orphan 标记 + handEdited 只增不减 + 写回模式
const seed = [
  { id: 'A', seconds: 3, handEdited: ['seconds'] },
  { id: 'B', seconds: 2 },
]
const mergedPartial = db.mergeShots(seed, [{ id: 'A', seconds: 5 }])
check('mergeShots 更新', mergedPartial[0].seconds === 5 && mergedPartial[0].handEdited.includes('seconds'))
check('mergeShots 缺省 partial 不标孤儿', mergedPartial[1].id === 'B' && mergedPartial[1].orphan === undefined, JSON.stringify(mergedPartial[1]))
check('mergeShots 缺省 partial 保留其余镜', mergedPartial.length === 2)

const mergedFull = db.mergeShots(seed, [{ id: 'A', seconds: 5 }], 'full')
check('mergeShots full 标孤儿', mergedFull[1].id === 'B' && mergedFull[1].orphan === true)

// 局部写回不能抹掉既有标记：已有 orphan 的镜头原样保留
const withOrphan = [...seed, { id: 'C', seconds: 1, orphan: true }]
const keptMark = db.mergeShots(withOrphan, [{ id: 'A', seconds: 9 }], 'partial')
check('mergeShots partial 保留既有 orphan', keptMark.find((s) => s.id === 'C')?.orphan === true)

// 被本次提交命中的镜头要洗白（不论模式）
const washed = db.mergeShots([{ id: 'A', seconds: 1, orphan: true }], [{ id: 'A', seconds: 2 }], 'partial')
check('mergeShots 命中即洗白 orphan', washed[0].orphan === undefined)

// 显式解锁：handEditedUnlocked 能从并集里移除指定字段，其余字段仍保留
const unlockSeed = [{ id: 'A', seconds: 3, handEdited: ['seconds', 'video_prompt', 'transition_out'] }]
const unlockedOne = db.mergeShots(unlockSeed, [
  { id: 'A', handEdited: ['seconds', 'transition_out'], handEditedUnlocked: ['video_prompt'] },
])
check(
  'handEditedUnlocked 移除指定字段',
  !unlockedOne[0].handEdited.includes('video_prompt') &&
    unlockedOne[0].handEdited.includes('seconds') &&
    unlockedOne[0].handEdited.includes('transition_out'),
  JSON.stringify(unlockedOne[0].handEdited),
)
check('handEditedUnlocked 不落库', unlockedOne[0].handEditedUnlocked === undefined, JSON.stringify(unlockedOne[0]))
const unlockedAll = db.mergeShots(unlockSeed, [
  { id: 'A', handEdited: [], handEditedUnlocked: ['seconds', 'video_prompt', 'transition_out'] },
])
check('解锁全部时 handEdited 被清空', unlockedAll[0].handEdited === undefined, JSON.stringify(unlockedAll[0]))
// 没有解锁信号时仍是并集：即使 incoming 少了字段也不能丢
const noSignal = db.mergeShots(unlockSeed, [{ id: 'A', handEdited: ['seconds'] }])
check(
  '无解锁信号时 handEdited 仍只增不减',
  ['seconds', 'video_prompt', 'transition_out'].every((k) => noSignal[0].handEdited.includes(k)),
  JSON.stringify(noSignal[0].handEdited),
)
// 空数组解锁信号等同无信号（避免误清）
const emptySignal = db.mergeShots(unlockSeed, [{ id: 'A', handEditedUnlocked: [] }])
check('空解锁信号不清标记', emptySignal[0].handEdited.length === 3, JSON.stringify(emptySignal[0].handEdited))

let modeErr = ''
try {
  db.normalizeShotsMode('whole')
} catch (e) {
  modeErr = e.message
}
check('shotsMode 非法值报错', modeErr.includes('partial'), modeErr)
check('shotsMode 缺省为 partial', db.normalizeShotsMode(undefined) === 'partial')

// createProject 幂等
db.createProject(tmp, 'demo', { title: '演示' })
check('createProject', db.listProjects(tmp).some((p) => p.name === 'demo'))
let dupErr = ''
try {
  db.createProject(tmp, 'demo')
} catch (e) {
  dupErr = e.message
}
check('重名报错', dupErr.includes('已存在'))

// settings
db.setSetting('probe', { a: 1 })
check('settings 读写', JSON.stringify(db.getSetting('probe')) === '{"a":1}')

// ---- 历史孤儿标记一次性清理 ----
// 模拟旧版现场：整表写回缺镜 → 服务端给缺席镜打了 orphan
db.createProject(tmp, 'legacy', { title: '历史' })
db.writeProject(tmp, 'legacy', {
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', desc: 'a' },
    { id: 'E01-S02', episode: 1, no: 'S02', desc: 'b' },
    { id: 'E01-S03', episode: 1, no: 'S03', desc: 'c' },
  ],
})
db.writeProject(tmp, 'legacy', {
  shots: db.mergeShots(db.readProject(tmp, 'legacy').shots, [{ id: 'E01-S01' }], 'full'),
})
const dirtyCount = () => db.readProject(tmp, 'legacy').shots.filter((s) => s.orphan === true).length
check('现场有历史孤儿标记', dirtyCount() > 0, String(dirtyCount()))

// 本进程启动时已经跑过一轮（那时库里还没有镜头），手动抹掉标记键复现「升级前的库」
const resetCleanupMark = () => {
  const side = new DatabaseSync(db.dbPath(tmp))
  try {
    side.prepare('DELETE FROM settings WHERE key = ?').run(db.LEGACY_ORPHAN_CLEANUP_KEY)
  } finally {
    side.close()
  }
}
resetCleanupMark()

const cleaned1 = db.cleanupLegacyOrphanMarks()
check('清理执行后镜头无 orphan', cleaned1 > 0 && dirtyCount() === 0, `清理 ${cleaned1} 条`)
const cleaned2 = db.cleanupLegacyOrphanMarks()
check('重复调用不改变结果', cleaned2 === 0 && dirtyCount() === 0, `第二次清理 ${cleaned2} 条`)

// 清理是「一次性」而不是「永久过滤」：之后 full 写回新产生的标记必须保留
db.writeProject(tmp, 'legacy', {
  shots: db.mergeShots(db.readProject(tmp, 'legacy').shots, [{ id: 'E01-S01' }], 'full'),
})
check('清理后 full 写回的新标记仍保留', dirtyCount() > 0, String(dirtyCount()))
const afterRestart = db.cleanupLegacyOrphanMarks()
check('清理不会二次执行', afterRestart === 0 && dirtyCount() > 0, `清理 ${afterRestart} 条`)

// ---- 画布布局持久化 ----
// 1.1 老库补列：SCHEMA 新增表/列后，已有库启动时应自动补齐
{
  const side = new DatabaseSync(db.dbPath(tmp))
  try {
    const cols = side.prepare('PRAGMA table_info(assets)').all().map((r) => r.name)
    check('assets 含 canvas_id 列', cols.includes('canvas_id'), cols.join(','))
    const tables = side.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    check('存在 canvas_layouts 表', tables.includes('canvas_layouts'))
  } finally {
    side.close()
  }
}

// 1.2/1.3 逐行 upsert、按 key 删除、非法 key 报错、未传不清空
db.createProject(tmp, 'layout', { title: '布局' })
db.writeProject(tmp, 'layout', {
  canvas: [
    { key: 'shot:E01-S02', x: 620, y: 40 },
    { key: 'shot:E01-S01', x: 60, y: 40 },
  ],
})
const laid = db.readProject(tmp, 'layout').canvas
check(
  'canvas 读回按 key 排序且内容一致',
  JSON.stringify(laid) ===
    JSON.stringify([
      { key: 'shot:E01-S01', x: 60, y: 40 },
      { key: 'shot:E01-S02', x: 620, y: 40 },
    ]),
  JSON.stringify(laid),
)
db.writeProject(tmp, 'layout', { canvas: [{ key: 'shot:E01-S01', x: 200, y: 90 }] })
const moved = db.readProject(tmp, 'layout').canvas
check(
  '同一 key 再写是覆盖不是新增',
  moved.length === 2 && moved.find((c) => c.key === 'shot:E01-S01')?.x === 200,
  JSON.stringify(moved),
)
// 未传 canvas 时既有布局必须保留（与其它顶层字段同一合并语义）
db.writeProject(tmp, 'layout', { style: '极简' })
check('未传 canvas 不清空既有布局', db.readProject(tmp, 'layout').canvas.length === 2)
// 同一请求里重复 key 以第一次为准
db.writeProject(tmp, 'layout', {
  canvas: [
    { key: 'asset:dup-1', x: 1, y: 1 },
    { key: 'asset:dup-1', x: 999, y: 999 },
  ],
})
const dupRow = db.readProject(tmp, 'layout').canvas.find((c) => c.key === 'asset:dup-1')
check('同请求重复 key 以第一次为准', dupRow?.x === 1, JSON.stringify(dupRow))
// 删除优先于写入
db.writeProject(tmp, 'layout', {
  canvas: [{ key: 'asset:dup-1', x: 5, y: 5 }],
  canvasDelete: ['asset:dup-1'],
})
check('canvasDelete 与写入同 key 时以删除为准', !db.readProject(tmp, 'layout').canvas.some((c) => c.key === 'asset:dup-1'))

let keyErr = ''
try {
  db.writeProject(tmp, 'layout', { canvas: [{ key: 'bogus:1', x: 0, y: 0 }] })
} catch (e) {
  keyErr = e.message
}
check('非法 key 报错', keyErr.includes('shot:'), keyErr)

let numErr = ''
try {
  db.writeProject(tmp, 'layout', { canvas: [{ key: 'shot:E01-S09', x: Number.NaN, y: 0 }] })
} catch (e) {
  numErr = e.message
}
check('非有限坐标报错', numErr.includes('有限数'), numErr)
check('isCanvasNodeKey 只认两种前缀', db.isCanvasNodeKey('shot:E01-S01') && db.isCanvasNodeKey('asset:abc') && !db.isCanvasNodeKey('asset:'))

// 2.1 整表替换时不带 canvasId 的卡沿用旧身份
db.writeProject(tmp, 'layout', {
  assets: [
    { kind: 'image', title: '雨夜巷口', url: '/generated/a.jpg', canvasId: 'cid-keep' },
    { kind: 'prop', title: '旧伞', url: '/generated/b.jpg', canvasId: 'cid-prop' },
  ],
})
const withCanvasId = db.readProject(tmp, 'layout').assets
check('assets 读回 canvasId', withCanvasId.map((a) => a.canvasId).join(',') === 'cid-keep,cid-prop', JSON.stringify(withCanvasId))
// 第二次落库不带 canvasId（模拟某条通道漏传）
db.writeProject(tmp, 'layout', {
  assets: [
    { kind: 'image', title: '雨夜巷口', url: '/generated/a2.jpg' },
    { kind: 'prop', title: '旧伞', url: '/generated/b.jpg' },
  ],
})
const keptId = db.readProject(tmp, 'layout').assets
check(
  '不带 canvasId 的整表替换沿用旧身份',
  keptId.map((a) => a.canvasId).join(',') === 'cid-keep,cid-prop',
  JSON.stringify(keptId),
)
check('沿用身份时内容仍按新值写入', keptId[0].url === '/generated/a2.jpg', keptId[0].url)
// designId 优先于标题：改名不改变身份
db.writeProject(tmp, 'layout', {
  assets: [{ kind: 'scene', title: '改名后的场景', url: '/generated/c.jpg', designId: 'd-1', canvasId: 'cid-design' }],
})
db.writeProject(tmp, 'layout', {
  assets: [{ kind: 'scene', title: '再改一次', url: '/generated/c.jpg', designId: 'd-1' }],
})
const byDesign = db.readProject(tmp, 'layout').assets.find((a) => a.designId === 'd-1')
check('改标题后按 designId 保住身份', byDesign?.canvasId === 'cid-design', JSON.stringify(byDesign))

console.log(`\nDB 文件: ${db.dbPath(tmp)}`)
if (bad) {
  console.log(`❌ ${bad} 项失败`)
  process.exit(1)
}
console.log('✅ 全部通过')
void now
void execFileSync
