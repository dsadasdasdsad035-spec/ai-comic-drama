/**
 * 提示词案例库的布局回归：五个宽度下确认三件事。
 *
 * 1. 无横向滚动（390px 手机上素材页曾整块横滚）
 * 2. 打开详情不改变列表列数与卡片数——这是改版的核心约束：
 *    详情曾是列表内固定 460px 的一列，点一张卡就把画廊从 3 列压成 1 列
 * 3. 详情抽屉撑满视口高度、宽度不超视口
 *
 * 跑法：node verify-prompt-cases-layout.mjs
 * 依赖：随包 Node（desktop/bin/node，需 ≥24.9）+ 本机 Chrome。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const NODE = path.join(ROOT, 'desktop', 'bin', 'node')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pcl-w-'))
const PROJECT = 'demo'
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
import { saveCase, setCaseFacets } from ${JSON.stringify(path.join(ROOT, 'server', 'prompt-cases.mjs'))}
const root = ${JSON.stringify(TMP)}
createProject(root, ${JSON.stringify(PROJECT)}, { title: 'x' })
writeProject(root, ${JSON.stringify(PROJECT)}, { source: '', episodes: [], shots: [], characters: [], designs: [] })
for (let i = 1; i <= 10; i += 1) {
  const one = saveCase(root, { source: 'vflow', sourceId: 'w' + i, title: '案例标题第 ' + i + ' 条', prompt: 'prompt body ' + i, model: 'seedance-2-5' })
  setCaseFacets(root, one.id, [{ axis: 'genre', value: 'crime', source: 'import' }], { taxonomyVersion: '2026-11-23.2' })
}
console.log('ok')
`,
)
spawnSync(NODE, [seed], {
  cwd: ROOT,
  env: { ...process.env, SB_PROJECTS_DIR: TMP, SB_STATE_ROOT: path.join(TMP, 'state') },
})
const proc = spawn(NODE, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: TMP,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    SB_STUDIO_NO_PREWARM: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(log.slice(-500))), 90_000)
  proc.stdout.on('data', (c) => {
    log += c.toString()
    const m = log.match(/listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(t)
      res(Number(m[1]))
    }
  })
  proc.stderr.on('data', (c) => (log += c.toString()))
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
let bad = 0
const check = (n, c, extra = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${extra ? ` | ${extra}` : ''}`)
  if (!c) bad++
}
try {
  for (const w of [1600, 1280, 1100, 900, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } })
    await p.goto(`http://127.0.0.1:${port}/#/p/${PROJECT}/assets`, { waitUntil: 'domcontentloaded' })
    await p.waitForSelector('[data-prompt-case-tab]', { timeout: 20_000 })
    await p.click('[data-prompt-case-tab]')
    await p.waitForSelector('[data-prompt-case-card]', { timeout: 15_000 })
    await p.waitForTimeout(600)

    const before = await p.evaluate(() => {
      const grid = document.querySelector('[data-prompt-case-grid]')
      const cards = [...document.querySelectorAll('[data-prompt-case-card]')]
      const tops = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))
      return {
        columns: tops.size ? cards.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.min(...tops)).length : 0,
        cards: cards.length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      }
    })
    const cardsBefore = before.cards
    await p.locator('[data-prompt-case-card]').first().click()
    await p.waitForSelector('[data-prompt-case-detail]', { timeout: 10_000 })
    await p.waitForTimeout(500)
    const after = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-prompt-case-card]')]
      const tops = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))
      const detail = document.querySelector('[data-prompt-case-detail]').getBoundingClientRect()
      return {
        columns: tops.size ? cards.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.min(...tops)).length : 0,
        cards: cards.length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        detailWidth: Math.round(detail.width),
        detailHeight: Math.round(detail.height),
        viewportH: window.innerHeight,
      }
    })
    check(`${w}px 无横向滚动`, after.overflowX <= 0, `overflowX=${after.overflowX}`)
    check(`${w}px 打开详情列数不变`, before.gridCols === after.columns, `${before.gridCols} -> ${after.columns}`)
    check(`${w}px 卡片数不变`, cardsBefore === after.cards, `${cardsBefore} -> ${after.cards}`)
    check(`${w}px 抽屉撑满高度`, after.detailHeight === after.viewportH, `${after.detailHeight}/${after.viewportH}`)
    check(`${w}px 抽屉宽不超过视口`, after.detailWidth <= w, `${after.detailWidth}/${w}`)
    console.log(`   · ${w}px 列数=${before.gridCols} 卡片=${cardsBefore}`)
    await p.close()
  }
} finally {
  await b.close()
  proc.kill('SIGTERM')
  fs.rmSync(TMP, { recursive: true, force: true })
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 五宽度布局全部通过')
process.exit(bad ? 1 : 0)
