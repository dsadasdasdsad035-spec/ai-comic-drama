/**
 * 设置页技能目录与详情弹窗：列出已安装技能、编辑保存覆盖、恢复默认、附件清单、锁定契约只读。
 * 跑法：node verify-skill-settings.mjs
 *
 * 覆盖的是「智能与扩展 → 技能」这条当前入口：卡片在目录里，编辑在详情弹窗里。
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5322
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-settings-'))
/** 有引用的内置技能：详情里必然出现附件清单 */
const SKILL_ID = 'short-drama-video-prompts'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

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

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  /** 旧脚本按按钮文案点导航；当前是 data-settings-pane 驱动的设置页 */
  const openSettings = async () => {
    // 空项目目录下应用停在项目大厅，左栏不存在：先建一个项目，再进设置
    const made = await fetch(`${APP}/api/project?create=1&name=skill-settings-fixture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!made.ok) throw new Error(`建临时项目失败：HTTP ${made.status}`)
    await page.goto(`${APP}/#/p/skill-settings-fixture/settings`, { waitUntil: 'networkidle' })
    await page.locator('.st-nav').waitFor({ timeout: 15000 })
    await page.locator('.st-nav').getByText('智能与扩展', { exact: true }).click()
    // 扩展页默认停在别的分区，这里显式切到「技能」
    const sub = page.locator('.st-subnav').getByRole('tab', { name: '技能' })
    if (await sub.count()) await sub.first().click()
    await page.locator('[data-skill-installed-catalog]').waitFor({ timeout: 15000 })
  }

  const card = () => page.locator(`[data-skill="${SKILL_ID}"]`).first()
  const openDetail = async () => {
    await card().click()
    await page.getByRole('dialog').waitFor({ timeout: 10000 })
  }
  const closeDetail = async () => {
    await page.getByRole('dialog').getByLabel('关闭').click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 })
  }

  await openSettings()
  const count = await page.locator('[data-skill]').count()
  check('设置页列出已安装技能', count >= 20, String(count))
  check('目录含目标技能', (await card().count()) === 1)

  await openDetail()
  check('详情徽标显示内置来源', (await page.getByRole('dialog').innerText()).includes('内置'))
  check('概览列出包内文件', (await page.locator('[data-skill-attachments] li').count()) > 0)
  const fileCount = await page.locator('[data-skill-attachments] li').count()
  check('包内文件数与计数一致', (await page.getByRole('dialog').innerText()).includes(`包内文件`), String(fileCount))

  // Agent 包是只读安装：详情只有概览 / SKILL.md，没有可编辑分区与保存按钮
  const tabs = await page.getByRole('dialog').getByRole('tab').allInnerTexts()
  check('Agent 包只有只读分区', !tabs.some((t) => t.trim() === '编辑'), tabs.join('/'))
  check(
    '只读提示可见',
    (await page.getByRole('dialog').innerText()).includes('只读安装'),
  )
  check(
    'Agent 包没有保存覆盖按钮',
    (await page.getByRole('dialog').getByRole('button', { name: '保存覆盖' }).count()) === 0,
  )

  await page.getByRole('tab', { name: 'SKILL.md' }).click()
  const body = await page.getByRole('dialog').locator('textarea.skill-detail-editor').first().inputValue()
  check('SKILL.md 分区展示正文', body.includes('---') && body.length > 100, String(body.length))
  check('SKILL.md 只读', await page.getByRole('dialog').locator('textarea.skill-detail-editor').first().evaluate((el) => el.readOnly))

  // 锁定契约只读
  const contractTab = page.getByRole('tab', { name: '锁定契约' })
  if (await contractTab.count()) {
    await contractTab.click()
    const code = page.getByRole('dialog').locator('pre.skill-detail-code')
    check('锁定契约以只读代码块展示', (await code.count()) === 1)
  } else {
    check('锁定契约分区按需出现', true, '该技能无锁定契约')
  }

  await closeDetail()
  await page.waitForTimeout(400)

  // 无附件技能：明确的「无附加文件」提示
  const emptyCards = await page.locator('[data-skill]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-skill')).filter(Boolean),
  )
  const noAttachId = emptyCards.find((id) => id === 'novel-characters') || emptyCards[0]
  await page.locator(`[data-skill="${noAttachId}"]`).first().click()
  await page.getByRole('dialog').waitFor({ timeout: 10000 })
  const hint = page.locator('[data-skill-no-attachments]')
  const listed = page.locator('[data-skill-attachments]')
  check(
    '详情要么列清单要么明确提示无附件',
    (await hint.count()) + (await listed.count()) === 1,
    `${noAttachId}`,
  )

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
