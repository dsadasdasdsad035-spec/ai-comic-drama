/**
 * 创意绑定项目验收：
 * 1) 未绑定旧会话可读、可打开，且读取不会回写数据库（只读时补字段）；
 * 2) 会话列表按项目过滤，未绑定会话进独立分组；打开后只读、禁用发送；
 * 3) 显式绑定后写入 project 并迁移到项目分组；
 * 4) 创意头部显示当前项目与集号；
 * 5) 没有项目时创意入口不可用（深链直接回大厅）。
 *
 * 跑法：node verify-creative-projects.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openProject } from './verify-lib.mjs'

const ROOT = process.cwd()
const PORT = 5351
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-projects-'))
const PROJECTS = path.join(TMP, 'projects')
const A = `creative-a-${Date.now()}`
const B = `creative-b-${Date.now()}`
const DB = path.join(PROJECTS, 'storyboard.sqlite')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// 端口占用直接失败：否则会连到上次崩溃留下的孤儿 dev server
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 预置两个项目 + 三种会话：绑定 A、绑定 B、未绑定旧会话
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
import { createSession } from ${JSON.stringify(path.join(ROOT, 'server', 'creative.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
const shot = { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜街口', keyframe_prompt: 'a man', video_prompt: 'push in' }
for (const name of [${JSON.stringify(A)}, ${JSON.stringify(B)}]) {
  createProject(root, name, { title: name })
  writeProject(root, name, { shots: [shot] })
}
const a = createSession(root, { title: '甲的会话', mode: 'plan', project: ${JSON.stringify(A)} })
const b = createSession(root, { title: '乙的会话', mode: 'plan', project: ${JSON.stringify(B)} })
const legacy = createSession(root, { title: '旧会话', mode: 'plan' })
console.log(JSON.stringify({ a: a.id, b: b.id, legacy: legacy.id }))
`,
)
const ids = JSON.parse(
  execFileSync(process.execPath, [seed], {
    cwd: ROOT,
    env: { ...process.env, SB_PROJECTS_DIR: PROJECTS },
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .pop(),
)

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

/** 直接读库：用来证明「读不写」——读取前后整行必须一致 */
const readRow = (id) => {
  const d = new DatabaseSync(DB)
  try {
    return d.prepare('SELECT * FROM creative_sessions WHERE id=?').get(id)
  } finally {
    d.close()
  }
}

