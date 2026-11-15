/**
 * 修复桌面版 a 项目断掉的素材参考。
 *
 * 背景：桌面端每次启动端口不同，localStorage 按 origin 隔离，旧版「随机 uid 节点 +
 * 无 canvas_id 的 assets」在升级给素材卡补 canvasId 后，refIds 里的旧 uid 就再也对不上，
 * 画布上的参考连线整批消失。
 *
 * 做法：按镜头所在场景把旧 token 映射回现存的素材卡（场景卡按 scene_slug 唯一确定，
 * 角色卡取幼猫三视图/表情总图，医药工厂按道具唯一确定），递归处理 extra 内所有 refIds。
 * 幂等：映射表里没有的 token 原样保留，重复执行结果一致。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DB = path.join(
  os.homedir(),
  'Library/Application Support/storyboard-canvas/projects/storyboard.sqlite',
)
const PROJECT = 'a'
const DRY = process.argv.includes('--dry')

/** 旧 canvasId → 现素材卡 canvasId（按场景组推断，见同目录分析） */
const MAP = {
  // 雨夜空地组（S01–S04）
  '18c26b3b-1196-4edb-be91-6ec9258778e3': 'a937a24a-e3e7-4d65-ae51-fb1cfa2df3f2', // 幼猫·三视图
  '6cb7acad-6772-4cae-a7db-5b82a62b8ad4': 'a937a24a-e3e7-4d65-ae51-fb1cfa2df3f2', // 幼猫·三视图（重建版）
  '00b6f0a6-b4d8-499b-b5c3-86daed4d2e01': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238', // 幼猫·表情总图
  '8965da2e-1e9a-4571-a133-2d93f3d47b5d': '4cf9ba3e-203d-4006-ba0c-6f74eb1c3bf2', // 雨夜空地
  // 屋檐台阶下组（S05–S07）
  '115c1ca4-00c7-4266-9ac4-8ac82a27e4aa': 'a8bf59bb-5329-4a5b-945c-9780d186f916', // 屋檐台阶下
  a9b3fcc87d574fdfb002988f344bef07: 'a937a24a-e3e7-4d65-ae51-fb1cfa2df3f2',
  'adfeb53b-538d-48c4-8ba3-8c7d547dd51d': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238',
  // 排水口入口组（S08–S10）
  '0a2ef7b0-7d4d-445c-b9f1-81f54d875b54': '69b519f3-130d-485d-be8a-6f7770054e54', // 排水口入口
  'c1c02d0f-98fe-4881-be08-9c1cec7ef585': 'a937a24a-e3e7-4d65-ae51-fb1cfa2df3f2',
  'd820619b-100e-409b-92d9-9cbd89c7b159': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238',
  // 管道内部组（S11–S13）
  '7e8cb877-d513-4c36-8047-890c5651aaa2': '6f08cb67-2008-4b55-8737-faef387eddf7', // 管道内部
  '2d82ed58-9fbc-40de-be54-3015535efe0a': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238',
  '8be7ade6-697f-445c-a7e8-6914c3fca34a': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238',
  '759dc986-7576-4605-9c09-738583c378fe': '4a329c50-320b-4522-b131-33fc7e7c01c2', // 医药工厂
  // 管道内干燥高台组（S14–S15）
  '7b44d4b9-e870-4b5b-bd77-518cf1c2f826': 'f6bf8497-13c2-40cf-afb0-b89946843973', // 管道内干燥高台
  '0f8fb3c0-89e4-4d87-b3f2-94198cb088ab': 'a937a24a-e3e7-4d65-ae51-fb1cfa2df3f2',
  'dfd76808-35ad-4490-8cf1-709b4bdaf5e2': '6c92755c-5a9a-41ef-b5d4-2cf0eb2db238',
}
// 键统一成小写无横线，兼容 uuid 大小写差异
const norm = (s) => String(s || '').replace(/-/g, '').toLowerCase()
const MAP_NORM = new Map(Object.entries(MAP).map(([k, v]) => [norm(k), v]))

