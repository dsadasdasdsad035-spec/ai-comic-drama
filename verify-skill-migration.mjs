/**
 * 旧「技能规则包」迁移的现状：迁移逻辑仍在，但目标技能已下线，因此只写标记、不生成任何覆盖，且幂等。
 * 跑法：node verify-skill-migration.mjs
 *
 * 历史背景：旧规则包（character / asset / shot / prompt）对应的工作台技能已随
 * 「收敛 Agent 聊天并移除发布台」下线，`planLegacySkillOverrides` 现在恒返回空。
 * 这条脚本从「迁移产出正确」改为「迁移不再产生半成品覆盖」——后者才是现在会回归的行为。
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5327
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-migration-'))
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
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

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

/** 旧规则包：故意写成「用户改过」的样子，触发迁移判断 */
const CUSTOM = '自定义剧本守则XYZ：每集必须在结尾留反转。'
const settings = (await api('/api/settings')).settings
settings.rules = {
  ...(settings.rules || {}),
  script: { enabled: true, text: CUSTOM },
  character: { enabled: true, text: '自定义角色守则XYZ' },
}
settings.skillsMigrated = false
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })

  let migrated = false
  for (let i = 0; i < 50; i++) {
    const s = (await api('/api/settings')).settings
    if (s.skillsMigrated) {
      migrated = true
      break
    }
    await page.waitForTimeout(400)
  }
  check('迁移标记写入', migrated)

  const list = await api('/api/skills')
  const overrides = (list.skills || []).filter((s) => s.source === 'override')
  check('已下线的旧技能不再生成覆盖', overrides.length === 0, overrides.map((s) => s.id).join(','))
  check('不存在退化的 legacy id', !(list.skills || []).some((s) => ['script', 'character', 'asset', 'shotlist', 'prompt'].includes(s.id)))

  const custom = (list.skills || []).find((s) => String(s.text || '').includes('自定义剧本守则XYZ'))
  check('自定义旧规则文本不混入技能正文', !custom, custom?.id)

  // 再打开一次不应重复迁移或叠加文本
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const again = await api('/api/skills')
  check(
    '重复打开仍无覆盖',
    (again.skills || []).filter((s) => s.source === 'override').length === 0,
  )
  const settingsAfter = (await api('/api/settings')).settings
  check('迁移标记保持 true', settingsAfter.skillsMigrated === true)
  check('用户旧规则文本仍保留在设置里', String(settingsAfter.rules?.script?.text || '').includes(CUSTOM))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
