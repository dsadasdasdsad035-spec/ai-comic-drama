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
export const BASE = (process.env.SB_URL || 'http://127.0.0.1:5273').replace(/\/$/, '')

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
 * @param {'overview'|'creative'|'chars'|'assets'|'board'|'settings'} [view]
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
