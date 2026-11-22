/**
 * 验收脚本共用入口。
 *
 * 大厅是应用的唯一启动页，`#/` 不再自动打开任何项目，所以旧脚本里
 * `page.goto('http://127.0.0.1:5273/')` 会停在项目大厅。
 * 这里把「拿第一个项目 + 落到指定视图」封装成一行，脚本只关心自己要验什么。
 *
 * 关键细节：项目列表必须在**页面里**读，不能在这里用 node fetch。
 * 大量脚本用 page.route 把 /api/project 换成了假数据，node 侧读到的会是真实库，
 * 于是拿到一个假项目列表里不存在的名字，应用按「项目不存在」直接回大厅。
 *
 * 约定：
 * - base 默认 127.0.0.1:5273，自起 dev server 的脚本用 opts.base 覆盖。
 * - 不传项目名时，默认取列表第一个（与旧版自动选中第一个项目同规则）。
 */
export const BASE = (process.env.APP_URL || process.env.SB_URL || 'http://127.0.0.1:5273').replace(/\/$/, '')

/**
 * 需要现成 dev server 的脚本入口：地址只从 `APP_URL` 取，不再各自硬编码默认端口。
 *
 * 没有设置或服务不可达时直接给一句可读提示并退出——否则脚本会连着抛一堆
 * ECONNREFUSED 栈，看起来像断言坏了，实际只是没人起服务。
 *
 * @returns {Promise<string>} 去掉尾部斜杠的地址
 */
export async function requireServer() {
  const raw = String(process.env.APP_URL || '').trim()
  if (!raw) {
    console.error('服务未启动：请设置 APP_URL（例如 APP_URL=http://127.0.0.1:5273 node verify-xxx.mjs）')
    process.exit(1)
  }
  const base = raw.replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    console.error(`服务未启动：${base} 无法访问（${(e && e.message) || e}）`)
    process.exit(1)
  }
  return base
}

/** 项目名放在 hash 的路径段里，中文/特殊字符必须编码 */
export function projectUrl(name, view = 'board', base = BASE) {
  return `${base.replace(/\/$/, '')}/#/p/${encodeURIComponent(name)}/${view}`
}

/** 在页面里读项目列表，这样被 page.route mock 的脚本也能拿到它自己的假项目 */
async function firstProjectName(page) {
  return page.evaluate(async () => {
    try {
      const r = await fetch('/api/project')
      const d = await r.json()
      return (d.projects || [])[0]?.name || ''
    } catch {
      return ''
    }
  })
}

/**
 * 打开指定项目的工作区。
 * @param {import('playwright-core').Page} page
 * @param {string} [name] 项目目录名，省略则用列表第一个
 * @param {'overview'|'creative'|'assets'|'board'|'settings'} [view]
 * @param {{ base?: string, waitUntil?: 'load'|'domcontentloaded'|'networkidle', timeout?: number }} [opts]
 */
export async function openProject(page, name, view = 'board', opts = {}) {
  const { base = BASE, waitUntil = 'networkidle', ...rest } = opts
  const root = base.replace(/\/$/, '')
  // 先落大厅：此时没有任何项目数据请求，mock 与真实后端都能正常响应
  await page.goto(`${root}/#/`, { waitUntil: 'domcontentloaded', ...rest })
  const target = name || (await firstProjectName(page))
  if (!target) throw new Error('没有项目：验收脚本需要至少一个项目')
  // 只改 hash，不再整页重载，避免把脚本挂好的 mock 状态冲掉
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#/p/${encodeURIComponent(target)}/${view}`)
  await page.locator('.rail').waitFor({ state: 'visible', timeout: 15000 })
  if (waitUntil === 'networkidle') await page.waitForLoadState('networkidle').catch(() => {})
  return target
}

/** 旧脚本的写法：不关心项目名，进第一个项目的画布 */
export async function openApp(page, opts = {}) {
  const { base = BASE, view = 'board', ...rest } = opts
  return openProject(page, undefined, view, { base, ...rest })
}

/**
 * 进画布的分镜视图。
 *
 * 画布页现在先出「分集目录」，点一集才进分镜画布（board-episode-picker），
 * 所以只 openProject 到 board 会停在选集页，拿不到 .wb-bar-detail 与分镜卡。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} [name] 项目目录名，省略则用列表第一个
 * @param {{ base?: string, episode?: number|string, waitUntil?: string, timeout?: number }} [opts]
 */
export async function openBoardEpisode(page, name, opts = {}) {
  const { episode, ...rest } = opts
  const target = await openProject(page, name, 'board', rest)
  const cards = page.locator('.board-ep-card')
  if (await cards.count()) {
    // 分集卡的属性是 data-board-ep-card（BoardEpisodeGrid 里定义的），
    // 旧写法 data-board-ep 匹配不到任何卡片，脚本会误报「没有第 N 集」
    const card = episode == null ? cards.first() : page.locator(`.board-ep-card[data-board-ep-card="${episode}"]`)
    if (!(await card.count())) throw new Error(`没有第 ${episode} 集：可选 ${await cards.count()} 集`)
    await card.click()
    await page.locator('.wb-bar-detail').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForLoadState('networkidle').catch(() => {})
  }
  return target
}

/** 素材页「角色」Tab（方案 A：左栏不再有独立角色视图） */
export async function openCharacterTab(page) {
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.locator('[data-asset-character-tab]').click()
}

/**
 * 在顶栏切换项目。
 *
 * 旧顶栏是 `<select class="topbar-project">`，新壳换成项目菜单（`[data-project-menu]`
 * + `[data-project-menu-panel]` + `[data-project-recent="<name>"]`），点击后由
 * `onOpenProject` 保持当前视图切项目，语义与旧版 selectOption 一致。
 *
 * 项目不在「最近 5 个」时菜单里没有条目，退回改 hash；此时视图按当前 hash 推断，
 * 也可用 opts.view 指定。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} name 项目目录名
 * @param {{ view?: string, timeout?: number }} [opts]
 */
export async function selectProject(page, name, opts = {}) {
  if (!name) throw new Error('selectProject 需要项目名')
  const timeout = opts.timeout ?? 15000
  const trigger = page.locator('[data-project-menu]').first()
  if (await trigger.count()) {
    await trigger.click()
    const panel = page.locator('[data-project-menu-panel]')
    try {
      await panel.waitFor({ state: 'visible', timeout: Math.min(timeout, 8000) })
      const item = page.locator(`[data-project-recent="${String(name).replace(/"/g, '\\"')}"]`).first()
      if (await item.count()) {
        await item.click()
        await panel.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
        return
      }
      await page.keyboard.press('Escape')
    } catch {
      /* 菜单没开出来就走下面的 hash 兜底 */
    }
  }
  const view =
    opts.view ||
    (() => {
      const m = /^#\/p\/[^/]+\/([^/?#]+)/.exec(new URL(page.url()).hash || '')
      return m ? m[1] : 'overview'
    })()
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#/p/${encodeURIComponent(name)}/${view}`)
  await page.waitForTimeout(400)
}
