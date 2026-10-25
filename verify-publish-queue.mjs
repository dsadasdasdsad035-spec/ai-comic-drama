/**
 * 队列并发与状态推进验证：注入假浏览器上下文和假适配器，
 * 断言同一时刻只有一个任务在执行，且失败/取消不影响后续任务。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-queue-'))
fs.mkdirSync(path.join(root, 'public', 'exports'), { recursive: true })
fs.writeFileSync(path.join(root, 'public', 'exports', 'v.mp4'), 'x')

const { createDeliverable } = await import('./server/deliverables.mjs')
const { upsertAccount } = await import('./server/publish-accounts.mjs')
const { createJob, getJob, transitionJob, listJobs } = await import('./server/publish-jobs.mjs')
const { registerAdapter, resetAdaptersForTest } = await import('./server/publish-adapters.mjs')
const { enqueue, resetQueueForTest, setContextFactoryForTest, queueDepth } = await import('./server/publish-queue.mjs')

const dl = createDeliverable(root, { project: 'p1', episode: 1, url: '/exports/v.mp4', duration: 5, width: 1920, height: 1080 })
const account = upsertAccount(root, { platform: 'douyin', label: 'q', status: 'connected' })
const accountB = upsertAccount(root, { platform: 'bilibili', label: 'qb', status: 'connected' })
const accountC = upsertAccount(root, { platform: 'toutiao', label: 'qc', status: 'connected' })
const accountOf = { douyin: account.id, bilibili: accountB.id, toutiao: accountC.id }

let concurrent = 0
let maxConcurrent = 0
const started = []

function fakePage(platform) {
  return {
    url: () => `https://example.test/${platform}/backend`,
    $: async () => ({}),
  }
}

setContextFactoryForTest(async () => {
  concurrent++
  maxConcurrent = Math.max(maxConcurrent, concurrent)
  await new Promise((r) => setTimeout(r, 120))
  return {
    pages: () => [fakePage('mock')],
    close: async () => {
      concurrent--
    },
    newPage: async () => fakePage('mock'),
  }
})

resetAdaptersForTest()
const mk = (platform, opts = {}) => {
  registerAdapter({
    platform,
    verified: true,
    manualOnly: false,
    openBackend: async () => { started.push(platform) },
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async () => { await new Promise((r) => setTimeout(r, 80)) },
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
    ...opts,
  })
}
mk('douyin')
mk('bilibili')
mk('toutiao')

const jobs = ['douyin', 'bilibili', 'toutiao'].map((platform) =>
  createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform, accountId: accountOf[platform], mode: 'draft' }).job,
)
for (const j of jobs) enqueue(j.id, { root, appRoot: root, projectsRoot: root })

assert.ok(queueDepth() >= 1)
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (jobs.every((j) => ['awaiting_confirmation', 'failed'].includes(getJob(root, j.id).state))) break
}

const states = jobs.map((j) => getJob(root, j.id).state)
assert.deepEqual(states, ['awaiting_confirmation', 'awaiting_confirmation', 'awaiting_confirmation'], states.join(','))
assert.equal(maxConcurrent, 1, `同时执行数应为 1，实际 ${maxConcurrent}`)
assert.equal(started.length, 3)

// 失败任务不应阻塞后续任务
resetAdaptersForTest()
registerAdapter({
  platform: 'douyin',
  verified: true,
  manualOnly: false,
  openBackend: async () => {},
  checkSession: async () => ({ status: 'connected', message: '' }),
  uploadVideo: async () => { throw Object.assign(new Error('boom'), { code: 'adapter_error', stage: 'upload' }) },
  fillMetadata: async () => {},
  saveDraft: async () => {},
  submitFinal: async () => {},
  readStatus: async () => ({ status: 'submitted' }),
})
registerAdapter({
  platform: 'bilibili',
  verified: true,
  manualOnly: false,
  openBackend: async () => {},
  checkSession: async () => ({ status: 'connected', message: '' }),
  uploadVideo: async () => {},
  fillMetadata: async () => {},
  saveDraft: async () => {},
  submitFinal: async () => {},
  readStatus: async () => ({ status: 'submitted' }),
})
const jf = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'douyin', accountId: accountOf.douyin, mode: 'draft', republish: true }).job
const jo = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'bilibili', accountId: accountOf.bilibili, mode: 'draft', republish: true }).job
enqueue(jf.id, { root, appRoot: root, projectsRoot: root })
enqueue(jo.id, { root, appRoot: root, projectsRoot: root })
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (['failed', 'published', 'awaiting_confirmation'].includes(getJob(root, jo.id).state)) break
}
assert.equal(getJob(root, jf.id).state, 'failed')
assert.equal(getJob(root, jo.id).state, 'awaiting_confirmation')

// 自动模式：mode=draft 的 auto 任务只能停草稿，不能 published
const ja = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'toutiao', accountId: accountOf.toutiao, mode: 'publish', payload: { auto: true }, republish: true }).job
transitionJob(root, ja.id, 'uploading')
enqueue(ja.id, { root, appRoot: root, projectsRoot: root })
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 100))
  const st = getJob(root, ja.id).state
  if (st === 'awaiting_confirmation' || st === 'failed') break
}
assert.notEqual(getJob(root, ja.id).state, 'published', '自动任务不能进入已发布')

resetQueueForTest()
fs.rmSync(root, { recursive: true, force: true })
console.log('发布队列验证通过')
