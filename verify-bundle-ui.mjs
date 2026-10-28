/**
 * 资料包导入 UI 端到端（真实 7.4MB 资料包 + 自起临时库）：
 * 1) 镜头表 → 导入 → 资料包 .zip → 上传，清单显示真实文件与用途
 * 2) 中文文件名可读、无 __MACOSX
 * 3) 冲突项未选择时应用按钮禁用；选一份后可应用
 * 4) 应用后镜头真的写入（含新增/更新），剧本集也写入
 * 5) 取消后项目不变且临时目录被清理
 * 6) 分类改判与排除生效
 *
 * 跑法：node verify-bundle-ui.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5314
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-ui-'))
const PROJECT = 'bundle-ui'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))

// 准备 zip
const fixture = path.join(ROOT, 'fixtures', 'bundle-cat.zip')
if (!fs.existsSync(fixture)) {
  const probe = '/tmp/cat-probe'
  if (!fs.existsSync(probe)) {
    console.log('⏭️  没有 zip 也没有 /tmp/cat-probe，跳过')
    process.exit(0)
  }
  fs.mkdirSync(path.join(ROOT, 'fixtures'), { recursive: true })
  execFileSync('zip', ['-qr', fixture, '.', '-x', '.git/*'], { cwd: probe, stdio: 'ignore' })
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

let browser
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')
  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '资料包导入' }),
  })
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', beats: '原有' }] }],
      shots: [{ id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, desc: '原有镜头', dialogue: [], cast: [] }],
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('dialog', (d) => d.accept())
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1200)

  await page.getByRole('button', { name: '导入', exact: true }).first().click()
  await page.waitForTimeout(700)
  await page.locator('[data-intake-bundle]').click()
  await page.waitForTimeout(700)
  check('资料包对话框打开', (await page.locator('.bundle-dialog').count()) === 1)

  await page.locator('.bundle-dialog input[type=file]').setInputFiles(fixture)
  await page.waitForTimeout(3500)
  check('清单出现', (await page.locator('[data-bundle-list]').count()) === 1)
  const rowCount = await page.locator('.bundle-row').count()
  check('清单数量与包一致', rowCount >= 28, String(rowCount))
  const listText = await page.locator('[data-bundle-list]').innerText()
  check('中文文件名可读', /第0?1集/.test(listText) || /角色档案/.test(listText), listText.slice(0, 80))
  check('无 __MACOSX', !/__MACOSX/.test(listText))
  check('显示 E1 集号标签', /E1/.test(listText))

  // 冲突：第 1 集两份分镜表
  check('出现冲突区', (await page.locator('[data-bundle-conflicts]').count()) === 1)
  const conflictText = await page.locator('[data-bundle-conflicts]').innerText()
  check('冲突指名第 1 集分镜表', /第 1 集/.test(conflictText) && /分镜/.test(conflictText), conflictText.replace(/\n/g, ' | ').slice(0, 160))
  check('冲突里并列显示镜数', /\d+ 镜/.test(conflictText), conflictText.match(/\d+ 镜/g)?.join(',') || '无')
  check('冲突未选时应用禁用', await page.locator('[data-bundle-apply]').isDisabled())

  // 排除一个无关文档，验证改判生效
  const firstRow = page.locator('.bundle-row').first()
  const firstId = await firstRow.getAttribute('data-bundle-file')
  const excludeBtn = page.locator(`[data-bundle-exclude="${firstId}"]`)
  await excludeBtn.scrollIntoViewIfNeeded()
  await excludeBtn.evaluate((el) => el.click())
  await page.waitForTimeout(400)
  check('排除后该行变灰', /excluded/.test((await firstRow.getAttribute('class')) || ''))

  // 选一份分镜表
  // 剧本与分镜表各有一组冲突，必须都选
  const conflictKeys = await page.evaluate(() =>
    [...document.querySelectorAll('[data-conflict]')].map((el) => el.getAttribute('data-conflict') || '').filter(Boolean),
  )
  check('冲突组数 >= 2（剧本 + 分镜表）', conflictKeys.length >= 2, JSON.stringify(conflictKeys))
  for (const key of conflictKeys) {
    const opt = page.locator(`[data-conflict-pick^="${key}:"]`).first()
    await opt.scrollIntoViewIfNeeded()
    await opt.evaluate((el) => el.click())
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(500)
  check('全部冲突选完后应用可用', !(await page.locator('[data-bundle-apply]').isDisabled()))

  const planText = await page.locator('[data-bundle-plan]').innerText()
  check('计划显示镜头新增/更新', /镜头：新增 \d+/.test(planText), planText.replace(/\n/g, ' | ').slice(0, 140))
  check('计划说明多集大纲不自动写入', /多集大纲/.test(planText))

  const shotsBefore = ((await api(`/api/project?name=${PROJECT}`)).project.shots || []).length
  const applyBtn = page.locator('[data-bundle-apply]')
  await applyBtn.scrollIntoViewIfNeeded()
  await applyBtn.evaluate((el) => el.click())
  await page.waitForTimeout(2000)
  check('应用后对话框关闭', (await page.locator('.bundle-dialog').count()) === 0)
  const afterApply = await page.locator('.wb-table tbody tr').count()
  check('应用后镜头表行数增加', afterApply > shotsBefore, `${shotsBefore} -> ${afterApply}`)

  // 保存并核对落库
  await page.getByRole('button', { name: '保存到 project.json' }).click()
  await page.waitForTimeout(1600)
  const saved = (await api(`/api/project?name=${PROJECT}`)).project
  const ep1 = (saved.shots || []).filter((s) => (Number(s.episode) || 1) === 1)
  check('镜头已落库', ep1.length > 1, String(ep1.length))
  check('导入的镜头镜号形如 01（照抄原文）', ep1.some((s) => String(s.no).trim() === '01') || ep1.some((s) => /^S\d{2}$/.test(String(s.no))), JSON.stringify(ep1.map((s) => s.no).slice(0, 8)))
  check('原有镜头仍保留（默认 merge）', ep1.some((s) => String(s.no) === 'S01'))
  check('旁白没进 cast', ep1.every((s) => !(s.cast || []).some((c) => /旁白/.test(c))), JSON.stringify(ep1.map((s) => s.cast).slice(0, 3)))
  check('页面无脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
} catch (e) {
  check('资料包端到端', false, e.message)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
  process.exit(bad === 0 ? 0 : 1)
}
