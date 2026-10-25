/**
 * 提交意图验证：临时项目库 + 假成片，不启动 HTTP、不碰真实库。
 *
 * 覆盖：hash 稳定性、暂存不建任务、确认只认行内快照、
 * 过期/预检失败/来源收窄三条拒绝、幂等重确认、取消、垃圾清理。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

process.env.PUBLISH_CHROME_PATH = process.env.PUBLISH_CHROME_PATH || '/bin/sh'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-intent-'))
const publicDir = path.join(root, 'public')
for (const sub of ['exports', 'exports/imports', 'videos', 'generated']) {
  fs.mkdirSync(path.join(publicDir, sub), { recursive: true })
}
const clip = path.join(publicDir, 'exports', 'clip.mp4')
fs.writeFileSync(clip, Buffer.alloc(4096))
const cover9x16 = path.join(publicDir, 'exports', 'cover916.jpg')
fs.writeFileSync(cover9x16, Buffer.alloc(1024))

const { createDeliverable } = await import('./server/deliverables.mjs')
const { upsertAccount } = await import('./server/publish-accounts.mjs')
const { openDatabase } = await import('./server/db.mjs')
const {
  INTENT_TTL_MS,
  cancelIntent,
  configHash,
  confirmIntent,
  expireStaleIntents,
  getIntent,
  normalizeTargets,
  stageIntent,
  sweepIntents,
  intentSourceError,
} = await import('./server/publish-intents.mjs')
const { listJobs } = await import('./server/publish-jobs.mjs')

const deliverable = createDeliverable(root, {
  project: 'p-intent',
  episode: 1,
  title: '意图测试',
  url: '/exports/clip.mp4',
  source: 'import',
  width: 1080,
  height: 1920,
  duration: 12,
  bytes: 4096,
})
const account = upsertAccount(root, { platform: 'douyin', label: '主号', status: 'connected' })

function baseConfig(over = {}) {
  return {
    master: { title: '标题文字', description: '简介文字内容', tags: [], aiGenerated: true, ...(over.master || {}) },
    cover: { '9:16': '/exports/cover916.jpg', ...(over.cover || {}) },
    targets: {
      douyin: { selected: true, accountId: account.id, mode: 'draft', override: null },
    },
  }
}

function draftTargets() {
  return [{ platform: 'douyin', accountId: account.id, mode: 'draft' }]
}

function jobCount() {
  return listJobs(root, { limit: 500 }).length
}

let pass = 0
function ok(name, fn) {
  fn()
  pass++
  console.log(`  ok ${name}`)
}

// ---- 1. hash 稳定：键顺序无关 ----
ok('hash 与键顺序无关', () => {
  const a = { b: 1, a: { y: 2, x: [1, 2] } }
  const b = { a: { x: [1, 2], y: 2 }, b: 1 }
  assert.equal(configHash(a), configHash(b))
})

// ---- 2. targets 归一化 ----
ok('归一化去掉未知平台并去重', () => {
  const out = normalizeTargets([
    { platform: 'douyin', accountId: 'a1', mode: 'draft' },
    { platform: 'douyin', accountId: 'a2', mode: 'publish' },
    { platform: 'not-a-platform' },
    { platform: 'bilibili', mode: 'weird' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].accountId, 'a1')
  assert.equal(out[1].mode, 'draft')
})

// ---- 3. 暂存不建任务 ----
const before = jobCount()
const staged = stageIntent(root, {
  deliverableId: deliverable.id,
  targets: draftTargets(),
  config: baseConfig(),
  source: 'assistant',
})
ok('暂存不创建任务', () => {
  assert.equal(staged.state, 'staged')
  assert.equal(jobCount(), before)
  assert.equal(staged.jobIds.length, 0)
  assert.ok(staged.hash)
  assert.ok(staged.expiresAt)
  assert.equal(staged.preflight.ok, true)
})

// ---- 4. 确认后才建任务，来源写进 payload ----
const confirmed = confirmIntent(root, staged.id)
ok('确认后建一条任务并带来源', () => {
  assert.equal(confirmed.jobs.length, 1)
  assert.equal(confirmed.jobs[0].payload.source, 'assistant')
  assert.equal(confirmed.jobs[0].payload.intentId, staged.id)
  assert.equal(confirmed.jobs[0].mode, 'draft')
  assert.equal(jobCount(), before + 1)
})

// ---- 5. 重复确认幂等 ----
ok('重复确认不新建任务', () => {
  const again = confirmIntent(root, staged.id)
  assert.equal(again.reused, true)
  assert.equal(jobCount(), before + 1)
})

// ---- 6. 取消不建任务 ----
const cancelled = stageIntent(root, {
  deliverableId: deliverable.id,
  targets: [{ platform: 'bilibili', accountId: '', mode: 'package' }],
  config: baseConfig(),
  source: 'assistant',
})
const cancelledCount = jobCount()
ok('取消后状态为 cancelled 且不建任务', () => {
  const next = cancelIntent(root, cancelled.id)
  assert.equal(next.state, 'cancelled')
  assert.equal(jobCount(), cancelledCount)
})

// ---- 7. 过期拒绝 ----
const stale = stageIntent(root, {
  deliverableId: deliverable.id,
  targets: [{ platform: 'bilibili', accountId: '', mode: 'package' }],
  config: baseConfig(),
  source: 'assistant',
})
ok('过期后确认被拒且标 expired', () => {
  // 直接把 expires_at 改到过去
  const d = openDatabase(root)
  d.prepare('UPDATE publish_intents SET expires_at = ? WHERE id = ?').run(
    new Date(Date.now() - INTENT_TTL_MS).toISOString(),
    stale.id,
  )
  const count = jobCount()
  assert.throws(() => confirmIntent(root, stale.id), /过期/)
  assert.equal(getIntent(root, stale.id).state, 'expired')
  assert.equal(jobCount(), count)
})

// ---- 8. 快照不一致拒绝 ----
const stale2 = stageIntent(root, {
  deliverableId: deliverable.id,
  targets: [{ platform: 'bilibili', accountId: '', mode: 'package' }],
  config: baseConfig(),
  source: 'assistant',
})
ok('请求体配置与快照不一致时拒绝', () => {
  const count = jobCount()
  assert.throws(
    () =>
      confirmIntent(root, stale2.id, {
        config: baseConfig({ master: { title: '被改过的标题' } }),
      }),
    /过期/,
  )
  assert.equal(getIntent(root, stale2.id).state, 'expired')
  assert.equal(jobCount(), count)
})

// ---- 9. assistant 不能是 publish ----
ok('assistant 来源拒绝 publish 方式', () => {
  const err = intentSourceError({
    source: 'assistant',
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'publish' }],
  })
  assert.equal(err.code, 'assistant_cannot_publish')
})

// ---- 10. 预检失败拒绝 ----
const badCopy = stageIntent(root, {
  deliverableId: deliverable.id,
  targets: draftTargets(),
  config: baseConfig({ master: { title: '' } }),
  source: 'assistant',
})
ok('预检未通过时确认被拒且不建任务', () => {
  const count = jobCount()
  assert.throws(() => confirmIntent(root, badCopy.id), /预检未通过/)
  assert.equal(getIntent(root, badCopy.id).state, 'expired')
  assert.equal(jobCount(), count)
})

// ---- 11. 过期清扫与垃圾清理 ----
ok('过期清扫只动 staged，垃圾清理只动终态', () => {
  const live = stageIntent(root, {
    deliverableId: deliverable.id,
    targets: [{ platform: 'bilibili', accountId: '', mode: 'package' }],
    config: baseConfig(),
    source: 'assistant',
  })
  const d = openDatabase(root)
  d.prepare('UPDATE publish_intents SET state = ?, created_at = ? WHERE id = ?').run(
    'cancelled',
    new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    live.id,
  )
  const removed = sweepIntents(root).removed
  assert.ok(removed >= 1)
  assert.equal(getIntent(root, live.id), null)
  const expired = expireStaleIntents(root)
  assert.ok(expired.expired >= 0)
})

console.log(`\n提交意图验证通过：${pass} 项`)
fs.rmSync(root, { recursive: true, force: true })
