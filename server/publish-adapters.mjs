/**
 * 平台适配器：把「打开后台 → 登录校验 → 上传 → 填文案 → 存草稿 → 终发布」拆成显式步骤。
 *
 * 设计取舍：
 * - 每个适配器是一张声明式步骤表（选择器 + 动作），而不是一段长脚本。页面改版时，
 *   缺少任何必需选择器都会提前返回 selectors_changed，不会盲点。
 * - submitFinal 单独存在且默认不调用；自动流程只走到 saveDraft。
 * - 适配器不知道 cookie、不知道数据库，只拿到 page 与上下文，方便用本地 mock 页验证。
 */

/** 适配器必需方法；缺一个就不允许注册 */
export const ADAPTER_METHODS = [
  'openBackend',
  'checkSession',
  'uploadVideo',
  'fillMetadata',
  'saveDraft',
  'submitFinal',
  'readStatus',
]

/**
 * 封面投递能力：
 * - supported：实现了封面上传步骤，且选择器已在真实登录态验证过；
 * - unverified：有实现或还没实现，但未在真实登录态验证 —— 不允许点未知选择器；
 * - unsupported：平台没有自定义封面入口。
 *
 * 只有 supported 才执行封面动作；其余如实报告「未自动投递」。
 */
export const COVER_SUPPORT = ['supported', 'unverified', 'unsupported']

/** 默认 unverified：没声明就当作不能自动投递，避免盲点 */
export const DEFAULT_COVER_SUPPORT = 'unverified'

/** 声明式步骤：sel 是选择器，missing 时按 selectors_changed 处理 */
function step(kind, sel, label, extra = {}) {
  return { kind, sel, label, ...extra }
}

/**
 * 定位元素：需要文案匹配时用 locator(sel, { hasText })。
 * 不用 CSS 的 :has-text()——当前 playwright-core 的 waitForSelector 不解析它，
 * 会静默等到超时（实测踩到）。
 *
 * 步骤带 frame 时，定位范围换成该 iframe 的 frameLocator；
 * 框架本身找不到会在 use 时抛错，由 runSteps 归为 selectors_changed。
 */
function scopeOf(page, s) {
  if (!s.frame) return page
  return page.frameLocator(s.frame)
}

function locate(page, s) {
  const scope = scopeOf(page, s)
  if (s.hasText) return scope.locator(s.sel || 'button', { hasText: s.hasText }).first()
  return scope.locator(s.sel).first()
}

/**
 * 通用执行器：按步骤表操作页面。
 * 每一步先等选择器；超时即判定页面结构变化，而不是继续点下一步。
 * 步骤可选 `frame`：表单在内嵌框架里时只在该框架内定位，不在主文档盲找。
 */
export async function runSteps(page, steps, ctx = {}) {
  const done = []
  for (const s of steps) {
    try {
      if (s.kind === 'goto') {
        await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      } else if (s.kind === 'waitFrame') {
        // s.frame 是框架的 CSS 选择器（与后续步骤的 frame 值同形），直接用
        await page.waitForSelector(s.frame, {
          state: 'attached',
          timeout: s.timeout ?? 20_000,
        })
      } else if (s.kind === 'wait') {
        await locate(page, s).waitFor({ state: 'visible', timeout: s.timeout ?? 15_000 })
      } else if (s.kind === 'click') {
        const el = locate(page, s)
        await el.waitFor({ state: 'visible', timeout: s.timeout ?? 15_000 })
        await el.click()
      } else if (s.kind === 'fill') {
        const el = locate(page, s)
        await el.waitFor({ state: 'visible', timeout: s.timeout ?? 15_000 })
        const value = typeof s.value === 'function' ? s.value(ctx) : s.value
        await el.fill(String(value ?? ''))
      } else if (s.kind === 'setInputFiles') {
        const el = locate(page, s)
        await el.waitFor({ state: 'attached', timeout: s.timeout ?? 15_000 })
        const value = typeof s.value === 'function' ? s.value(ctx) : s.value
        await el.setInputFiles(value)
      } else if (s.kind === 'waitForFunction') {
        // 保持原有语义：在主文档执行脚本；带 frame 时在该框架的 page 上执行
        if (s.frame) {
          const handle = await page.waitForSelector(`iframe[src*="${s.frame}"]`, {
            state: 'attached',
            timeout: s.timeout ?? 20_000,
          })
          const frame = await handle.contentFrame()
          if (!frame) throw new Error('框架不可用')
          await frame.waitForFunction(s.script, ctx, { timeout: s.timeout ?? 120_000 })
        } else {
          await page.waitForFunction(s.script, ctx, { timeout: s.timeout ?? 120_000 })
        }
      } else if (s.kind === 'captchaCheck') {
        const found = await scopeOf(page, s)
          .locator(s.sel)
          .first()
          .count()
          .catch(() => 0)
        if (found) {
          const err = new Error('需要人工验证')
          err.code = 'awaiting_user'
          err.stage = s.label
          throw err
        }
      } else {
        throw new Error(`未知步骤类型：${s.kind}`)
      }
      done.push(s.label)
    } catch (e) {
      if (e && e.code) throw e
      const err = new Error(`${s.label}失败`)
      // 等待类超时都算页面结构变化；含框架/元素不存在时的 selector 报错
      err.code = /Timeout|waiting for selector|strict mode|No element|not found/i.test(
        String(e?.message || ''),
      )
        ? 'selectors_changed'
        : 'adapter_error'
      err.stage = s.label
      err.detail = String(e?.message || e)
      throw err
    }
  }
  return done
}

