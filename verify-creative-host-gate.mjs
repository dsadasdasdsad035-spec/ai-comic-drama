/**
 * 创意宿主门：内置 Agent 包必须能被创意会话发现并选中。
 *
 * 跑法：node verify-creative-host-gate.mjs
 *
 * 这条验收来自一次真实回归：技能包整包落盘后所有技能来源统一成内置，
 * 而宿主判定仍按「市场/上传」过滤，顶栏「偏好技能」从 19 项变成 0 项。
 * 之前只验了 /api/skills、设置页目录与附件读取，漏掉了创意页这个入口，
 * 所以这里必须断言真实页面：无专家时下拉里能看到内置包。
 */
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5371
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-host-gate-'))
const PROJECT = `host-gate-${Date.now()}`
/** 本次故障的技能 id：内置、agent-pack、带 references 附件 */
const BUILTIN_ID = 'byted-sol-seedance-prompt'
/** 白名单不含内置包的专家：用它验证「列表口径与可读集一致」 */
const RESTRICTED_EXPERT = 'expert-omni-custom'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
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

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  // ---- 1. 服务端事实：内置技能确实是 agent-pack，且带附件清单 ----
  const skillsRes = await (await fetch(`${APP}/api/skills`)).json()
  const rows = skillsRes.skills || []
  const builtinRow = rows.find((s) => s.id === BUILTIN_ID)
  check('服务端列出内置技能', Boolean(builtinRow), BUILTIN_ID)
  check('内置技能来源为 builtin', builtinRow?.source === 'builtin', String(builtinRow?.source))
  check(
    '内置技能带 references 附件',
    (builtinRow?.attachments || []).some((a) => String(a.path).startsWith('references/')),
    String((builtinRow?.attachments || []).length),
  )

  // ---- 2. 工具面：hostsOnly 与宿主候选集同一口径 ----
  const entry = path.join(TMP, 'entry.ts')
  fs.writeFileSync(
    entry,
    [
      `export { createPiNativeToolSet } from ${JSON.stringify(path.join(ROOT, 'src/agent/stageTools.ts'))}`,
      `export { groupCreativeHostSkills, listCreativeHostSkills } from ${JSON.stringify(path.join(ROOT, 'src/creative/creativeSkillHost.ts'))}`,
      `export { wrapSkillListForExpert } from ${JSON.stringify(path.join(ROOT, 'src/creative/expertTools.ts'))}`,
      `export { parseSkillRecords } from ${JSON.stringify(path.join(ROOT, 'src/skills/validate.ts'))}`,
    ].join('\n'),
  )
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'error',
    define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
  })
  // 浏览器 bundle 在 Node 里跑：把相对 /api 指到临时 dev server
  globalThis.location = { href: `${APP}/`, origin: APP, protocol: 'http:' }
  const nativeFetch = globalThis.fetch
  globalThis.fetch = (url, init) => {
    const u = String(url)
    if (u.startsWith('/')) return nativeFetch(`${APP}${u}`, init)
    return nativeFetch(url, init)
  }
  const lib = await import(
    'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
  )

  const listTool = lib.createPiNativeToolSet().byName.get('list_installed_skills')
  const hostsOnly = await listTool.run({ hostsOnly: true })
  const parsed = lib.parseSkillRecords(rows)
  const expectedHosts = lib.listCreativeHostSkills(parsed.skills.values()).map((s) => s.id)
  check(
    'hostsOnly 含内置技能',
    hostsOnly.skills.some((s) => s.id === BUILTIN_ID),
    String(hostsOnly.count),
  )
  check(
    'hostsOnly 与宿主候选集完全一致',
    JSON.stringify(hostsOnly.skills.map((s) => s.id).sort()) === JSON.stringify(expectedHosts.sort()),
    `工具 ${hostsOnly.count} / 候选 ${expectedHosts.length}`,
  )
  check('宿主候选集不为空（回归核心）', hostsOnly.count > 0, String(hostsOnly.count))

  const groups = lib.groupCreativeHostSkills(parsed.skills.values().filter((s) => expectedHosts.includes(s.id)))
  check('分组含「内置技能」', groups.some((g) => g.label === '内置技能'))
  check(
    '不存在空的「市场安装」组',
    groups.every((g) => g.options.length > 0),
    JSON.stringify(groups.map((g) => `${g.label}:${g.options.length}`)),
  )

  const expertRes = await (await fetch(`${APP}/api/experts`)).json()
  const restricted = (expertRes.experts || []).find((e) => e.id === RESTRICTED_EXPERT)
  check('受限专家存在', Boolean(restricted), RESTRICTED_EXPERT)
  const wrapped = lib.wrapSkillListForExpert(listTool, {
    name: restricted?.name || RESTRICTED_EXPERT,
    skillIds: restricted?.skillIds || [],
  })
  const limited = await wrapped.run({})
  check(
    '受限专家列表剔除内置技能',
    !limited.skills.some((s) => s.id === BUILTIN_ID),
    `可见 ${limited.count}`,
  )
  check('受限专家回执说明限制数量', /另有 \d+ 个技能/.test(String(limited.note || '')), String(limited.note || ''))

  // ---- 3. 页面：无专家时下拉能选到内置包 ----
  const made = await fetch(`${APP}/api/project?create=1&name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!made.ok) throw new Error(`建临时项目失败：HTTP ${made.status}`)

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${APP}/#/p/${PROJECT}/creative`, { waitUntil: 'load' })

  const expertSelect = page.locator('select[data-creative-expert]')
  await expertSelect.waitFor({ timeout: 20000 })
  // 会话可能记住了别的专家：先切回自动目录模式
  if ((await expertSelect.inputValue()) !== '') {
    await expertSelect.selectOption('')
  }

  const hostSelect = page.locator('select[data-creative-host-skill]')
  await hostSelect.waitFor({ timeout: 15000 })
  const optionIds = await hostSelect.evaluate((el) =>
    [...el.querySelectorAll('option')].map((o) => o.value).filter(Boolean),
  )
  check('宿主下拉包含内置技能', optionIds.includes(BUILTIN_ID), String(optionIds.length))
  check('宿主下拉非空', optionIds.length > 0, String(optionIds.length))

  const groupInfo = await hostSelect.evaluate((el) =>
    [...el.querySelectorAll('optgroup')].map((g) => ({ label: g.label, n: g.querySelectorAll('option').length })),
  )
  check('页面渲染「内置技能」分组', groupInfo.some((g) => g.label === '内置技能'))
  check('页面不渲染空分组', groupInfo.every((g) => g.n > 0), JSON.stringify(groupInfo))
  check(
    '默认停在「自动（技能目录）」',
    (await hostSelect.inputValue()) === '',
    await hostSelect.inputValue(),
  )

  const banner = await page.locator('[data-creative-header] p[role="status"]').allInnerTexts()
  check(
    '有宿主时不误报缺技能',
    !banner.some((t) => /技能目录为空|list_installed_skills 为空|尚未安装/.test(t)),
    JSON.stringify(banner),
  )

  // 选中内置技能后，下一轮载荷应把它作为偏好宿主（等价于 Pi 能读到它）
  await hostSelect.selectOption(BUILTIN_ID)
  await page.waitForTimeout(600)
  check('可选中内置技能作为宿主', (await hostSelect.inputValue()) === BUILTIN_ID)
  const stored = await page.evaluate(() => localStorage.getItem('creative.hostSkillId'))
  check('偏好写入本机存储', stored === BUILTIN_ID, String(stored))

  // ---- 4. 专家模式：偏好下拉隐藏（限制集中在专家白名单） ----
  await expertSelect.selectOption(RESTRICTED_EXPERT)
  await page.waitForTimeout(600)
  check('专家模式下隐藏偏好技能下拉', (await page.locator('select[data-creative-host-skill]').count()) === 0)

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
