/**
 * 发布链路契约验证（不启动 HTTP、不碰真实项目库）。
 *
 * 覆盖：平台能力表、状态机、幂等键与复用、非法迁移、错误脱敏、路径白名单、
 * 预检阻断/警告、账号 profile 权限、发布包内容。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-contract-'))
const publicDir = path.join(root, 'public')
for (const sub of ['exports', 'videos', 'generated']) fs.mkdirSync(path.join(publicDir, sub), { recursive: true })
fs.mkdirSync(path.join(root, 'projects'), { recursive: true })

const {
  PLATFORMS,
  getPlatform,
  platformSupports,
  platformCanExecute,
  requiredCoverAspects,
  COVER_ASPECTS,
} = await import('./server/publish-platforms.mjs')
const {
  canTransition,
  assertTransition,
  idempotencyKey,
  createJob,
  getJob,
  getJobWithEvents,
  transitionJob,
  listJobs,
  recoverInterruptedJobs,
  RETRYABLE_STATES,
} = await import('./server/publish-jobs.mjs')
const { sanitizeError, resolvePublishFile } = await import('./server/publish-utils.mjs')
const { upsertAccount, listAccounts, deleteAccount, getAccountInternal } = await import('./server/publish-accounts.mjs')
const { runPreflight } = await import('./server/publish-preflight.mjs')
const { buildPublishPackage } = await import('./server/publish-package.mjs')
const { createDeliverable, normalizeDeliverableConfig } = await import('./server/deliverables.mjs')
const {
  registerAdapter,
  getAdapter,
  resetAdaptersForTest,
  adapterCanExecute,
  adapterCanAttachCover,
  adapterCanPublishFinal,
  DOUYIN_ADAPTER,
  BILIBILI_ADAPTER,
} = await import('./server/publish-adapters.mjs')

let checks = 0
function ok(label, fn) {
  try {
    fn()
    checks++
  } catch (e) {
    console.error(`FAIL ${label}:`, e.message)
    process.exitCode = 1
  }
}

// ---------- 平台能力表 ----------
const KNOWN_IDS = [
  'douyin', 'bilibili', 'toutiao', 'xigua', 'xiaohongshu', 'kuaishou',
  'wechat-channels', 'zhihu', 'baijiahao', 'dayu',
  'weibo', 'qiehao', 'netease-hao', 'sohu-hao',
]
ok('平台清单覆盖全部已声明平台', () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id).sort(), [...KNOWN_IDS].sort())
  const titles = new Set(PLATFORMS.filter((p) => !p.limits.titleOptional).map((p) => p.limits.titleMax))
  assert.ok(titles.size >= 2, '各平台标题上限应有差异')
  for (const p of PLATFORMS) {
    assert.ok(p.id && p.label && Array.isArray(p.modes) && p.modes.length)
    assert.ok(p.coverAspects.length)
    assert.equal(typeof p.manualOnly, 'boolean')
    assert.ok(['server', 'local', 'none'].includes(p.draftKind), `${p.id} 缺 draftKind`)
    assert.ok(p.badge && p.badge.text && p.badge.color, `${p.id} 缺 badge`)
  }
})
ok('草稿类型组合合法', () => {
  for (const p of PLATFORMS) {
    assert.ok(['server', 'local', 'none'].includes(p.draftKind), `${p.id} draftKind 非法`)
    // 不能存草稿的平台不该出现在 draft 模式里；但 draft 模式 + none 是合法的：
    // 表示「自动填好表单但不保存草稿，等人工点发布」
    if (!p.modes.includes('draft')) assert.equal(p.draftKind, 'none', `${p.id} 不在草稿流程却声明了草稿`)
    if (p.manualOnly) assert.equal(p.draftKind, 'none', `${p.id} 人工平台不应声明草稿`)
  }
  assert.equal(getPlatform('xiaohongshu').draftKind, 'local')
  assert.equal(getPlatform('douyin').draftKind, 'server')
  assert.equal(getPlatform('zhihu').draftKind, 'none')
})
ok('人工平台不进入自动执行', () => {
  for (const p of PLATFORMS.filter((x) => x.manualOnly)) {
    assert.deepEqual(p.modes, ['package'], `${p.id} 人工平台只能导出发布包`)
    assert.equal(platformCanExecute(p.id), false)
  }
})
ok('未知平台被拒绝', () => {
  assert.throws(() => getPlatform('not-a-platform'), /未知平台/)
})
ok('发布方式判定', () => {
  assert.equal(platformSupports('douyin', 'draft'), true)
  assert.equal(platformSupports('douyin', 'nope'), false)
})
ok('封面比例并集', () => {
  assert.deepEqual(requiredCoverAspects(['douyin']), ['9:16'])
  assert.deepEqual(requiredCoverAspects(['douyin', 'bilibili']), ['9:16', '16:9'])
})

// ---------- 状态机 ----------
ok('合法迁移', () => {
  assert.equal(canTransition('queued', 'uploading'), true)
  assert.equal(canTransition('uploading', 'awaiting_confirmation'), true)
  assert.equal(canTransition('submitted', 'published'), true)
})
ok('终态不可回退', () => {
  assert.equal(canTransition('published', 'uploading'), false)
  assert.equal(canTransition('failed', 'uploading'), false)
  assert.throws(() => assertTransition('published', 'uploading'), /不允许的状态迁移/)
})
ok('未知状态被拒绝', () => {
  assert.throws(() => assertTransition('bogus', 'queued'), /未知任务状态/)
})

// ---------- 幂等 ----------
ok('幂等键格式', () => {
  assert.equal(idempotencyKey('d1', 'douyin', 'a1'), 'd1|douyin|a1')
})

// ---------- 登录态 cookie ----------
ok('每个平台都声明了会话 cookie', () => {
  for (const p of PLATFORMS) {
    assert.ok(
      Array.isArray(p.sessionCookies) && p.sessionCookies.length > 0,
      `${p.id} 没有声明 sessionCookies，登录判定只能靠 DOM，扫码后可能一直没反应`,
    )
  }
  // 抖音的会话 cookie 是 sessionid 家族：扫码成功后立即写入，与页面是否重渲染无关
  assert.ok(getPlatform('douyin').sessionCookies.includes('sessionid'))
  assert.ok(getPlatform('bilibili').sessionCookies.includes('SESSDATA'))
})

const dl = createDeliverable(root, {
  project: 'p1',
  episode: 1,
  url: '/exports/a.mp4',
  duration: 10,
  width: 1920,
  height: 1080,
})
fs.writeFileSync(path.join(publicDir, 'exports', 'a.mp4'), 'x')

ok('活动任务复用', () => {
  const a = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'douyin', accountId: 'a1', mode: 'draft' })
  const b = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'douyin', accountId: 'a1', mode: 'draft' })
  assert.equal(a.job.id, b.job.id)
  assert.equal(b.reused, true)
})
ok('显式重新发布产生新轮次', () => {
  const a = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'douyin', accountId: 'a1', mode: 'draft' })
  const b = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'douyin', accountId: 'a1', mode: 'draft', republish: true })
  assert.notEqual(a.job.id, b.job.id)
  assert.equal(b.job.runNo, a.job.runNo + 1)
  assert.ok(listJobs(root, { deliverableId: dl.id }).length >= 2)
})
ok('完成任务不再复用', () => {
  const a = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'bilibili', accountId: 'a1', mode: 'draft' })
  transitionJob(root, a.job.id, 'uploading')
  transitionJob(root, a.job.id, 'failed', { errorCode: 'x', errorMessage: 'boom' })
  const b = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'bilibili', accountId: 'a1', mode: 'draft' })
  assert.notEqual(a.job.id, b.job.id)
  assert.equal(b.reused, false)
})
ok('事件时间线追加', () => {
  const jobs = listJobs(root, { project: 'p1' })
  const withEvents = getJobWithEvents(root, jobs[0].id)
  assert.ok(withEvents.events.length >= 1)
  assert.ok(withEvents.events[0].createdAt)
})
ok('重试状态集合', () => {
  assert.deepEqual(RETRYABLE_STATES.sort(), ['expired', 'failed', 'unknown'])
})

// ---------- 重启恢复 ----------
ok('重启把未完成任务标 unknown', () => {
  const j = createJob(root, { deliverableId: dl.id, project: 'p1', episode: 1, platform: 'toutiao', accountId: 'a2', mode: 'draft' }).job
  transitionJob(root, j.id, 'uploading')
  const n = recoverInterruptedJobs(root)
  assert.ok(n >= 1)
  const after = getJob(root, j.id)
  assert.equal(after.state, 'unknown')
  assert.equal(after.errorCode, 'server_restart')
})

// ---------- 错误脱敏 ----------
ok('去查询串与 token', () => {
  const s = sanitizeError(new Error('GET https://x.com/a?token=abc123&b=2 failed Bearer sk-live-999'))
  assert.ok(!s.includes('abc123'), s)
  assert.ok(!s.includes('sk-live-999'), s)
})
ok('截断 500', () => {
  assert.equal(sanitizeError('x'.repeat(2000)).length, 500)
})
ok('路径脱敏', () => {
  const s = sanitizeError('open /Users/mjy/secret/path failed')
  assert.ok(!s.includes('/Users/mjy'), s)
})

// ---------- 路径白名单 ----------
ok('允许根内路径', () => {
  const r = resolvePublishFile(root, '/exports/a.mp4')
  assert.ok(r.path.endsWith('a.mp4'))
})
ok('拒绝 ../', () => {
  assert.throws(() => resolvePublishFile(root, '/exports/../../etc/passwd'), /越界/)
})
ok('拒绝绝对路径越界', () => {
  assert.throws(() => resolvePublishFile(root, '/etc/passwd'), /不允许的文件位置/)
})
ok('拒绝远程地址', () => {
  assert.throws(() => resolvePublishFile(root, 'https://evil.com/a.mp4'), /远程/)
})
ok('拒绝符号链接逃逸', () => {
  const outside = path.join(root, 'outside.mp4')
  fs.writeFileSync(outside, 'x')
  const link = path.join(publicDir, 'exports', 'link.mp4')
  fs.symlinkSync(outside, link)
  assert.throws(() => resolvePublishFile(root, '/exports/link.mp4'), /允许目录之外|不存在/)
})

// ---------- 账号 ----------
ok('账号 profile 权限 0700', () => {
  const acc = upsertAccount(root, { platform: 'douyin', label: '主号', status: 'connected' })
  const internal = getAccountInternal(root, acc.id)
  const mode = fs.statSync(internal.profileDir).mode & 0o777
  assert.equal(mode, 0o700)
})
ok('账号列表不含 profile 路径', () => {
  const list = listAccounts(root)
  assert.ok(list.length >= 1)
  for (const a of list) {
    assert.equal('profileDir' in a, false)
    assert.equal('profile_dir' in a, false)
    assert.equal('cookies' in a, false)
  }
})
ok('删除账号移除目录', () => {
  const acc = upsertAccount(root, { platform: 'bilibili', label: '小号', status: 'connected' })
  const internal = getAccountInternal(root, acc.id)
  assert.equal(deleteAccount(root, acc.id), true)
  assert.equal(fs.existsSync(internal.profileDir), false)
})

// ---------- 适配器注册 ----------
ok('缺方法的适配器被拒绝', () => {
  resetAdaptersForTest()
  assert.throws(() => registerAdapter({ platform: 'x' }), /缺少方法/)
  const fake = {
    platform: 'x',
    verified: false,
    manualOnly: false,
    openBackend: async () => {},
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async () => {},
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
  }
  registerAdapter(fake)
  assert.ok(getAdapter('x'))
})
ok('未验证只允许草稿', () => {
  resetAdaptersForTest()
  const fake = {
    platform: 'y',
    verified: false,
    manualOnly: false,
    openBackend: async () => {},
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async () => {},
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
  }
  registerAdapter(fake)
  assert.equal(adapterCanExecute('y', 'draft'), true)
  assert.equal(adapterCanExecute('y', 'publish'), false)
  assert.equal(adapterCanPublishFinal('y'), false)
})

ok('适配器 coverSupport 默认 unverified', () => {
  resetAdaptersForTest()
  registerAdapter({
    platform: 'cov-default',
    verified: false,
    manualOnly: false,
    openBackend: async () => {},
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async () => {},
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
  })
  assert.equal(getAdapter('cov-default').coverSupport, 'unverified')
  assert.equal(adapterCanAttachCover('cov-default'), false, '未声明 supported 不得自动投递封面')
})

ok('适配器 coverSupport 非法值被拒绝', () => {
  resetAdaptersForTest()
  assert.throws(
    () =>
      registerAdapter({
        platform: 'cov-bad',
        verified: false,
        manualOnly: false,
        coverSupport: 'maybe',
        openBackend: async () => {},
        checkSession: async () => ({ status: 'connected', message: '' }),
        uploadVideo: async () => {},
        fillMetadata: async () => {},
        saveDraft: async () => {},
        submitFinal: async () => {},
        readStatus: async () => ({ status: 'submitted' }),
      }),
    /coverSupport 非法/,
  )
})

ok('声明 supported 但缺 uploadCover 仍不能投递', () => {
  resetAdaptersForTest()
  registerAdapter({
    platform: 'cov-claim',
    verified: true,
    manualOnly: false,
    coverSupport: 'supported',
    openBackend: async () => {},
    checkSession: async () => ({ status: 'connected', message: '' }),
    uploadVideo: async () => {},
    fillMetadata: async () => {},
    saveDraft: async () => {},
    submitFinal: async () => {},
    readStatus: async () => ({ status: 'submitted' }),
  })
  assert.equal(adapterCanAttachCover('cov-claim'), false, '只有声明没有实现不算能投递')
})

ok('内置适配器全部显式未验证封面', () => {
  resetAdaptersForTest()
  registerAdapter(DOUYIN_ADAPTER)
  registerAdapter(BILIBILI_ADAPTER)
  for (const id of ['douyin', 'bilibili']) {
    assert.equal(getAdapter(id).coverSupport, 'unverified', `${id} 不应谎称能投递封面`)
    assert.equal(adapterCanAttachCover(id), false)
  }
})

// ---------- 预检 ----------
const account = upsertAccount(root, { platform: 'douyin', label: '预检号', status: 'connected' })
const coverPath = path.join(publicDir, 'exports', 'c.jpg')
fs.writeFileSync(coverPath, 'x')
const baseConfig = normalizeDeliverableConfig({
  master: { title: '短标题', description: '简介', tags: ['a'], aiGenerated: true },
  cover: { '9:16': '/exports/c.jpg' },
})

ok('预检通过', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: baseConfig,
    accounts: new Map([[account.id, account]]),
  })
  assert.equal(r.ok, true, JSON.stringify(r.blocking))
})
ok('标题超限阻断', () => {
  const cfg = normalizeDeliverableConfig({
    master: { title: 'x'.repeat(40), description: '简介', tags: [], aiGenerated: true },
    cover: { '9:16': '/exports/c.jpg' },
  })
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: cfg,
    accounts: new Map([[account.id, account]]),
  })
  assert.equal(r.ok, false)
  assert.ok(r.blocking.some((b) => b.code === 'title_over_limit'))
})
ok('缺封面阻断', () => {
  const cfg = normalizeDeliverableConfig({
    master: { title: '短', description: 'x', tags: [], aiGenerated: true },
  })
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: cfg,
    accounts: new Map([[account.id, account]]),
  })
  assert.ok(r.blocking.some((b) => b.code === 'cover_missing'))
})
ok('封面不能自动投递时只警告不阻断', () => {
  resetAdaptersForTest()
  registerAdapter(DOUYIN_ADAPTER)
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: baseConfig,
    accounts: new Map([[account.id, account]]),
  })
  const warn = r.warnings.find((w) => w.code === 'cover_manual')
  assert.ok(warn, `应提示封面需人工设置：${JSON.stringify(r.warnings)}`)
  assert.match(warn.message, /不会自动上传|手动设置/)
  assert.equal(r.blocking.some((b) => b.code === 'cover_manual'), false, '这条只应是警告')
  assert.equal(r.ok, true, '有封面文件时不应因这条警告被阻断')
})
ok('未确认 AI 阻断', () => {
  const cfg = normalizeDeliverableConfig({
    master: { title: '短', description: 'x', tags: [], aiGenerated: false },
    cover: { '9:16': '/exports/c.jpg' },
  })
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: cfg,
    accounts: new Map([[account.id, account]]),
  })
  assert.ok(r.blocking.some((b) => b.code === 'ai_unconfirmed'))
})
ok('账号失效阻断', () => {
  const expired = { ...account, status: 'expired' }
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: baseConfig,
    accounts: new Map([[account.id, expired]]),
  })
  assert.ok(r.blocking.some((b) => b.code === 'account_unusable'))
})
ok('横屏发竖屏平台只警告', () => {
  const r = runPreflight({
    appRoot: root,
    deliverable: getDeliverableLite(),
    targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
    config: baseConfig,
    accounts: new Map([[account.id, account]]),
  })
  assert.ok(r.warnings.some((w) => w.code === 'aspect_mismatch'))
})

function getDeliverableLite() {
  return { id: dl.id, url: '/exports/a.mp4', width: 1920, height: 1080, duration: 10, bytes: 1 }
}

// ---------- 发布包 ----------
ok('发布包含视频/封面/copy.json', async () => {
  // 同步断言改为内部校验：buildPublishPackage 是异步，单独在下面 await
})

const pkg = await buildPublishPackage(root, {
  deliverable: { ...getDeliverableLite(), project: 'p1', episode: 1, version: 1, srtUrl: '', title: 't' },
  config: baseConfig,
  platforms: ['douyin'],
})
ok('发布包文件齐备', () => {
  assert.ok(pkg.files.includes('video.mp4'))
  assert.ok(pkg.files.includes('copy.json'))
  assert.ok(pkg.files.some((f) => f.startsWith('cover-')))
  const copy = JSON.parse(fs.readFileSync(path.join(root, 'public', 'publish-packages', pkg.id, 'copy.json'), 'utf8'))
  assert.equal(copy.aiGenerated, true)
  assert.equal(copy.platforms.douyin.label, '抖音')
  assert.ok(!JSON.stringify(copy).includes('cookie'))
})
ok('无 SRT 仍生成', () => {
  assert.equal(pkg.copy.subtitles, null)
})
ok('重复生成不覆盖', async () => {
  // 已由 id 唯一性保证，检查两次 id 不同
})

const pkg2 = await buildPublishPackage(root, {
  deliverable: { ...getDeliverableLite(), project: 'p1', episode: 1, version: 1, srtUrl: '', title: 't' },
  config: baseConfig,
  platforms: ['douyin'],
})
ok('两次生成目录不同', () => {
  assert.notEqual(pkg.id, pkg2.id)
})

// ---------- 配置裁剪 ----------
ok('配置长度上限与未知字段', () => {
  const cfg = normalizeDeliverableConfig({
    master: { title: 'x'.repeat(500), description: 'y'.repeat(9000), tags: Array.from({ length: 50 }, (_, i) => `t${i}`), aiGenerated: false },
    junk: 'nope',
    targets: { douyin: { selected: true, mode: 'publish' }, 'bad id': { selected: true } },
  })
  assert.equal(cfg.master.title.length, 200)
  assert.equal(cfg.master.description.length, 5000)
  assert.equal(cfg.master.tags.length, 30)
  assert.equal('junk' in cfg, false)
  assert.ok(cfg.targets.douyin)
  assert.equal(cfg.targets['bad id'], undefined)
})

// ---------- 封面比例持久化 ----------
ok('封面四档全部保留', () => {
  const cfg = normalizeDeliverableConfig({
    cover: { '9:16': '/exports/a.jpg', '16:9': '/exports/b.jpg', '3:4': '/exports/c.jpg', '4:3': '/exports/d.jpg' },
  })
  assert.deepEqual(Object.keys(cfg.cover).sort(), ['16:9', '3:4', '4:3', '9:16'].sort())
  assert.equal(cfg.cover['3:4'], '/exports/c.jpg')
  assert.equal(cfg.cover['4:3'], '/exports/d.jpg')
})

ok('每个平台声明的每个比例都能被规范化保留', () => {
  for (const p of PLATFORMS) {
    for (const aspect of p.coverAspects) {
      const cfg = normalizeDeliverableConfig({ cover: { [aspect]: `/exports/${aspect.replace(':', 'x')}.jpg` } })
      assert.ok(cfg.cover[aspect], `${p.id} 的 ${aspect} 被封面的白名单丢掉了`)
    }
  }
  assert.deepEqual(COVER_ASPECTS, ['9:16', '3:4', '4:3', '16:9'])
})

ok('内联图片数据不进入配置', () => {
  const dataUrl = `data:image/jpeg;base64,${'A'.repeat(2000)}`
  const cfg = normalizeDeliverableConfig({
    cover: { '9:16': dataUrl, '16:9': '/exports/ok.jpg', '3:4': 'relative/x.jpg', '4:3': '//evil.test/x.jpg' },
  })
  // 只有站内绝对路径保留；data:/相对路径/协议相对地址一律丢弃
  assert.ok(cfg.cover['16:9'])
  assert.equal(cfg.cover['9:16'], undefined)
  assert.equal(cfg.cover['3:4'], undefined)
  assert.equal(cfg.cover['4:3'], undefined)
})

ok('前端比例常量与服务端同序同集', () => {
  // 两份常量分处服务端与浏览器包，无法互相 import；用源码断言把漂移变成测试失败
  const src = fs.readFileSync(path.join(process.cwd(), 'src/publish/types.ts'), 'utf8')
  const m = src.match(/COVER_ASPECTS[^=]*=\s*\[([^\]]+)\]/)
  assert.ok(m, '没找到前端 COVER_ASPECTS')
  const front = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  assert.deepEqual(front, COVER_ASPECTS)
})

fs.rmSync(root, { recursive: true, force: true })
if (process.exitCode) {
  console.error(`\n发布契约验证失败`)
} else {
  console.log(`发布契约验证通过（${checks} 项）`)
}
