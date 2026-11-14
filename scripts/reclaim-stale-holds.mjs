/**
 * 回收悬空冻结（hold_micro）。
 *
 * 冻结靠「请求结束」释放：客户端中途消失（关桌面端、断网、代理超时）时，
 * hold 会永久留在库里，用户看到的可用余额就比实际少。
 *
 * 用法：
 *   node scripts/reclaim-stale-holds.mjs                 # 只回收超过 60 分钟的
 *   node scripts/reclaim-stale-holds.mjs --force         # 强制清零（确认没有在跑的请求时用）
 *   node scripts/reclaim-stale-holds.mjs --db /path.sqlite [--force]
 *
 * 库路径默认取 BILLING_DB_PATH；容器里通常是 /data/projects/billing.sqlite。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const TTL_MS = 60 * 60_000

const args = process.argv.slice(2)
const force = args.includes('--force')
const dbIdx = args.indexOf('--db')
const dbPath = String(dbIdx >= 0 ? args[dbIdx + 1] : process.env.BILLING_DB_PATH || '').trim()

if (!dbPath) {
  console.error('缺少库路径：传 --db 或设置 BILLING_DB_PATH')
  process.exit(2)
}
if (!fs.existsSync(dbPath)) {
  console.error(`库不存在：${dbPath}`)
  process.exit(2)
}

const db = new DatabaseSync(path.resolve(dbPath))
const cols = db.prepare('PRAGMA table_info(wallets)').all().map((r) => String(r.name))
if (!cols.includes('hold_since_ms')) db.exec('ALTER TABLE wallets ADD COLUMN hold_since_ms INTEGER')

const rows = db.prepare('SELECT user_id, balance_micro, hold_micro, hold_since_ms FROM wallets WHERE hold_micro > 0').all()
if (!rows.length) {
  console.log('没有悬空冻结')
  process.exit(0)
}

const now = Date.now()
let reclaimed = 0
let kept = 0
for (const r of rows) {
  const ageMs = r.hold_since_ms ? now - Number(r.hold_since_ms) : null
  const ageText = ageMs === null ? '时间未知' : `${Math.round(ageMs / 60000)} 分钟`
  const stale = force || ageMs === null || ageMs > TTL_MS
  console.log(
    `user=${r.user_id} 余额=${(Number(r.balance_micro) / 1e6).toFixed(3)} 冻结=${(
      Number(r.hold_micro) / 1e6
    ).toFixed(3)} 时长=${ageText} → ${stale ? '回收' : '保留'}`,
  )
  if (!stale) {
    kept++
    continue
  }
  db.prepare("UPDATE wallets SET hold_micro = 0, hold_since_ms = NULL, updated_at = datetime('now') WHERE user_id = ?").run(
    r.user_id,
  )
  reclaimed++
}

console.log(`回收 ${reclaimed} 个，保留 ${kept} 个${force ? '（--force）' : ''}`)
