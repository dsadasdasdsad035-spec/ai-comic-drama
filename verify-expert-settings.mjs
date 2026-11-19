/**
 * 设置 → 创意专家：面板能真正管理专家，而不是一句说明文字。
 *
 * 覆盖：
 * 1. 入口渲染出专家卡片列表（内置 + 自定义）
 * 2. 内置专家只读，改东西只能「另存为自定义」
 * 3. 工具 Tab 把 list_experts 显示成锁定行；list_installed_skills 归在「技能」组里可勾选
 * 4. 另存为自定义并保存后，新 id 真的出现在 GET /api/experts
 * 5. 保存自定义不会改到内置定义
 *
 * 跑法：node verify-expert-settings.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { openProject } from './verify-lib.mjs'

const ROOT = process.cwd()
const PORT = 5327
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-expert-settings-'))
const NAME = `expert-ui-${Date.now()}`

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
    /* 等 dev server */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

const readExperts = async () => {
  const r = await fetch(`${APP}/api/experts`)
  const j = await r.json().catch(() => ({}))
  return Array.isArray(j.experts) ? j.experts : []
}

const before = await readExperts()
const builtinBefore = before.find((e) => e.id === 'expert-omni')
if (!builtinBefore) {
  console.error('❌ 找不到内置专家 expert-omni，跳过（检查 experts/ 目录）')
  child.kill()
  process.exit(1)
}
const customBefore = before.filter((e) => e.source === 'custom')

await fetch(`${APP}/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '专家面板验收', shots: [] }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
let createdId = ''
try {
  const page = await browser.newPage()
  await openProject(page, NAME, 'settings', { base: APP })

  await page.getByRole('button', { name: '智能与扩展', exact: true }).click()
  await page.getByRole('tab', { name: '创意专家', exact: true }).click()
  const root = page.locator('[data-settings-experts]')
  await root.waitFor({ state: 'visible', timeout: 15000 })

  const cards = root.locator('.expert-market-card')
  await cards.first().waitFor({ state: 'visible', timeout: 15000 })
  check('设置页渲染出专家卡片列表', (await cards.count()) >= 1, `卡片 ${await cards.count()} 个`)
  check('不再显示「去创意宿主设置里管理专家」的说明文字', !(await root.innerText()).includes('创意宿主设置'))

  const omniCard = root.locator('.expert-market-card').filter({ hasText: 'expert-omni' }).first()
  await omniCard.locator('.expert-market-card-main').click()
  const modal = page.locator('[role="dialog"]')
  await modal.waitFor({ state: 'visible', timeout: 10000 })
  const modalText = await modal.innerText()
  check('内置专家标注为只读', modalText.includes('内置（只读）'), modalText.split('\n')[1] || '')
  const foot = modal.locator('.st-modal-foot')
  check(
    '内置专家底部只有「编辑（另存为自定义）」，没有直接保存',
    (await foot.getByRole('button', { name: /另存为自定义/ }).count()) === 1 &&
      (await foot.getByRole('button', { name: '保存', exact: true }).count()) === 0,
  )

  await modal.getByRole('tab', { name: '工具', exact: true }).click()
  const locked = modal.locator('[data-expert-tool-locked="list_experts"]')
  check('list_experts 显示为锁定行', (await locked.count()) === 1)
  check('list_experts 复选框不可勾选', (await locked.locator('input[type="checkbox"]').isDisabled()) === true)
  const skillGroup = modal.locator('fieldset').filter({ hasText: '技能' }).first()
  check('list_installed_skills 在「技能」组里可勾选', (await skillGroup.count()) === 1)
  const skillDirBox = skillGroup.locator('label').filter({ hasText: 'list_installed_skills' }).locator('input')
  check('list_installed_skills 未被锁定', (await skillDirBox.count()) === 1 && !(await skillDirBox.first().isDisabled()))

  // 另存为自定义 → 改 id → 保存
  await modal.getByRole('button', { name: /另存为自定义/ }).click()
  await modal.getByRole('tab', { name: '概览', exact: true }).click()
  createdId = `expert-omni-ui-${Date.now().toString(36)}`
  const idInput = modal.locator('.st-field input').first()
  await idInput.fill(createdId)
  await modal.getByRole('button', { name: '保存', exact: true }).click()

  let saved = false
  for (let i = 0; i < 40; i++) {
    const list = await readExperts()
    if (list.some((e) => e.id === createdId)) {
      saved = true
      break
    }
    await page.waitForTimeout(300)
  }
  check('另存为自定义并保存后新 id 出现在 GET /api/experts', saved, createdId)

  const after = await readExperts()
  const builtinAfter = after.find((e) => e.id === 'expert-omni')
  check(
    '保存自定义后内置定义未变',
    Boolean(builtinAfter) &&
      builtinAfter.soul === builtinBefore.soul &&
      JSON.stringify(builtinAfter.toolIds) === JSON.stringify(builtinBefore.toolIds) &&
      JSON.stringify(builtinAfter.skillIds) === JSON.stringify(builtinBefore.skillIds),
  )
  check('新专家标记为 custom', after.find((e) => e.id === createdId)?.source === 'custom')
} finally {
  await browser.close()
  // 收尾：只删掉本次新建的自定义专家，别动用户原有数据
  if (createdId) {
    try {
      const rest = (await readExperts()).filter((e) => e.source === 'custom' && e.id !== createdId)
      await fetch(`${APP}/api/experts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experts: rest.map(({ id, name, description, soul, skillIds, toolIds }) => ({
            id,
            name,
            description,
            soul,
            skillIds,
            toolIds,
          })),
        }),
      })
    } catch {
      /* 清理失败不影响结论 */
    }
  }
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
  void customBefore
}

console.log(bad ? `\n${bad} 项未通过` : '\n专家设置面板验收全部通过')
process.exit(bad ? 1 : 0)
