/**
 * 设置页技能编辑器：六技能列出、正文编辑、保存覆盖、恢复默认、锁定契约只读。
 * 跑法：node verify-skill-settings.mjs
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

  const openSettings = async () => {
    await page.goto(APP, { waitUntil: 'networkidle' })
    await page.getByTitle('大模型 / 技能 / 存储').click()
    await page.locator('.st-nav button', { hasText: '技能' }).click()
    await page.locator('[data-skill="script"]').waitFor({ timeout: 10000 })
  }

  await openSettings()
  const cards = page.locator('[data-skill]')
  check('设置页列出八个技能', (await cards.count()) === 8, String(await cards.count()))

  const scriptCard = page.locator('[data-skill="script"]')
  const sourceText = await scriptCard.locator('header .st-src').textContent()
  check('默认来源是内置', Boolean(sourceText?.includes('内置')), sourceText || '')

  const roleArea = scriptCard.locator('textarea').first()
  const before = await roleArea.inputValue()
  check('角色与约束显示内置正文', before.includes('你是短剧/漫剧的编剧与分集策划。'))

  await roleArea.fill(before + '\n（UI测试）')
  await scriptCard.getByRole('button', { name: '保存技能' }).click()
  await page.locator('.toast', { hasText: '已保存为用户覆盖' }).waitFor({ timeout: 10000 })
  check('保存覆盖成功', true)

  await openSettings()
  const scriptCard2 = page.locator('[data-skill="script"]')
  const sourceText2 = await scriptCard2.locator('header .st-src').textContent()
  check('重新打开显示用户覆盖', Boolean(sourceText2?.includes('用户覆盖')), sourceText2 || '')
  check('覆盖正文持久化', (await scriptCard2.locator('textarea').first().inputValue()).includes('（UI测试）'))

  await scriptCard2.getByRole('button', { name: '恢复默认' }).click()
  await page.locator('.toast', { hasText: '已恢复内置默认' }).waitFor({ timeout: 10000 })
  const sourceText3 = await page.locator('[data-skill="script"] header .st-src').textContent()
  check('恢复默认后来源变回内置', Boolean(sourceText3?.includes('内置')), sourceText3 || '')
  check(
    '恢复默认后正文回到内置',
    !(await page.locator('[data-skill="script"] textarea').first().inputValue()).includes('（UI测试）'),
  )

  const locked = page.locator('[data-skill="scene3d"] textarea.st-locked')
  check('scene3d 有锁定契约', (await locked.count()) === 1)
  const lockedValue = await locked.first().inputValue()
  check('锁定契约包含 ABI', lockedValue.includes('def build(ctx)'), lockedValue.slice(0, 40))
  check('锁定契约只读', await locked.first().evaluate((el) => el.readOnly))

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