/**
 * 抖音：上传页 → 标题/简介 → 保存草稿；终发布不在自动路径里。
 *
 * 封面：实测（2026-10-26，真实登录态）上传页不含「封面」字样，封面设置入口
 * 只在上传视频完成后才渲染，无法在空页取得选择器。coverSupport 保持
 * unverified：不点未知选择器，由任务记录如实报告「封面未自动投递」。
 */
export const DOUYIN_ADAPTER = {
  platform: 'douyin',
  verified: false,
  // 封面入口需登录态核对；未核对前不点未知选择器
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [step('goto', '', '打开创作后台', { url: 'https://creator.douyin.com/creator-micro/content/upload' })]),
  checkSession: async (page) => {
    const url = page.url()
    if (/login|passport/i.test(url)) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input[type="file"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('captchaCheck', '#captcha_container', '验证码检查'),
      step('setInputFiles', 'input[type="file"]', '上传视频', { value: () => ctx.videoPath, timeout: 20_000 }),
      step('wait', 'button', '等待上传完成', { hasText: '保存草稿',
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="标题"]', '填写标题', { value: () => ctx.title }),
      step('fill', 'div[contenteditable="true"]', '填写简介', { value: () => ctx.description }),
    ]),
  saveDraft: async (page) =>
    runSteps(page, [step('click', 'button', '保存草稿', { hasText: '保存草稿' })]),
  submitFinal: async (page) =>
    runSteps(page, [step('click', 'button', '提交发布', { hasText: '发布' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/**
 * B站：上传页 → 标题/简介 → 存草稿。
 * 分区、标签与封面的入口都未在真实登录态核对，coverSupport=unverified。
 */
export const BILIBILI_ADAPTER = {
  platform: 'bilibili',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [
      step('goto', '', '打开投稿后台', { url: 'https://member.bilibili.com/platform/upload/video/frame' }),
    ]),
  checkSession: async (page) => {
    if (/passport|login/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input[type="file"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'input[type="file"]', '上传视频', { value: () => ctx.videoPath, timeout: 20_000 }),
      step('wait', 'button', '等待上传完成', { hasText: '存草稿',
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="标题"]', '填写标题', { value: () => ctx.title }),
      step('fill', 'textarea', '填写简介', { value: () => ctx.description }),
    ]),
  saveDraft: async (page) => runSteps(page, [step('click', 'button', '存草稿', { hasText: '存草稿' })]),
  submitFinal: async (page) => runSteps(page, [step('click', 'button', '立即投稿', { hasText: '立即投稿' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/** 头条：上传页 → 标题/简介 → 存草稿；页面结构变动频繁，未验证时按手动处理 */
export const TOUTIAO_ADAPTER = {
  platform: 'toutiao',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [
      step('goto', '', '打开头条后台', { url: 'https://mp.toutiao.com/profile_v4/xigua/upload-video' }),
    ]),
  checkSession: async (page) => {
    if (/login|passport|sso/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input[type="file"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'input[type="file"]', '上传视频', { value: () => ctx.videoPath }),
      step('wait', 'button', '等待上传完成', { hasText: '存草稿',
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="标题"]', '填写标题', { value: () => ctx.title }),
      step('fill', 'textarea', '填写简介', { value: () => ctx.description }),
    ]),
  saveDraft: async (page) => runSteps(page, [step('click', 'button', '存草稿', { hasText: '存草稿' })]),
  submitFinal: async (page) => runSteps(page, [step('click', 'button', '提交发布', { hasText: '发布' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/** 西瓜视频：字节系，后台与头条同族，复用同一套表单结构 */
export const XIGUA_ADAPTER = {
  platform: 'xigua',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [step('goto', '', '打开西瓜创作平台', { url: 'https://studio.ixigua.com/upload' })]),
  checkSession: async (page) => {
    if (/login|passport|sso/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input[type="file"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'input[type="file"]', '上传视频', { value: () => ctx.videoPath }),
      step('wait', 'button', '等待上传完成', { hasText: '存草稿',
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="标题"]', '填写标题', { value: () => ctx.title }),
      step('fill', 'textarea', '填写简介', { value: () => ctx.description }),
    ]),
  saveDraft: async (page) => runSteps(page, [step('click', 'button', '存草稿', { hasText: '存草稿' })]),
  submitFinal: async (page) => runSteps(page, [step('click', 'button', '发布', { hasText: '发布' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/** 小红书：正文是富文本可编辑段落；草稿存在浏览器本地（draftKind: local） */
export const XIAOHONGSHU_ADAPTER = {
  platform: 'xiaohongshu',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [
      step('goto', '', '打开发布页', {
        url: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video',
      }),
    ]),
  checkSession: async (page) => {
    if (/login|passport|signin/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input.upload-input, input[type="file"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'input.upload-input', '上传视频', {
        value: () => ctx.videoPath,
        timeout: 30_000,
      }),
      step('wait', 'div[class*="publish"]', '等待上传完成', {
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="填写标题"]', '填写标题', { value: () => ctx.title }),
      // 正文是 contenteditable 段落，不是 textarea
      step('fill', 'p[data-placeholder*="输入正文描述"], div[contenteditable="true"]', '填写正文', {
        value: () => ctx.description,
      }),
    ]),
  saveDraft: async (page) =>
    runSteps(page, [step('click', 'button', '暂存离开', { hasText: '暂存离开' })]),
  submitFinal: async (page) => runSteps(page, [step('click', 'button', '发布', { hasText: '发布' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/** 快手：没有独立标题，标题并入描述；没有草稿入口（draftKind: none） */
export const KUAISHOU_ADAPTER = {
  platform: 'kuaishou',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [
      step('goto', '', '打开快手创作者平台', { url: 'https://cp.kuaishou.com/article/publish/video' }),
    ]),
  checkSession: async (page) => {
    if (/login|passport|signin/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    const upload = await page.$('input[type="file"], [class*="upload-btn"]').catch(() => null)
    return upload
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '页面结构无法确认登录状态' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'div[class*="upload"] input[type="file"], input[type="file"]', '上传视频', {
        value: () => ctx.videoPath,
        timeout: 30_000,
      }),
      step('wait', 'div[contenteditable="true"]', '等待上传完成', {
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      // 没有标题字段：把标题作为描述首行
      step('fill', 'div[contenteditable="true"]', '填写描述', {
        value: () => [ctx.title, ctx.description].filter(Boolean).join('\n'),
      }),
    ]),
  // 没有草稿：表单填好即返回，由人工在窗口里点发布
  saveDraft: async () => [],
  submitFinal: async (page) => runSteps(page, [step('click', 'button', '发布', { hasText: '发布' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

/**
 * 微信视频号：表单在 micro/content/post/create 内嵌框架内；短标题 6–16 字。
 * 上传完成会刷新表单，但封面入口未核对，coverSupport=unverified。
 */
export const WECHAT_CHANNELS_ADAPTER = {
  platform: 'wechat-channels',
  verified: false,
  coverSupport: 'unverified',
  manualOnly: false,
  openBackend: async (page) =>
    runSteps(page, [
      step('goto', '', '打开视频号发布页', { url: 'https://channels.weixin.qq.com/platform/post/create' }),
      step('waitFrame', '', '等待发布表单框架', {
        frame: 'iframe[src*="micro/content/post/create"]',
        timeout: 30_000,
      }),
    ]),
  checkSession: async (page) => {
    if (/login|passport/i.test(page.url())) return { status: 'expired', message: '登录已失效' }
    // 表单在 iframe 内，主文档看不到上传框；框架存在即认为可用
    const frame = page.frames().find((f) => f.url().includes('micro/content/post/create'))
    return frame
      ? { status: 'connected', message: '会话有效' }
      : { status: 'unknown', message: '没有找到发布表单框架' }
  },
  uploadVideo: async (page, ctx) =>
    runSteps(page, [
      step('setInputFiles', 'input[type="file"]', '上传视频', {
        frame: 'iframe[src*="micro/content/post/create"]',
        value: () => ctx.videoPath,
        timeout: 30_000,
      }),
      // 上传完成会刷新表单：等短标题输入可用后再填文案
      step('wait', 'input[placeholder*="短标题"]', '等待上传完成', {
        frame: 'iframe[src*="micro/content/post/create"]',
        timeout: ctx.uploadTimeoutMs ?? 10 * 60_000,
      }),
    ]),
  fillMetadata: async (page, ctx) =>
    runSteps(page, [
      step('fill', 'input[placeholder*="短标题"]', '填写短标题', {
        frame: 'iframe[src*="micro/content/post/create"]',
        value: () => ctx.title,
      }),
      step('fill', 'div.input-editor', '填写描述', {
        frame: 'iframe[src*="micro/content/post/create"]',
        value: () => ctx.description,
      }),
    ]),
  saveDraft: async (page) =>
    runSteps(page, [
      step('click', 'button', '保存草稿', { frame: 'iframe[src*="micro/content/post/create"]', hasText: '保存草稿' }),
    ]),
  submitFinal: async (page) =>
    runSteps(page, [step('click', 'button', '发表', { frame: 'iframe[src*="micro/content/post/create"]', hasText: '发表' })]),
  readStatus: async (page) => ({ status: 'submitted', url: page.url() }),
}

const REGISTRY = new Map()

/**
 * 注册适配器：缺方法或 platform 与已注册平台不一致直接拒绝。
 * 未 verified 的适配器只能跑草稿；manualOnly 完全不进自动队列。
 */
export function registerAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('适配器为空')
  if (!adapter.platform) throw new Error('适配器缺少 platform')
  for (const m of ADAPTER_METHODS) {
    if (typeof adapter[m] !== 'function') throw new Error(`适配器缺少方法：${m}`)
  }
  const coverSupport = adapter.coverSupport == null ? DEFAULT_COVER_SUPPORT : String(adapter.coverSupport)
  if (!COVER_SUPPORT.includes(coverSupport)) {
    throw new Error(`适配器 coverSupport 非法：${coverSupport}（应为 ${COVER_SUPPORT.join(' / ')}）`)
  }
  REGISTRY.set(adapter.platform, {
    platform: adapter.platform,
    verified: Boolean(adapter.verified),
    manualOnly: Boolean(adapter.manualOnly),
    coverSupport,
    openBackend: adapter.openBackend,
    checkSession: adapter.checkSession,
    uploadVideo: adapter.uploadVideo,
    fillMetadata: adapter.fillMetadata,
    uploadCover: typeof adapter.uploadCover === 'function' ? adapter.uploadCover : null,
    saveDraft: adapter.saveDraft,
    submitFinal: adapter.submitFinal,
    readStatus: adapter.readStatus,
  })
  return REGISTRY.get(adapter.platform)
}

export function getAdapter(platformId) {
  return REGISTRY.get(String(platformId || '')) || null
}

/** 该适配器能否真正把封面上传到平台：必须声明 supported 且实现了 uploadCover */
export function adapterCanAttachCover(platformId) {
  const a = getAdapter(platformId)
  return Boolean(a && a.coverSupport === 'supported' && typeof a.uploadCover === 'function')
}

export function listAdapters() {
  return [...REGISTRY.values()].map((a) => ({
    platform: a.platform,
    verified: a.verified,
    manualOnly: a.manualOnly,
    coverSupport: a.coverSupport,
  }))
}

/**
 * 自动执行是否允许：
 * - manualOnly：完全不进自动队列；
 * - 未 verified：只允许跑草稿（上传 + 填文案 + 存草稿），不允许点最终发布；
 * - verified：草稿与最终发布都允许（最终发布仍需用户显式确认）。
 */
export function adapterCanExecute(platformId, mode = 'draft') {
  const a = getAdapter(platformId)
  if (!a || a.manualOnly) return false
  if (a.verified) return true
  return mode === 'draft'
}

/** 最终发布是否允许：必须 verified 且不是 manualOnly */
export function adapterCanPublishFinal(platformId) {
  const a = getAdapter(platformId)
  return Boolean(a && a.verified && !a.manualOnly)
}

export function resetAdaptersForTest() {
  REGISTRY.clear()
}

registerAdapter(DOUYIN_ADAPTER)
registerAdapter(BILIBILI_ADAPTER)
registerAdapter(TOUTIAO_ADAPTER)
registerAdapter(XIGUA_ADAPTER)
registerAdapter(XIAOHONGSHU_ADAPTER)
registerAdapter(KUAISHOU_ADAPTER)
registerAdapter(WECHAT_CHANNELS_ADAPTER)