const db = new DatabaseSync(DB)
db.exec('PRAGMA busy_timeout = 5000;')
const proj = db.prepare('SELECT id FROM projects WHERE name = ?').get(PROJECT)
if (!proj) throw new Error(`项目不存在：${PROJECT}`)
const pid = proj.id

const cards = new Map(
  db
    .prepare('SELECT canvas_id, title, kind FROM assets WHERE project_id = ?')
    .all(pid)
    .filter((r) => String(r.canvas_id || '').trim())
    .map((r) => [`asset-${r.canvas_id}`, r]),
)

let touched = 0
let replaced = 0
const unknown = new Map()

/** 递归替换任意 refIds 数组里的 asset token */
function fixNode(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = fixNode(node[i])
    return node
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'refIds' && Array.isArray(v)) {
        const out = []
        for (const tok of v) {
          if (typeof tok !== 'string' || !tok.startsWith('asset-')) {
            out.push(tok)
            continue
          }
          if (cards.has(tok)) {
            out.push(tok)
            continue
          }
          const to = MAP_NORM.get(norm(tok.slice(6)))
          if (to) {
            out.push(`asset-${to}`)
            replaced++
            continue
          }
          unknown.set(tok.slice(6, 14), tok)
          out.push(tok)
        }
        node[k] = [...new Set(out)]
      } else {
        node[k] = fixNode(v)
      }
    }
  }
  return node
}

const shots = db.prepare('SELECT shot_id, extra FROM shots WHERE project_id = ?').all(pid)
const updates = []
for (const s of shots) {
  let extra
  try {
    extra = JSON.parse(s.extra || '{}')
  } catch {
    continue
  }
  const before = JSON.stringify(extra)
  fixNode(extra)
  const after = JSON.stringify(extra)
  if (after !== before) {
    updates.push({ id: s.shot_id, extra: after })
    touched++
  }
}

// 素材卡 design_id 回填：设定卡来源的卡按标题认领 design，服务端整表替换的身份兜底才生效
const designs = db.prepare('SELECT design_id, name FROM designs WHERE project_id = ?').all(pid)
const byName = new Map(designs.map((d) => [d.name, d.design_id]))
let designFilled = 0
const designUpdates = []
for (const a of db.prepare('SELECT id, title, design_id FROM assets WHERE project_id = ?').all(pid)) {
  if (String(a.design_id || '').trim()) continue
  const did = byName.get(a.title)
  if (!did) continue
  designUpdates.push({ id: a.id, did })
  designFilled++
}

console.log(`待改镜头 ${updates.length}，替换 token ${replaced}，回填 design_id ${designFilled}`)
if (unknown.size) console.log('未识别的旧 token：', [...unknown.values()].join('、'))

if (DRY) {
  console.log('（dry run，不写库）')
  process.exit(0)
}

const tx = db.prepare('UPDATE shots SET extra = ? WHERE project_id = ? AND shot_id = ?')
const td = db.prepare('UPDATE assets SET design_id = ? WHERE id = ?')
db.exec('BEGIN')
try {
  for (const u of updates) tx.run(u.extra, pid, u.id)
  for (const d of designUpdates) td.run(d.did, d.id)
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}
console.log(`已写入：${updates.length} 镜、${designUpdates.length} 张卡的 design_id`)

// 校验
const valid = new Set([...cards.keys()])
let broken = 0
for (const s of db.prepare('SELECT shot_id, extra FROM shots WHERE project_id = ?').all(pid)) {
  const e = JSON.parse(s.extra || '{}')
  const stack = [e]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (Array.isArray(n)) {
      stack.push(...n)
      continue
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'refIds' && Array.isArray(v)) {
        for (const t of v) {
          if (typeof t === 'string' && t.startsWith('asset-') && !valid.has(t)) {
            broken++
            console.log('  仍断链', s.shot_id, t.slice(0, 16))
          }
        }
      } else stack.push(v)
    }
  }
}
console.log(broken ? `❌ 仍有 ${broken} 条断链` : '✅ 所有素材 token 都能对上素材卡')
