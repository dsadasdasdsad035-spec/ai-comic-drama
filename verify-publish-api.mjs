/**
 * 发布 API 验证：直接调用服务端模块 + 一个本地 mock 平台页，
 * 覆盖成片导入/预检/任务/取消/重启恢复/单目标重试/发布包/路径穿越。
 *
 * 不启动 Vite，也不写真实项目库；临时根用完即删。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-api-'))
const publicDir = path.join(root, 'public')
for (const sub of ['exports', 'exports/imports', 'videos', 'generated']) {
  fs.mkdirSync(path.join(publicDir, sub), { recursive: true })
}

const { createDeliverable, listDeliverables, patchDeliverableConfig } = await import('./server/deliverables.mjs')
const { runPreflight } = await import('./server/publish-preflight.mjs')
const { normalizeDeliverableConfig } = await import('./server/deliverables.mjs')
const {
  createJob,
  getJob,
  getJobWithEvents,
  listJobs,
  transitionJob,
  cancelJob,
  markPublished,
  recoverInterruptedJobs,
  RETRYABLE_STATES,
} = await import('./server/publish-jobs.mjs')
const { upsertAccount, listAccounts, setAccountStatus } = await import('./server/publish-accounts.mjs')
const { buildPublishPackage } = await import('./server/publish-package.mjs')
const { checkSession, openLoginWindow, resetSessionsForTest } = await import('./server/publish-browser.mjs')
const { resolvePublishFile } = await import('./server/publish-utils.mjs')

let pass = 0
const fail = []
function ok(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') throw new Error('use okAsync for async')
    pass++
  } catch (e) {
    fail.push(`${name}: ${e.message}`)
    console.error(`FAIL ${name}: ${e.message}`)
  }
}
async function okAsync(name, fn) {
  try {
    await fn()
    pass++
  } catch (e) {
    fail.push(`${name}: ${e.message}`)
    console.error(`FAIL ${name}: ${e.message}`)
  }
}

// ---------- 成片 ----------
const vfile = path.join(publicDir, 'exports', 'src.mp4')
fs.writeFileSync(vfile, 'fake-mp4-bytes')

const dl = createDeliverable(root, {
  project: 'p1',
  episode: 1,
  title: 'ep1',
  url: '/exports/src.mp4',
  width: 1920,
  height: 1080,
  duration: 12,
  bytes: fs.statSync(vfile).size,
  source: 'export',
})
ok('成片创建', () => {
  assert.ok(dl.id)
  assert.equal(dl.version, 1)
  assert.equal(dl.project, 'p1')
})
ok('成片按集查询', () => {
  assert.equal(listDeliverables(root, { project: 'p1', episode: 1 }).length, 1)
  assert.equal(listDeliverables(root, { project: 'p1', episode: 2 }).length, 0)
})
ok('配置保存与恢复', () => {
  const cfg = normalizeDeliverableConfig({
    master: { title: '标题', description: '简介', tags: ['a'], aiGenerated: true },
    cover: { '9:16': '/exports/c9.png' },
    targets: { douyin: { selected: true, accountId: 'a', mode: 'draft' } },
  })
  const rec = patchDeliverableConfig(root, dl.id, cfg)
  assert.equal(rec.config.master.title, '标题')
  assert.equal(rec.config.targets.douyin.selected, true)
})

// ---------- 账号 ----------
const acc = upsertAccount(root, { platform: 'douyin', label: '主号', status: 'connected' })
ok('账号连接可用', () => {
  assert.equal(acc.status, 'connected')
  assert.ok(listAccounts(root).some((a) => a.id === acc.id))
})
ok('账号状态置失效', () => {
  const r = setAccountStatus(root, acc.id, 'expired', '需要重新登录')
  assert.equal(r.account.status, 'expired')
})
// 恢复为可用，后续预检要过
upsertAccount(root, { id: acc.id, platform: 'douyin', label: '主号', status: 'connected', autoDraft: false })

// ---------- 预检 ----------
fs.writeFileSync(path.join(publicDir, 'exports', 'c9.png'), 'img')
const goodConfig = normalizeDeliverableConfig({
  master: { title: '门后的声音', description: '雨夜', tags: ['悬疑'], aiGenerated: true },
  cover: { '9:16': '/exports/c9.png' },
})
ok('预检通过', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: { ...dl, url: '/exports/src.mp4' },
    targets: [{ platform: 'douyin', accountId: acc.id, mode: 'draft' }],
    config: goodConfig,
    accounts: new Map([[acc.id, acc]],
    ),
  })
  assert.equal(r.ok, true, JSON.stringify(r.blocking))
})
ok('未验证适配器不允许立即发布', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: { ...dl, url: '/exports/src.mp4' },
    targets: [{ platform: 'douyin', accountId: acc.id, mode: 'publish' }],
    config: goodConfig,
    accounts: new Map([[acc.id, acc]]),
  })
  assert.ok(r.blocking.some((b) => b.code === 'adapter_unverified'))
})
ok('未知平台阻断', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: { ...dl, url: '/exports/src.mp4' },
    targets: [{ platform: 'weibo', accountId: acc.id, mode: 'draft' }],
    config: goodConfig,
    accounts: new Map([[acc.id, acc]]),
  })
  assert.ok(r.blocking.some((b) => b.code === 'unknown_platform'))
})
ok('缺账号阻断', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: { ...dl, url: '/exports/src.mp4' },
    targets: [{ platform: 'douyin', accountId: '', mode: 'draft' }],
    config: goodConfig,
    accounts: new Map(),
  })
  assert.ok(r.blocking.some((b) => b.code === 'account_missing'))
})

// ---------- 任务 ----------
const j1 = createJob(root, {
  deliverableId: dl.id,
  project: 'p1',
  episode: 1,
  platform: 'douyin',
  accountId: acc.id,
  mode: 'draft',
  deliverableUrl: dl.url,
}).job
ok('任务创建为 queued', () => {
  assert.equal(j1.state, 'queued')
  assert.equal(j1.runNo, 1)
})
ok('任务事件包含创建', () => {
  const ev = getJobWithEvents(root, j1.id).events
  assert.ok(ev.some((e) => e.state === 'queued'))
})
ok('取消运行中任务', () => {
  transitionJob(root, j1.id, 'uploading')
  const c = cancelJob(root, j1.id)
  assert.equal(c.state, 'cancelled')
})
ok('已取消任务不能再取消', () => {
  assert.throws(() => cancelJob(root, j1.id), /已结束/)
})

// ---------- 三目标与单目标重试 ----------
const targets = [
  { platform: 'douyin', accountId: acc.id, mode: 'draft' },
  { platform: 'bilibili', accountId: upsertAccount(root, { platform: 'bilibili', label: 'B号', status: 'connected' }).id, mode: 'draft' },
  { platform: 'toutiao', accountId: upsertAccount(root, { platform: 'toutiao', label: '头号', status: 'connected' }).id, mode: 'draft' },
]
const made = targets.map((t) =>
  createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: t.platform, accountId: t.accountId, mode: t.mode }).job,
)
ok('三目标三条任务', () => {
  assert.equal(made.length, 3)
  assert.equal(new Set(made.map((j) => j.id)).size, 3)
})
ok('一个成功两个失败', () => {
  transitionJob(root, made[0].id, 'uploading')
  transitionJob(root, made[0].id, 'awaiting_confirmation')
  transitionJob(root, made[0].id, 'published', { workUrl: 'https://x/1' })
  for (const j of made.slice(1)) {
    transitionJob(root, j.id, 'uploading')
    transitionJob(root, j.id, 'failed', { errorCode: 'e', errorMessage: 'fail' })
  }
  assert.equal(getJob(root, made[0].id).state, 'published')
  assert.equal(getJob(root, made[1].id).state, 'failed')
})
ok('批量重试只碰失败目标', () => {
  const all = listJobs(root, { deliverableId: dl.id })
  const retryable = all.filter((j) => RETRYABLE_STATES.includes(j.state))
  assert.equal(retryable.length, 2)
  assert.ok(!retryable.some((j) => j.id === made[0].id))
})
ok('成功目标重试被拒绝', () => {
  assert.equal(RETRYABLE_STATES.includes('published'), false)
})
ok('标记已发布只在待确认/已提交', () => {
  assert.throws(() => markPublished(root, made[1].id), /当前状态/)
})

// ---------- 重启恢复 ----------
const jr = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'bilibili', accountId: targets[1].accountId, mode: 'draft' }).job
transitionJob(root, jr.id, 'uploading')
ok('重启恢复为 unknown', () => {
  const n = recoverInterruptedJobs(root)
  assert.ok(n >= 1)
  const after = getJob(root, jr.id)
  assert.equal(after.state, 'unknown')
  assert.equal(after.errorCode, 'server_restart')
  assert.ok(!after.endedAt || after.endedAt.length > 0)
})

// ---------- 发布包 ----------
await okAsync('发布包生成', async () => {
  const r = await buildPublishPackage(root, {
    deliverable: dl,
    config: goodConfig,
    platforms: ['douyin', 'bilibili'],
  })
  assert.ok(r.files.includes('video.mp4'))
  assert.ok(r.files.includes('copy.json'))
  assert.ok(fs.existsSync(path.join(root, 'public', 'publish-packages', r.id, 'video.mp4')))
  assert.ok(r.copy.platforms.bilibili)
})
await okAsync('发布包重复生成不同目录', async () => {
  const a = await buildPublishPackage(root, { deliverable: dl, config: goodConfig, platforms: ['douyin'] })
  const b = await buildPublishPackage(root, { deliverable: dl, config: goodConfig, platforms: ['douyin'] })
  assert.notEqual(a.id, b.id)
})

// ---------- 路径穿越 ----------
ok('预览路径穿越被拒', () => {
  assert.throws(() => resolvePublishFile(root, '/exports/../secret.txt'), /越界/)
})
ok('非白名单前缀被拒', () => {
  assert.throws(() => resolvePublishFile(root, '/src/App.tsx'), /不允许的文件位置/)
})

// ---------- 浏览器会话（本地 mock 页） ----------
const server = http.createServer((req, res) => {
  if (req.url === '/login') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<html><body><h1>请登录</h1><input type="file"></body></html>')
    return
  }
  if (req.url === '/backend') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<html><body><input type="file"><button>发布</button></body></html>')
    return
  }
  res.statusCode = 404
  res.end('nope')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

await okAsync('checkSession 识别登录页为 expired', async () => {
  resetSessionsForTest()
  const r = await checkSession({ profileDir: path.join(root, '.publish-profiles', 'mock1'), url: `${base}/login` })
  assert.equal(r.status, 'expired')
})
await okAsync('checkSession 后台页为 connected', async () => {
  const r = await checkSession({ profileDir: path.join(root, '.publish-profiles', 'mock2'), url: `${base}/backend` })
  assert.equal(r.status, 'connected')
})
await okAsync('checkSession 404 为 unknown', async () => {
  const r = await checkSession({ profileDir: path.join(root, '.publish-profiles', 'mock3'), url: `${base}/missing` })
  assert.equal(r.status, 'unknown')
})
await okAsync('登录成功判定', async () => {
  const r = await openLoginWindow({
    profileDir: path.join(root, '.publish-profiles', 'mock4'),
    url: `${base}/backend`,
    timeoutMs: 8_000,
    isLoggedIn: async (page) => page.url().includes('/backend'),
  })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'done')
})
await okAsync('登录超时判定', async () => {
  const started = Date.now()
  const r = await openLoginWindow({
    profileDir: path.join(root, '.publish-profiles', 'mock5'),
    url: `${base}/login`,
    timeoutMs: 5_000,
    isLoggedIn: async () => false,
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 'timeout')
  assert.ok(Date.now() - started >= 4_000)
})

server.close()

// ---------- 适配器 mock 页面流程 ----------
const {
  DOUYIN_ADAPTER,
  BILIBILI_ADAPTER,
  TOUTIAO_ADAPTER,
} = await import('./server/publish-adapters.mjs')
const { chromium } = await import('playwright-core')
const { resolveChrome } = await import('./server/publish-utils.mjs')

function pageHtml(kind, opts = {}) {
  const publishBtn = kind === 'bilibili' ? '立即投稿' : '发布'
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <input type="file" id="f">
    ${opts.noTitle ? '' : '<input placeholder="请输入标题">'}
    <textarea placeholder="简介"></textarea>
    <div contenteditable="true"></div>
    <button id="save">${kind === 'bilibili' ? '存草稿' : '保存草稿'}</button>
    <button id="pub" onclick="window.__published=true">${publishBtn}</button>
    <script>
      window.__published=false;
      document.getElementById('f').addEventListener('change',()=>{
        document.getElementById('save').style.display='';
        document.getElementById('pub').style.display='';
      });
    </script>
  </body></html>`
}

const adapterServer = http.createServer((req, res) => {
  const u = req.url || ''
  const kind = u.includes('bili') ? 'bilibili' : u.includes('toutiao') ? 'toutiao' : 'douyin'
  const noTitle = u.includes('notitle')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(pageHtml(kind, { noTitle }))
})
await new Promise((r) => adapterServer.listen(0, '127.0.0.1', r))
const aPort = adapterServer.address().port
const aBase = `http://127.0.0.1:${aPort}`
const chromeExe = resolveChrome()
const adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-adapter-'))
const videoForAdapter = path.join(adapterTmp, 'src.mp4')
fs.writeFileSync(videoForAdapter, 'fake-mp4')

async function withPage(url, fn) {
  const b = await chromium.launch({ executablePath: chromeExe, headless: true })
  const p = await b.newPage()
  await p.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    return await fn(p)
  } finally {
    await b.close()
  }
}

await okAsync('抖音草稿流程停在草稿页', async () => {
  await withPage(`${aBase}/douyin`, async (page) => {
    await DOUYIN_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, title: 't', description: 'd', tags: [], uploadTimeoutMs: 8_000 })
    await DOUYIN_ADAPTER.fillMetadata(page, { title: '标题', description: '简介', tags: [] })
    await DOUYIN_ADAPTER.saveDraft(page)
    const published = await page.evaluate(() => window.__published)
    assert.equal(published, false)
    const title = await page.inputValue('input[placeholder*="标题"]')
    assert.equal(title, '标题')
  })
})
await okAsync('B站草稿填标题且不点立即投稿', async () => {
  await withPage(`${aBase}/bili`, async (page) => {
    await BILIBILI_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, title: 't', description: 'd', tags: [], uploadTimeoutMs: 8_000 })
    await BILIBILI_ADAPTER.fillMetadata(page, { title: 'B站标题', description: '简介', tags: [] })
    await BILIBILI_ADAPTER.saveDraft(page)
    const published = await page.evaluate(() => window.__published)
    assert.equal(published, false)
    assert.equal(await page.inputValue('input[placeholder*="标题"]'), 'B站标题')
  })
})
await okAsync('头条缺选择器返回 selectors_changed 且不提交', async () => {
  await withPage(`${aBase}/toutiao-notitle`, async (page) => {
    await TOUTIAO_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, title: 't', description: 'd', tags: [], uploadTimeoutMs: 8_000 })
    let err = null
    try {
      await TOUTIAO_ADAPTER.fillMetadata(page, { title: 'x', description: 'y', tags: [] })
    } catch (e) {
      err = e
    }
    assert.ok(err)
    assert.equal(err.code, 'selectors_changed')
    assert.equal(await page.evaluate(() => window.__published), false)
  })
})

adapterServer.close()
fs.rmSync(adapterTmp, { recursive: true, force: true })
fs.rmSync(root, { recursive: true, force: true })

if (fail.length) {
  console.error(`\n发布 API 验证失败 ${fail.length} 项`)
  process.exitCode = 1
} else {
  console.log(`发布 API 验证（含适配器 mock）通过（${pass} 项）`)
}
