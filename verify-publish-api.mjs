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
/** 用给定的标题对某个平台跑一次预检，返回阻断码集合 */
function preflightFor(platform, title, extra = {}) {
  const acc2 = upsertAccount(root, { platform, label: `acc-${platform}`, status: 'connected' })
  const cfg = normalizeDeliverableConfig({
    master: { title, description: '简介简介简介', tags: ['a'], aiGenerated: true },
    cover: { '9:16': '/exports/c9.png', '16:9': '/exports/c9.png', '3:4': '/exports/c9.png', '4:3': '/exports/c9.png' },
    targets: { [platform]: { selected: true, accountId: acc2.id, mode: 'draft' } },
    ...extra,
  })
  const r = runPreflight({
    appRoot: root,
    deliverable: { ...dl, url: '/exports/src.mp4' },
    targets: [{ platform, accountId: acc2.id, mode: 'draft' }],
    config: cfg,
    accounts: new Map([[acc2.id, acc2]]),
  })
  return r
}
ok('知乎标题下限 5 字', () => {
  assert.ok(preflightFor('zhihu', '一二三四').blocking.some((b) => b.code === 'title_too_short'))
  assert.ok(!preflightFor('zhihu', '一二三四五').blocking.some((b) => b.code === 'title_too_short'))
})
ok('百家号标题下限 9 字', () => {
  assert.ok(preflightFor('baijiahao', '一二三四五六七八').blocking.some((b) => b.code === 'title_too_short'))
  assert.ok(!preflightFor('baijiahao', '一二三四五六七八九').blocking.some((b) => b.code === 'title_too_short'))
})
ok('大鱼号标题上限 60 字', () => {
  const long = '长'.repeat(61)
  assert.ok(preflightFor('dayu', long).blocking.some((b) => b.code === 'title_over_limit'))
  assert.ok(!preflightFor('dayu', '长'.repeat(60)).blocking.some((b) => b.code === 'title_over_limit'))
})
ok('视频号短标题区间 6–16', () => {
  assert.ok(preflightFor('wechat-channels', '一二三四五').blocking.some((b) => b.code === 'title_too_short'))
  assert.ok(!preflightFor('wechat-channels', '一二三四五六七八九十').blocking.some((b) => b.code === 'title_too_short'))
})
ok('快手没有独立标题时不因标题为空阻断', () => {
  const r = preflightFor('kuaishou', '')
  assert.ok(!r.blocking.some((b) => b.code === 'title_empty' || b.code === 'title_too_short'))
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
    targets: [{ platform: 'not-a-platform', accountId: acc.id, mode: 'draft' }],
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
await okAsync('checkSession 没有判定函数时如实返回 unknown', async () => {
  // 不能因为 URL 不是登录页就宣称已登录：mock 后台地址同样不含 login
  const r = await checkSession({ profileDir: path.join(root, '.publish-profiles', 'mock2'), url: `${base}/backend` })
  assert.equal(r.status, 'unknown')
})
await okAsync('checkSession 带后台判定时为 connected', async () => {
  const r = await checkSession({
    profileDir: path.join(root, '.publish-profiles', 'mock2b'),
    url: `${base}/backend`,
    isLoggedIn: async (page) => Boolean(await page.$('input[type="file"]')),
  })
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

// 后台地址不含 login、登录框是同页弹层时，不能在第一轮就判成功（否则窗口一闪而过）
await okAsync('未登录不会因 URL 不像登录页就判成功', async () => {
  const { adapterLoginProbe } = await import('./server/publish-browser.mjs')
  const probeServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // /creator-micro/content/upload 不含 login/passport，但没有上传框 = 还在登录页
    res.end('<div id="login-modal">请扫码登录</div>')
  })
  await new Promise((r) => probeServer.listen(0, '127.0.0.1', r))
  const pBase = `http://127.0.0.1:${probeServer.address().port}`
  const { resetAdaptersForTest: resetA, registerAdapter: regA } = await import('./server/publish-adapters.mjs')
  resetA()
  regA({
    platform: 'douyin',
    verified: false,
    manualOnly: false,
    openBackend: async () => {},
    checkSession: async (page) => {
      const upload = await page.$('input[type="file"]').catch(() => null)
      return upload
        ? { status: 'connected', message: '会话有效' }
        : { status: 'unknown', message: '页面结构无法确认登录状态' }
    },
    uploadVideo: async () => {},
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
  })
  const started = Date.now()
  const r = await openLoginWindow({
    profileDir: path.join(root, '.publish-profiles', 'mock-nologin'),
    url: `${pBase}/creator-micro/content/upload`,
    timeoutMs: 4_000,
    isLoggedIn: adapterLoginProbe('douyin', { requiredChecks: 2, gapMs: 300 }),
  })
  probeServer.close()
  assert.equal(r.ok, false, '没有后台元素时必须判未登录')
  assert.notEqual(r.status, 'done', '不得在第一轮就宣布登录成功')
  assert.ok(Date.now() - started >= 3_000, '应真的等满超时，而不是立刻关窗')
})

// 已登录账号点「重新登录」：cookie 本来就在，自动判定会秒过，必须改成人工确认
await okAsync('重新登录不会因已有 cookie 而自动完成', async () => {
  const { startLogin, getSession, confirmLogin, resetSessionsForTest: resetSessions } = await import('./server/publish-browser.mjs')
  resetSessions()
  const probeServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<h1>后台</h1>')
  })
  await new Promise((r) => probeServer.listen(0, '127.0.0.1', r))
  const pBase = `http://127.0.0.1:${probeServer.address().port}`
  const dir = path.join(root, '.publish-profiles', 'mock-relogin')
  fs.mkdirSync(dir, { recursive: true })

  // 预先放入「已登录」的证据：cookie 判定直接成立
  const job = startLogin({
    platform: 'douyin',
    accountId: 'acc-relogin',
    profileDir: dir,
    url: `${pBase}/creator-micro/content/upload`,
    timeoutMs: 20_000,
    requireConfirm: true,
    minDwellMs: 0,
    isLoggedIn: async () => true,
  })
  assert.equal(job.requireConfirm, true, '重新登录必须是人工确认模式')

  // 等它检测到登录态，但状态必须停在 awaiting 而不是 done
  let st = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300))
    st = getSession(job.id)
    if (st && st.detected) break
  }
  assert.equal(st?.detected, true, '应检测到登录态')
  assert.equal(st?.status, 'awaiting', `有 cookie 也不能自己完成，实际 ${st?.status}`)

  // 用户点「我已完成登录」才收尾
  confirmLogin(job.id)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300))
    st = getSession(job.id)
    if (st?.status === 'done') break
  }
  assert.equal(st?.status, 'done')
  probeServer.close()
})

