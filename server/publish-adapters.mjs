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

/** 声明式步骤：sel 是选择器，missing 时按 selectors_changed 处理 */
function step(kind, sel, label, extra = {}) {
  return { kind, sel, label, ...extra }
}

/**
 * 定位元素：需要文案匹配时用 locator(sel, { hasText })。
 * 不用 CSS 的 :has-text()——当前 playwright-core 的 waitForSelector 不解析它，
 * 会静默等到超时（实测踩到）。
 */
function locate(page, s) {
  if (s.hasText) return page.locator(s.sel || 'button', { hasText: s.hasText }).first()
  return page.locator(s.sel).first()
}

/**
 * 通用执行器：按步骤表操作页面。
 * 每一步先等选择器；超时即判定页面结构变化，而不是继续点下一步。
 */
export async function runSteps(page, steps, ctx = {}) {
  const done = []
  for (const s of steps) {
    try {
      if (s.kind === 'goto') {
        await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
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
        await page.waitForSelector(s.sel, { timeout: s.timeout ?? 15_000 })
        const value = typeof s.value === 'function' ? s.value(ctx) : s.value
        await page.setInputFiles(s.sel, value)
      } else if (s.kind === 'waitForFunction') {
        await page.waitForFunction(s.script, ctx, { timeout: s.timeout ?? 120_000 })
      } else if (s.kind === 'captchaCheck') {
        const found = await page.$(s.sel).catch(() => null)
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
      err.code = /Timeout|waiting for selector|strict mode/i.test(String(e?.message || ''))
        ? 'selectors_changed'
        : 'adapter_error'
      err.stage = s.label
      err.detail = String(e?.message || e)
      throw err
    }
  }
  return done
}

/** 抖音：上传页 → 标题/简介 → 封面 → 保存草稿；终发布不在自动路径里 */
export const DOUYIN_ADAPTER = {
  platform: 'douyin',
  verified: false,
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

/** B站：上传页 → 分区/标签/封面 → 存草稿 */
export const BILIBILI_ADAPTER = {
  platform: 'bilibili',
  verified: false,
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
  REGISTRY.set(adapter.platform, {
    platform: adapter.platform,
    verified: Boolean(adapter.verified),
    manualOnly: Boolean(adapter.manualOnly),
    openBackend: adapter.openBackend,
    checkSession: adapter.checkSession,
    uploadVideo: adapter.uploadVideo,
    fillMetadata: adapter.fillMetadata,
    saveDraft: adapter.saveDraft,
    submitFinal: adapter.submitFinal,
    readStatus: adapter.readStatus,
  })
  return REGISTRY.get(adapter.platform)
}

export function getAdapter(platformId) {
  return REGISTRY.get(String(platformId || '')) || null
}

export function listAdapters() {
  return [...REGISTRY.values()].map((a) => ({
    platform: a.platform,
    verified: a.verified,
    manualOnly: a.manualOnly,
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
