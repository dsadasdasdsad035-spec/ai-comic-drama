/**
 * 技能包保真：市场/上传安装不丢 0 字节文件；缺文件的旧记录在 API 与界面上可见。
 *
 * 跑法：node verify-skill-package-fidelity.mjs
 *
 * 两种情况都属于「看起来一切正常」：
 * - 空文件被解压跳过，磁盘结构与 zip 不一致，而规格要求完全一致；
 * - 修复前装的记录只有正文、没有安装目录，回执与「本包本来没附件」完全一样。
 * 因此这里必须打真实服务与真实页面，不能只测纯函数。
 */
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5377
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fidelity-verify-'))
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fidelity-state-'))
const PROJECT = `fidelity-${Date.now()}`
/** 只有一个安装记录、没有安装目录的旧技能 */
const LEGACY_ID = 'legacy-no-files'
/** 纯文本上装：目录存在、附件为 0，不得被误报 */
const TEXT_ID = 'text-only-skill'
/** 含 0 字节文件的 zip 包 */
const EMPTY_ID = 'empty-files-skill'
/** 市场安装：同样带 0 字节文件，走 /api/skillhub/install 全链路 */
const HUB_ID = 'hub-empty-files'
const HUB_NS = 'fidelity-ns'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 递归列出目录内相对路径（文件，不含目录条目）；目录不存在返回空数组 */
function listFiles(dir, pre = '') {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = pre ? `${pre}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}

/** 市场包夹具：4 个文件里有 2 个 0 字节 */
const HUB_ZIP_ENTRIES = [
  'SKILL.md',
  'references/guide.md',
  'references/.keep',
  'scripts/__init__.py',
]
const hubZip = Buffer.from(
  zipSync({
    'SKILL.md': strToU8(`---\nname: ${HUB_ID}\ndescription: 市场包含空文件\n---\n正文\n`),
    'references/guide.md': strToU8('# 指南\n内容\n'),
    'references/.keep': new Uint8Array(0),
    'scripts/__init__.py': new Uint8Array(0),
  }),
)

const mockHub = createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  const json = (body) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (u.pathname === `/api/v1/skills/${HUB_ID}`) {
    return json({
      skill: { slug: HUB_ID, displayName: '保真市场包' },
      namespace: { handle: HUB_NS },
      latestVersion: { version: '1.0.0' },
    })
  }
  if (u.pathname === '/api/v1/download') {
    res.setHeader('Content-Type', 'application/zip')
    return res.end(hubZip)
  }
  if (u.pathname === '/api/skills') return json({ code: 0, data: { skills: [], total: 0 } })
  if (u.pathname === '/api/v1/categories') return json({ items: [{ key: 'other', name: '其他', active: true }] })
  res.statusCode = 404
  res.end('not found')
})
await new Promise((resolve) => mockHub.listen(0, '127.0.0.1', resolve))
const hubBase = `http://127.0.0.1:${mockHub.address().port}`

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// ---- 种一条「只有记录、没有目录」的旧安装记录 ----
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject, dbPath, upsertSkillInstall } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
const root = ${JSON.stringify(TMP)}
dbPath(root)
upsertSkillInstall({
  id: ${JSON.stringify(LEGACY_ID)},
  provider: 'skillhub',
  slug: 'legacy-no-files',
  namespace: 'demo',
  version: '1.0.0',
  text: '---\\nname: ${LEGACY_ID}\\ndescription: 只有正文的旧记录\\n---\\n正文\\n',
  meta: { name: '旧记录', fileCount: 0 },
})
createProject(root, ${JSON.stringify(PROJECT)}, { title: '保真验收' })
writeProject(root, ${JSON.stringify(PROJECT)}, { source: '验收', episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }], shots: [] })
console.log('ok')
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP } })

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP, SB_STATE_ROOT: STATE, SKILLHUB_BASE_URL: hubBase }, stdio: 'ignore' },
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
try {  // ---- 1. 旧记录：目录不在，回执必须标明 ----
  const list1 = await (await fetch(`${APP}/api/skills`)).json()
  const legacy = (list1.skills || []).find((s) => s.id === LEGACY_ID)
  check('旧记录出现在技能列表', Boolean(legacy), LEGACY_ID)
  check('旧记录带 filesMissing', legacy?.filesMissing === true, String(legacy?.filesMissing))
  check('旧记录附件数为 0', (legacy?.attachments || []).length === 0)

  const detail1 = await (await fetch(`${APP}/api/skills/${LEGACY_ID}`)).json()
  check('详情回执同样带 filesMissing', detail1.skill?.filesMissing === true)

  const builtin = (list1.skills || []).find((s) => s.id === 'byted-sol-seedance-prompt')
  check('内置技能不带 filesMissing', builtin?.filesMissing === undefined, String(builtin?.filesMissing))

  // ---- 2. 纯文本上装：目录存在、附件 0，不得误报 ----
  const textRes = await fetch(`${APP}/api/skills/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: `---\nname: ${TEXT_ID}\ndescription: 纯文本上装\n---\n正文\n`,
  })
  const textJson = await textRes.json()
  check('纯文本上装成功', textJson.ok === true, textJson.message || '')
  const list2 = await (await fetch(`${APP}/api/skills`)).json()
  const textRow = (list2.skills || []).find((s) => s.id === TEXT_ID)
  check('纯文本包不带 filesMissing', textRow?.filesMissing === undefined, String(textRow?.filesMissing))
  check('纯文本包附件数为 0', (textRow?.attachments || []).length === 0)

  // ---- 3. 含 0 字节文件的 zip：磁盘与 zip 一致 ----
  const emptyZip = zipSync({
    'SKILL.md': strToU8(`---\nname: ${EMPTY_ID}\ndescription: 含空文件\n---\n正文\n`),
    'references/guide.md': strToU8('# 指南\n'),
    'references/.keep': new Uint8Array(0),
    'scripts/__init__.py': new Uint8Array(0),
  })
  const upRes = await fetch(`${APP}/api/skills/upload-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: Buffer.from(emptyZip),
  })
  const upJson = await upRes.json()
  check('含空文件的 zip 安装成功', upJson.ok === true, upJson.message || '')

  const dir = path.join(STATE, 'installed-skills', EMPTY_ID)
  const onDisk = listFiles(dir)
  check('安装目录存在', fs.existsSync(dir), dir)
  check('磁盘文件数与 zip 条目一致', onDisk.length === 4, onDisk.join('、'))
  for (const p of ['references/.keep', 'scripts/__init__.py']) {
    const full = path.join(dir, p)
    check(`空文件落盘 ${p}`, fs.existsSync(full) && fs.statSync(full).size === 0)
  }

  const list3 = await (await fetch(`${APP}/api/skills`)).json()
  const emptyRow = (list3.skills || []).find((s) => s.id === EMPTY_ID)
  check(
    '空文件进附件清单',
    (emptyRow?.attachments || []).some((a) => a.path === 'references/.keep'),
    String(emptyRow?.fileCount),
  )
  check('空文件字节数为 0', (emptyRow?.attachments || []).find((a) => a.path === 'references/.keep')?.bytes === 0)
  check('正常安装不带 filesMissing', emptyRow?.filesMissing === undefined)

  const readBack = await (
    await fetch(`${APP}/api/skills/${EMPTY_ID}/files?path=${encodeURIComponent('references/.keep')}`)
  ).json()
  check('空文件可被读取', readBack.ok === true && readBack.text === '', JSON.stringify(readBack).slice(0, 160))

  // ---- 4. 市场安装全链路：磁盘文件数 == zip 条目数，附件数 == 条目数 - 1 ----
  const instRes = await fetch(`${APP}/api/skillhub/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: HUB_ID, namespace: HUB_NS, version: '1.0.0' }),
  })
  const instJson = await instRes.json()
  check('市场安装成功', instJson.ok === true && instJson.skill?.source === 'skillhub', instJson.message || '')
  check('市场安装写入 slug', instJson.skill?.skillhub?.slug === HUB_ID)
  const instAtts = (instJson.skill?.attachments || []).map((a) => a.path)
  check('市场安装保留空文件', instAtts.includes('references/.keep'), instAtts.join('、'))
  check('市场安装附件数等于条目数减一', instAtts.length === HUB_ZIP_ENTRIES.length - 1, String(instAtts.length))

  const hubDir = path.join(STATE, 'installed-skills', HUB_ID)
  const hubDisk = listFiles(hubDir)
  check(
    '市场安装磁盘文件数等于 zip 条目数',
    hubDisk.length === HUB_ZIP_ENTRIES.length,
    hubDisk.join('、'),
  )
  check('市场安装后不带 filesMissing', instJson.skill?.filesMissing === undefined)

  // ---- 5. 页面：详情里缺文件提示可见，且不冒充「无附加文件」 ----
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${APP}/#/p/${PROJECT}/settings`, { waitUntil: 'networkidle' })
  await page.locator('.st-nav').waitFor({ timeout: 20000 })
  await page.locator('.st-nav').getByText('智能与扩展', { exact: true }).click()
  const sub = page.locator('.st-subnav').getByRole('tab', { name: '技能' })
  if (await sub.count()) await sub.first().click()
  await page.locator('[data-skill-installed-catalog]').waitFor({ timeout: 20000 })

  await page.locator(`[data-skill="${LEGACY_ID}"]`).first().click()
  await page.getByRole('dialog').waitFor({ timeout: 15000 })
  const dialogText = await page.getByRole('dialog').innerText()
  check('详情显示缺文件提示', (await page.locator('[data-skill-files-missing]').count()) === 1)
  check('缺文件提示说明需重新安装', /重新安装/.test(dialogText))
  check('缺文件时不再显示「本包只有 SKILL.md」', (await page.locator('[data-skill-no-attachments]').count()) === 0)
  await page.getByRole('dialog').getByLabel('关闭').click()
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 })

  await page.locator(`[data-skill="${EMPTY_ID}"]`).first().click()
  await page.getByRole('dialog').waitFor({ timeout: 15000 })
  const emptyItems = await page.locator('[data-skill-attachments] li').count()
  check('空文件包详情列出附件条目', emptyItems >= 3, String(emptyItems))
  check('空文件包不显示缺文件提示', (await page.locator('[data-skill-files-missing]').count()) === 0)

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  mockHub.close()
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(STATE, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