server.close()

// ---------- 适配器 mock 页面流程 ----------
const {
  DOUYIN_ADAPTER,
  BILIBILI_ADAPTER,
  TOUTIAO_ADAPTER,
  XIGUA_ADAPTER,
  XIAOHONGSHU_ADAPTER,
  KUAISHOU_ADAPTER,
  WECHAT_CHANNELS_ADAPTER,
} = await import('./server/publish-adapters.mjs')
const { chromium } = await import('playwright-core')
const { resolveChrome } = await import('./server/publish-utils.mjs')

function pageHtml(kind, opts = {}) {
  // 每个平台只模拟「选择器形状」，用来验证步骤表；不模仿真实样式
  const saveText =
    kind === 'bilibili' ? '存草稿'
    : kind === 'xiaohongshu' ? '暂存离开'
    : kind === 'wechat-channels' ? '保存草稿'
    : kind === 'kuaishou' ? ''
    : kind === 'xigua' ? '存草稿'
    : '保存草稿'
  const pubText =
    kind === 'bilibili' ? '立即投稿'
    : kind === 'wechat-channels' ? '发表'
    : '发布'
  const titleInput =
    kind === 'wechat-channels'
      ? '<input placeholder="填写短标题有机会获得更多流量">'
      : kind === 'kuaishou'
        ? ''
        : kind === 'xiaohongshu'
          ? '<input placeholder="填写标题">'
          : opts.noTitle
            ? ''
            : '<input placeholder="请输入标题">'
  const bodyEditor =
    kind === 'xiaohongshu'
      ? '<p data-placeholder="输入正文描述" contenteditable="true"></p>'
      : kind === 'wechat-channels'
        ? '<div class="input-editor" contenteditable="true"></div>'
        : kind === 'kuaishou'
          ? '<div contenteditable="true"></div>'
          : '<textarea placeholder="简介"></textarea><div contenteditable="true"></div>'
  const uploadSel =
    kind === 'xiaohongshu' ? 'class="upload-input"'
    : kind === 'kuaishou' ? 'class="upload-btn-input"'
    : ''
  const form = `
    <input type="file" id="f" ${uploadSel}>
    ${titleInput}
    ${bodyEditor}
    ${saveText ? `<button id="save">${saveText}</button>` : ''}
    <button id="pub" onclick="window.__published=true">${pubText}</button>
    <div class="publish-ready" style="display:none">ready</div>
    <script>
      window.__published=false;
      document.getElementById('f').addEventListener('change',()=>{
        document.querySelector('.publish-ready').style.display='';
      });
    </script>`
  // formOnly：框架内的表单页；否则视频号在外层套一个 iframe
  if (opts.formOnly) return `<!doctype html><html><head><meta charset="utf-8"></head><body>${form}</body></html>`
  if (kind === 'wechat-channels' && !opts.noFrame) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <iframe src="/micro/content/post/create" style="width:900px;height:600px;border:0"></iframe>
    </body></html>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${form}</body></html>`
}

const KIND_BY_KEY = [
  ['xiaohongshu', 'xiaohongshu'],
  ['xigua', 'xigua'],
  ['kuaishou', 'kuaishou'],
  ['wechat', 'wechat-channels'],
  ['bili', 'bilibili'],
  ['toutiao', 'toutiao'],
  ['douyin', 'douyin'],
]
const adapterServer = http.createServer((req, res) => {
  const u = req.url || ''
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // 框架路由必须先判：它自身不含平台关键字（否则会匹配到外层分支）
  if (u.includes('post/create')) {
    res.end(pageHtml('wechat-channels', { formOnly: true }))
    return
  }
  const hit = KIND_BY_KEY.find(([key]) => u.includes(key))
  const kind = hit ? hit[1] : 'douyin'
  const noTitle = u.includes('notitle')
  const noFrame = u.includes('noframe')
  res.end(pageHtml(kind, { noTitle, noFrame }))
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

await okAsync('西瓜走同族步骤表且不点发布', async () => {
  await withPage(`${aBase}/xigua`, async (page) => {
    await XIGUA_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, uploadTimeoutMs: 8_000 })
    await XIGUA_ADAPTER.fillMetadata(page, { title: '西瓜标题', description: '简介' })
    await XIGUA_ADAPTER.saveDraft(page)
    assert.equal(await page.evaluate(() => window.__published), false)
    assert.equal(await page.inputValue('input[placeholder*="标题"]'), '西瓜标题')
  })
})
await okAsync('小红书填标题与富文本正文且不点发布', async () => {
  await withPage(`${aBase}/xiaohongshu`, async (page) => {
    await XIAOHONGSHU_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, uploadTimeoutMs: 8_000 })
    await XIAOHONGSHU_ADAPTER.fillMetadata(page, { title: '红书标题', description: '正文内容' })
    await XIAOHONGSHU_ADAPTER.saveDraft(page)
    assert.equal(await page.evaluate(() => window.__published), false)
    assert.equal(await page.inputValue('input[placeholder*="填写标题"]'), '红书标题')
    const body = await page.textContent('p[data-placeholder*="输入正文描述"]')
    assert.equal(body, '正文内容')
  })
})
await okAsync('快手只写描述（标题并入首行）且不点发布', async () => {
  await withPage(`${aBase}/kuaishou`, async (page) => {
    await KUAISHOU_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, uploadTimeoutMs: 8_000 })
    await KUAISHOU_ADAPTER.fillMetadata(page, { title: '快手标题', description: '描述正文' })
    // 没有草稿入口：saveDraft 是空操作
    await KUAISHOU_ADAPTER.saveDraft(page)
    assert.equal(await page.evaluate(() => window.__published), false)
    const text = await page.textContent('div[contenteditable="true"]')
    assert.ok(text.includes('快手标题') && text.includes('描述正文'), text)
  })
})
await okAsync('视频号在 iframe 内完成上传与短标题', async () => {
  await withPage(`${aBase}/wechat`, async (page) => {
    await WECHAT_CHANNELS_ADAPTER.uploadVideo(page, { videoPath: videoForAdapter, uploadTimeoutMs: 8_000 })
    await WECHAT_CHANNELS_ADAPTER.fillMetadata(page, { title: '短标题六字', description: '描述' })
    await WECHAT_CHANNELS_ADAPTER.saveDraft(page)
    const frame = page.frames().find((f) => f.url().includes('micro/content/post/create'))
    assert.ok(frame, '应该找到表单框架')
    assert.equal(await frame.evaluate(() => window.__published), false)
    assert.equal(await frame.inputValue('input[placeholder*="短标题"]'), '短标题六字')
  })
})
await okAsync('视频号缺框架时返回 selectors_changed', async () => {
  await withPage(`${aBase}/wechat-noframe`, async (page) => {
    let err = null
    try {
      await WECHAT_CHANNELS_ADAPTER.openBackend(page)
    } catch (e) {
      err = e
    }
    assert.ok(err, '缺框架应失败而不是继续')
    assert.equal(err.code, 'selectors_changed')
  })
})

adapterServer.close()
fs.rmSync(adapterTmp, { recursive: true, force: true })

// ---------- 封面端到端（保存 → 回读 → 预检 → 任务上下文）----------
const coverTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-cover-e2e-'))
const coverApp = path.join(coverTmp, 'app')
const coverPub = path.join(coverTmp, 'projects')
fs.mkdirSync(path.join(coverApp, 'public', 'exports'), { recursive: true })
fs.mkdirSync(coverPub, { recursive: true })
const { patchDeliverableConfig: patchCfg, getDeliverable: getCoverDeliverable } = await import('./server/deliverables.mjs')
const { stageIntent, confirmIntent } = await import('./server/publish-intents.mjs')
const { registerAdapter, resetAdaptersForTest } = await import('./server/publish-adapters.mjs')
const { enqueue, resetQueueForTest, setContextFactoryForTest, closeKeptOpenWindows } = await import('./server/publish-queue.mjs')

// 四档封面文件都真实存在，才能验证「保存后回读 + 预检通过」
for (const name of ['c916.jpg', 'c169.jpg', 'c34.jpg', 'c43.jpg']) {
  fs.writeFileSync(path.join(coverApp, 'public', 'exports', name), 'img')
}
fs.writeFileSync(path.join(coverApp, 'public', 'exports', 'v.mp4'), 'fake-mp4')
const coverDl = createDeliverable(coverPub, {
  project: 'cov',
  episode: 1,
  title: '封面端到端',
  url: '/exports/v.mp4',
  width: 1080,
  height: 1920,
  duration: 8,
  bytes: 8,
  source: 'import',
})
const coverAcc = upsertAccount(coverPub, { platform: 'xiaohongshu', label: '红书号', status: 'connected' })
const fourCovers = {
  '9:16': '/exports/c916.jpg',
  '16:9': '/exports/c169.jpg',
  '3:4': '/exports/c34.jpg',
  '4:3': '/exports/c43.jpg',
}

await okAsync('四档封面保存后回读仍在', async () => {
  const saved = patchCfg(
    coverPub,
    coverDl.id,
    normalizeDeliverableConfig({
      master: { title: '封面端到端标题', description: '简介', tags: [], aiGenerated: true },
      cover: fourCovers,
    }),
  )
  assert.deepEqual(Object.keys(saved.config.cover).sort(), ['16:9', '3:4', '4:3', '9:16'].sort())
  const reread = getCoverDeliverable(coverPub, coverDl.id)
  assert.equal(reread.config.cover['3:4'], '/exports/c34.jpg', '3:4 不应在回读时消失')
  assert.equal(reread.config.cover['4:3'], '/exports/c43.jpg', '4:3 不应在回读时消失')
})

await okAsync('小红书 3:4 封面已备时预检通过', async () => {
  const reread = getCoverDeliverable(coverPub, coverDl.id)
  const r = runPreflight({
    appRoot: coverApp,
    projectsRoot: coverPub,
    deliverable: reread,
    targets: [{ platform: 'xiaohongshu', accountId: coverAcc.id, mode: 'draft' }],
    config: reread.config,
    accounts: new Map([[coverAcc.id, coverAcc]]),
  })
  assert.equal(r.ok, true, JSON.stringify(r.blocking))
  assert.ok(!r.blocking.some((b) => b.code === 'cover_missing'))
})

await okAsync('抽帧落盘地址即为可投递地址', async () => {
  // 模拟抽帧落盘后写入配置的产物：站内路径 + 文件真实存在
  const saved = patchCfg(
    coverPub,
    coverDl.id,
    normalizeDeliverableConfig({
      master: { title: '封面端到端标题', description: '简介', tags: [], aiGenerated: true },
      cover: { '9:16': '/exports/c916.jpg' },
    }),
  )
  const r = runPreflight({
    appRoot: coverApp,
    projectsRoot: coverPub,
    deliverable: saved,
    targets: [{ platform: 'douyin', accountId: coverAcc.id, mode: 'draft' }],
    config: saved.config,
    accounts: new Map([[coverAcc.id, { ...coverAcc, platform: 'douyin' }]]),
  })
  assert.ok(!r.blocking.some((b) => b.code === 'cover_missing'), JSON.stringify(r.blocking))
})

await okAsync('暂存确认后任务上下文含封面路径', async () => {
  process.env.PUBLISH_CHROME_PATH = process.env.PUBLISH_CHROME_PATH || '/bin/sh'
  // 小红书要 3:4：先准备好该比例，否则预检会（正确地）阻断
  patchCfg(
    coverPub,
    coverDl.id,
    normalizeDeliverableConfig({
      master: { title: '封面端到端标题', description: '简介', tags: [], aiGenerated: true },
      cover: fourCovers,
    }),
  )
  const seen = []
  resetAdaptersForTest()
  registerAdapter({
    platform: 'xiaohongshu',
    verified: true,
    manualOnly: false,
    openBackend: async () => {},
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async (_p, ctx) => { seen.push(ctx) },
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'draft' }),
  })
  // resetQueueForTest 会把注入的 contextFactory 清掉，必须先重置再注入
  resetQueueForTest()
  setContextFactoryForTest(async () => ({
    pages: () => [{ url: () => 'https://example.test/backend', $: async () => ({}) }],
    close: async () => {},
    newPage: async () => ({ url: () => 'x', $: async () => ({}) }),
  }))

  const deliverable = getCoverDeliverable(coverPub, coverDl.id)
  const intent = stageIntent(coverPub, {
    deliverableId: coverDl.id,
    targets: [{ platform: 'xiaohongshu', accountId: coverAcc.id, mode: 'draft' }],
    config: deliverable.config,
    source: 'manual',
    appRoot: coverApp,
  })
  const confirmed = confirmIntent(coverPub, intent.id, { appRoot: coverApp })
  const job = confirmed.jobs[0]
  enqueue(job.id, { root: coverPub, appRoot: coverApp, projectsRoot: coverPub })
  for (let i = 0; i < 100; i++) {
    const st = getJob(coverPub, job.id)?.state
    if (['awaiting_confirmation', 'failed', 'unknown'].includes(st)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(getJob(coverPub, job.id).state, 'awaiting_confirmation', '任务应停在草稿')
  assert.equal(seen.length, 1, '适配器应被调用一次')
  assert.ok(seen[0].coverPath, '上下文应带封面绝对路径')
  assert.equal(seen[0].coverPath, fs.realpathSync(path.join(coverApp, 'public', 'exports', 'c34.jpg')))
  assert.deepEqual(Object.keys(seen[0].covers), ['3:4'], `小红书只应取 3:4：${Object.keys(seen[0].covers)}`)
  // 草稿成功后窗口会留给用户，验证脚本要把假窗口收掉再重置队列
  await closeKeptOpenWindows()
  resetQueueForTest()
})

fs.rmSync(coverTmp, { recursive: true, force: true })
fs.rmSync(root, { recursive: true, force: true })

if (fail.length) {
  console.error(`\n发布 API 验证失败 ${fail.length} 项`)
  process.exitCode = 1
} else {
  console.log(`发布 API 验证（含适配器 mock）通过（${pass} 项）`)
}
