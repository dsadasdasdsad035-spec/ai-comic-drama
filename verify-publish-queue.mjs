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
fs.writeFileSync(path.join(root, 'public', 'exports', 'cover-9x16.jpg'), 'img')

const { createDeliverable, patchDeliverableConfig, normalizeDeliverableConfig } = await import('./server/deliverables.mjs')
const { upsertAccount } = await import('./server/publish-accounts.mjs')
const { createJob, getJob, getJobWithEvents, transitionJob, listJobs } = await import('./server/publish-jobs.mjs')
const { registerAdapter, resetAdaptersForTest } = await import('./server/publish-adapters.mjs')
const {
  enqueue,
  resetQueueForTest,
  setContextFactoryForTest,
  queueDepth,
  keptOpenWindowCount,
  closeKeptOpenWindows,
} = await import('./server/publish-queue.mjs')

const dl = createDeliverable(root, { project: 'p1', episode: 1, url: '/exports/v.mp4', duration: 5, width: 1920, height: 1080 })
// 预置 9:16 封面：用于断言适配器上下文收到解析后的绝对路径
patchDeliverableConfig(
  root,
  dl.id,
  normalizeDeliverableConfig({
    master: { title: '队列测试标题', description: '简介', tags: [], aiGenerated: true },
    cover: { '9:16': '/exports/cover-9x16.jpg' },
  }),
)
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

// 并发要衡量「任务执行是否重叠」，不能数打开着的窗口：
// 草稿成功后窗口会刻意留着给用户去平台后台点发布，那不是并发。
function beginTask() {
  concurrent++
  maxConcurrent = Math.max(maxConcurrent, concurrent)
}
function endTask() {
  concurrent--
}

setContextFactoryForTest(async () => {
  await new Promise((r) => setTimeout(r, 120))
  return {
    pages: () => [fakePage('mock')],
    close: async () => {},
    on: () => {},
    newPage: async () => fakePage('mock'),
  }
})

