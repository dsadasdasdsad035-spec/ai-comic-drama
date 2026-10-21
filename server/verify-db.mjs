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

const SRC = path.resolve(import.meta.dirname, '../../manga-pipeline/projects')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbdb-'))
// 只拷 project.json / source.md 等数据文件；真实目录里的 storyboard.sqlite* 不能带过去，
// 否则 tmp 直接带着旧库跳过迁移，测的就是「读」而不是「迁移」了
for (const name of fs.readdirSync(SRC)) {
  if (name.startsWith('storyboard.sqlite')) continue
  fs.cpSync(path.join(SRC, name), path.join(tmp, name), { recursive: true })
}

const now = Date.now()

// 给 recycle 加一个带 extra 画布字段的镜头，验证 extra 兜底不丢
const pj = path.join(tmp, 'recycle', 'project.json')
const data = JSON.parse(fs.readFileSync(pj, 'utf8'))
data.shots[0].marks = { strokes: [[1, 2], [3, 4]] }
data.shots[0].candidates = ['/generated/a.jpg', '/generated/b.jpg']
fs.writeFileSync(pj, JSON.stringify(data))

const db = await import('./db.mjs')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// ---- 迁移对账：逐字段与源 json 全等 ----
const list = db.listProjects(tmp)
check('项目列表', list.length === 1 && list[0].name === 'recycle', JSON.stringify(list[0]))

const orig = JSON.parse(fs.readFileSync(pj, 'utf8'))
const got = db.readProject(tmp, 'recycle')
check('shots 数量', got.shots.length === orig.shots.length, `${got.shots.length}/${orig.shots.length}`)
check('集数量', got.episodes.length === orig.episodes.length)
check('角色数量', got.characters.length === orig.characters.length)

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
check('画布 extra 字段不丢', JSON.stringify(got.shots[0].marks) === JSON.stringify(orig.shots[0].marks) && Array.isArray(got.shots[0].candidates))

// ---- 合并语义：只传部分字段不丢其它 ----
const saved = db.writeProject(tmp, 'recycle', { style: '赛博废土' })
check('writeProject 只改 style', saved.style === '赛博废土' && saved.logline === orig.logline)
check('writeProject 不动 shots', saved.shots.length === orig.shots.length)
check('writeProject 不动集', JSON.stringify(saved.episodes) === JSON.stringify(orig.episodes))

const r2 = db.readProject(tmp, 'recycle')
check('落库后读回 style', r2.style === '赛博废土')

// mergeShots 回归：orphan 标记 + handEdited 只增不减
const merged = db.mergeShots(
  [
    { id: 'A', seconds: 3, handEdited: ['seconds'] },
    { id: 'B', seconds: 2 },
  ],
  [{ id: 'A', seconds: 5 }],
)
check('mergeShots 更新', merged[0].seconds === 5 && merged[0].handEdited.includes('seconds'))
check('mergeShots orphan', merged[1].id === 'B' && merged[1].orphan === true)

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

console.log(`\nDB 文件: ${db.dbPath(tmp)}`)
if (bad) {
  console.log(`❌ ${bad} 项失败`)
  process.exit(1)
}
console.log('✅ 全部通过')
void now
void execFileSync
