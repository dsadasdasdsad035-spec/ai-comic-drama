/**
 * 旧「技能规则包」→ 技能覆盖迁移：只迁移自定义项、逐字保留、幂等。
 * 跑法：node verify-skill-migration.mjs
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

const CUSTOM = '自定义剧本守则XYZ：每集必须在结尾留反转。'
const settings = (await api('/api/settings')).settings
settings.rules = {
  ...(settings.rules || {}),
  script: { enabled: true, text: CUSTOM },
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
  const script = (list.skills || []).find((s) => s.id === 'script')
  const character = (list.skills || []).find((s) => s.id === 'character')
  check('自定义剧本规则生成覆盖', script?.source === 'override', script?.source)
  check('自定义文本逐字保留', String(script?.text || '').includes(CUSTOM))
  check('未自定义的角色技能不生成覆盖', character?.source === 'builtin', character?.source)

  // 再打开一次不应重复迁移或叠加文本
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const again = (await api('/api/skills')).skills.find((s) => s.id === 'script')
  const count = String(again?.text || '').split(CUSTOM).length - 1
  check('重复打开只保留一份自定义文本', count === 1, String(count))
  check('覆盖仍为 override', again?.source === 'override')

  const settingsAfter = (await api('/api/settings')).settings
  check('迁移标记保持 true', settingsAfter.skillsMigrated === true)
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
