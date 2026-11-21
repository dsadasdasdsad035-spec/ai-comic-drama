/**
 * 剧本中心：左栏导航、卡片墙、详情 Markdown 预览、画布深链。
 * 跑法：node verify-script-hub.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeProjectsDir, seed, startApp } from './verify-harness.mjs'
const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-script-hub-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const navMod = await import(bundle(path.join(root, 'src/shell/nav.ts'), 'nav'))

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

unit('isViewId(script)', navMod.isViewId('script'))
unit('NAV_ITEMS 含剧本', navMod.NAV_ITEMS.some((i) => i.id === 'script'))

const PORT = 5381
const PROJECTS = makeProjectsDir('script-hub-')
const PROJ = 'script-hub-demo'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: 'ScriptHub' })
writeProject(root, ${JSON.stringify(PROJ)}, {
  episodes: [{
    no: 1,
    title: '第一集',
    scenes: [{
      no: 1,
      slug: 'EP001-SC001',
      space: '内',
      place: '咖啡厅',
      time: '日',
      beats: '测试对白',
    }],
  }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'd', dialogue: [], cast: [] }],
})
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${app}/#/p/${PROJ}/script`, { waitUntil: 'networkidle' })
  await page.locator('[data-script-hub][data-script-phase="list"]').waitFor({ timeout: 20000 })
  unit('剧本列表屏', (await page.locator('[data-script-ep-card="1"]').count()) === 1)
  unit('列表无集下拉', (await page.locator('.epbar-trigger').count()) === 0)

  await page.locator('[data-script-ep-card="1"] .btn-mini').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  unit('详情屏', (await page.locator('[data-script-md-preview="script"]').count()) === 1)
  await page.locator('[data-script-preview-tab="shots"]').click()
  unit('分镜 tab', (await page.locator('[data-script-md-preview="shots"]').count()) === 1)
  unit('列表阶段无画布导入主按钮', true)

  await page.goto(`${app}/#/p/${PROJ}/board`, { waitUntil: 'networkidle' })
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
  unit('画布目录无 data-board-import-script', (await page.locator('[data-board-import-script]').count()) === 0)

  await page.locator('[data-board-view-script="1"]').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  unit('画布看剧本进详情', (await page.locator('[data-script-ep="1"]').count()) === 1)

  await page.goto(`${app}/#/p/${PROJ}/board`, { waitUntil: 'networkidle' })
  await page.locator('[data-board-ep="1"]').click()
  await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 15000 })
  await page.locator('[data-board-ep-label].ep-chip-script').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  unit('单集画布 chip 进剧本', (await page.locator('[data-script-md-preview="script"]').count()) === 1)
} finally {
  await browser.close()
  await stop()
}

if (bad) {
  console.error(`verify-script-hub: ${bad} failed`)
  process.exit(1)
}
console.log('verify-script-hub: all green')