resetAdaptersForTest()
const seenCtx = []
const mk = (platform, opts = {}) => {
  let entered = false
  registerAdapter({
    platform,
    verified: true,
    manualOnly: false,
    openBackend: async () => {
      if (entered) return
      entered = true
      started.push(platform)
      beginTask()
    },
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async (_page, ctx) => {
      seenCtx.push({ platform, ...ctx })
      await new Promise((r) => setTimeout(r, 80))
    },
    fillMetadata: async () => {},
    saveDraft: async () => {
      if (!entered) return
      entered = false
      endTask()
    },
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

// 适配器收到解析后的封面绝对路径；未声明 supported 时不自动投递
const expectedCoverPath = fs.realpathSync(path.join(root, 'public', 'exports', 'cover-9x16.jpg'))
const dyCtx = seenCtx.find((c) => c.platform === 'douyin')
assert.ok(dyCtx, '应捕获抖音任务的上下文')
assert.equal(dyCtx.coverPath, expectedCoverPath, `封面路径不对：${dyCtx.coverPath}`)
assert.deepEqual(Object.keys(dyCtx.covers), ['9:16'])
const dyJob = getJob(root, jobs[0].id)
assert.equal(dyJob.payload.coverAttached, false, '未验证封面步骤时不得声称已上传')
assert.ok(/封面/.test(String(dyJob.payload.coverNote)), `应说明封面结论：${dyJob.payload.coverNote}`)
const dyEvents = getJobWithEvents(root, jobs[0].id).events
assert.ok(
  dyEvents.every((e) => !/封面已填写|封面已上传/.test(e.message)),
  '未上传时事件文案不得声称封面已填写/已上传',
)

// 声明 supported 且实现 uploadCover 时，封面才真正被投递
resetAdaptersForTest()
const coverCalls = []
registerAdapter({
  platform: 'douyin',
  verified: true,
  manualOnly: false,
  coverSupport: 'supported',
  openBackend: async () => {},
  checkSession: async () => ({ status: 'connected', message: '' }),
  uploadVideo: async () => {},
  uploadCover: async (_page, ctx) => { coverCalls.push(ctx.coverPath) },
  fillMetadata: async () => {},
  saveDraft: async () => {},
  submitFinal: async () => {},
  readStatus: async () => ({ status: 'submitted' }),
})
const jc = createJob(root, {
  deliverableId: dl.id,
  project: 'p1',
  episode: 1,
  platform: 'douyin',
  accountId: account.id,
  mode: 'draft',
  republish: true,
}).job
enqueue(jc.id, { root, appRoot: root, projectsRoot: root })
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (['awaiting_confirmation', 'failed'].includes(getJob(root, jc.id).state)) break
}
assert.equal(getJob(root, jc.id).state, 'awaiting_confirmation')
assert.equal(coverCalls.length, 1, 'supported 适配器应收到一次封面上传调用')
assert.equal(coverCalls[0], expectedCoverPath)
assert.equal(getJob(root, jc.id).payload.coverAttached, true, '上传成功应记 coverAttached=true')

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

// ---------- 任务结束后窗口去留 ----------
// 前面用例可能留下登记过的窗口；先清掉，保证计数从 0 起算
await closeKeptOpenWindows()
// 草稿已存 / 等人工验证时，窗口必须留着让用户去平台后台点发布；
// 无条件关窗会让「请到平台后台确认发布」变成一句空话。
resetAdaptersForTest()
resetQueueForTest()
let closeCalls = 0
setContextFactoryForTest(async () => ({
  pages: () => [{ url: () => 'https://example.test/backend', $: async () => ({}) }],
  newPage: async () => ({ url: () => 'x', $: async () => ({}) }),
  on: () => {},
  close: async () => {
    closeCalls++
  },
}))
registerAdapter({
  platform: 'douyin',
  verified: true,
  manualOnly: false,
  openBackend: async () => {},
  checkSession: async () => ({ status: 'connected', message: '' }),
  uploadVideo: async () => {},
  fillMetadata: async () => {},
  saveDraft: async () => {},
  submitFinal: async () => {},
  readStatus: async () => ({ status: 'draft' }),
})
const jKeep = createJob(root, {
  deliverableId: dl.id,
  project: 'p1',
  episode: 1,
  platform: 'douyin',
  accountId: accountOf.douyin,
  mode: 'draft',
  republish: true,
}).job
enqueue(jKeep.id, { root, appRoot: root, projectsRoot: root })
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (getJob(root, jKeep.id).state === 'awaiting_confirmation') break
}
await new Promise((r) => setTimeout(r, 400))
assert.equal(getJob(root, jKeep.id).state, 'awaiting_confirmation')
assert.equal(keptOpenWindowCount(), 1, '应登记一个留给用户的窗口')
const keepEvents = getJobWithEvents(root, jKeep.id).events
assert.ok(keepEvents.some((e) => e.stage === 'window_kept'), '应记录窗口保留事件')

// 失败时窗口必须关闭，不能泄漏
resetAdaptersForTest()
resetQueueForTest()
const closedBeforeFail = closeCalls
setContextFactoryForTest(async () => ({
  pages: () => [{ url: () => 'https://example.test/backend', $: async () => ({}) }],
  newPage: async () => ({ url: () => 'x', $: async () => ({}) }),
  on: () => {},
  close: async () => {
    closeCalls++
  },
}))
registerAdapter({
  platform: 'douyin',
  verified: true,
  manualOnly: false,
  openBackend: async () => {},
  checkSession: async () => ({ status: 'connected', message: '' }),
  uploadVideo: async () => {
    throw Object.assign(new Error('boom'), { code: 'adapter_error', stage: 'upload' })
  },
  fillMetadata: async () => {},
  saveDraft: async () => {},
  submitFinal: async () => {},
  readStatus: async () => ({ status: 'submitted' }),
})
const jFail = createJob(root, {
  deliverableId: dl.id,
  project: 'p1',
  episode: 1,
  platform: 'douyin',
  accountId: accountOf.douyin,
  mode: 'draft',
  republish: true,
}).job
enqueue(jFail.id, { root, appRoot: root, projectsRoot: root })
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (getJob(root, jFail.id).state === 'failed') break
}
await new Promise((r) => setTimeout(r, 400))
assert.equal(getJob(root, jFail.id).state, 'failed')
assert.ok(closeCalls > closedBeforeFail, '失败时窗口应被关闭')

resetQueueForTest()
fs.rmSync(root, { recursive: true, force: true })
console.log('发布队列验证通过')