// 配一个 mock 文本模型，避免聊天按钮因为缺模型而全部禁用，模糊了「未绑定只读」这条断言
const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-text'),
  { id: 'mock-text', label: 'Mock Text', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'mock-text'),
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock-text', model: 'mock-text' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text' }
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
let exitCode = 0
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // ---------- 1) 会话按项目过滤（接口层） ----------
  const listA = await api(`/api/creative/sessions?limit=50&project=${encodeURIComponent(A)}`)
  const listUnbound = await api('/api/creative/sessions?limit=50&project=')
  check(
    '项目 A 只返回自己的会话',
    (listA.sessions || []).every((s) => s.project === A) && (listA.sessions || []).some((s) => s.id === ids.a),
    JSON.stringify((listA.sessions || []).map((s) => s.title)),
  )
  check(
    '未绑定查询返回旧会话',
    (listUnbound.sessions || []).some((s) => s.id === ids.legacy),
    JSON.stringify((listUnbound.sessions || []).map((s) => s.title)),
  )

  // ---------- 2) 旧会话读取后仍可打开，且没有被回写 ----------
  const legacyBefore = readRow(ids.legacy)
  const detail = await api(`/api/creative/sessions/${ids.legacy}`)
  check('旧会话可被读取', detail.session?.id === ids.legacy, JSON.stringify(detail.session || {}))
  check('旧会话读取时补 schemaVersion', detail.session?.schemaVersion === 1, String(detail.session?.schemaVersion))
  const legacyAfter = readRow(ids.legacy)
  check(
    '读取不回写数据库',
    JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter),
    `${JSON.stringify(legacyBefore)} → ${JSON.stringify(legacyAfter)}`,
  )

  // ---------- 3) 进入项目 A 的创意视图 ----------
  await openProject(page, A, 'creative', { base: APP, waitUntil: 'domcontentloaded' })
  await page.locator('[data-creative-studio]').waitFor({ timeout: 20000 })
  await page.locator('[data-creative-sessions]').waitFor({ timeout: 20000 })

  const header = await page.locator('[data-creative-header]').innerText()
  const projectLine = await page.locator('[data-creative-project]').innerText()
  check('头部显示当前项目与集号', projectLine.includes(A) && projectLine.includes('第 1 集'), projectLine)
  check('头部上下文在可见头部内', header.includes(projectLine), header.slice(0, 160))

  // ---------- 4) 未绑定分组 + 只读 ----------
  const boundRows = await page.locator('[data-creative-session][data-unbound="false"]').count()
  check('项目会话在项目分组', boundRows >= 1, String(boundRows))
  check('未绑定分组出现', await page.locator('[data-creative-unbound-group]').isVisible())
  const unboundRow = page.locator(`[data-creative-session="${ids.legacy}"][data-unbound="true"]`)
  check('旧会话落在未绑定分组', (await unboundRow.count()) === 1)

  await unboundRow.locator('.creative-list-main').click()
  await page.locator('[data-creative-unbound]').waitFor({ timeout: 10000 })
  const unboundText = await page.locator('[data-creative-unbound]').innerText()
  check('未绑定会话提示绑定', unboundText.includes('未绑定') && unboundText.includes(A), unboundText.slice(0, 120))
  const composer = page.getByLabel('创意聊天输入')
  check('未绑定会话禁用发送', await composer.isDisabled())
  const hint = await page.locator('[data-creative-header]').innerText()
  check('未绑定状态不影响头部上下文', hint.includes(A), hint.slice(0, 80))

  // ---------- 5) 绑定后写入 project 并迁移分组 ----------
  await page.locator('[data-creative-action="bind-session"]').click()
  await page.locator('[data-creative-unbound]').waitFor({ state: 'detached', timeout: 10000 })
  check('绑定后提示消失', (await page.locator('[data-creative-unbound]').count()) === 0)
  await page.waitForFunction(
    (id) => document.querySelector(`[data-creative-session="${id}"]`)?.getAttribute('data-unbound') === 'false',
    ids.legacy,
    { timeout: 10000 },
  )
  check('绑定后会话移入项目分组', true)
  check('绑定后可以发送', !(await composer.isDisabled()))
  const boundDetail = await api(`/api/creative/sessions/${ids.legacy}`)
  check('绑定写入 project', boundDetail.session?.project === A, String(boundDetail.session?.project))
  const afterBind = await api('/api/creative/sessions?limit=50&project=')
  check(
    '绑定后不再出现在未绑定查询',
    !(afterBind.sessions || []).some((s) => s.id === ids.legacy),
    JSON.stringify((afterBind.sessions || []).map((s) => s.title)),
  )

  // ---------- 6) 切到项目 B：会话隔离 ----------
  await openProject(page, B, 'creative', { base: APP, waitUntil: 'domcontentloaded' })
  await page.locator('[data-creative-sessions]').waitFor({ timeout: 20000 })
  check('项目 B 看不到项目 A 的会话', (await page.locator(`[data-creative-session="${ids.a}"]`).count()) === 0)
  check('项目 B 看不到已绑定的原旧会话', (await page.locator(`[data-creative-session="${ids.legacy}"]`).count()) === 0)
  check('项目 B 没有未绑定分组', (await page.locator('[data-creative-unbound-group]').count()) === 0)
  check('项目 B 头部上下文正确', (await page.locator('[data-creative-project]').innerText()).includes(B))

  // ---------- 7) 无项目：创意入口不可用 ----------
  await page.goto(`${APP}/#/`, { waitUntil: 'domcontentloaded' })
  await page.locator('.hub').waitFor({ timeout: 20000 })
  check('大厅没有全局创意入口', (await page.locator('[data-creative-studio]').count()) === 0)
  await page.evaluate(() => {
    window.location.hash = '#/p/__不存在的项目__/creative'
  })
  await page.locator('.hub').waitFor({ timeout: 10000 })
  check('无此项目时深链回大厅', (await page.locator('[data-creative-studio]').count()) === 0)

  check('没有页面级报错', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.screenshot({ path: path.join(TMP, 'creative-projects.png') })
} catch (e) {
  console.error('❌ 验收脚本异常：', e)
  bad++
} finally {
  await browser.close()
  child.kill()
}

console.log(bad === 0 ? '\n全部通过' : `\n失败 ${bad} 项`)
exitCode = bad === 0 ? 0 : 1
process.exit(exitCode)
