/**
 * 画布集号：id 不变式、项目级 epNo 存档、卡头集标。
 * 跑法：node verify-canvas-episode.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ep-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const rows = await import(bundle(path.join(root, 'src/shotRows.ts'), 'shotRows'))

const check = createCheck()
let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

unit('canonicalShotId E02-S03', rows.canonicalShotId(2, 'S03') === 'E02-S03')
unit('episodeFromShotId', rows.episodeFromShotId('E02-S03') === 2)
unit('formatEpisodeLabel', rows.formatEpisodeLabel(2) === 'E02')
const drift = [
  { id: 'E01-S01', episode: 2, no: 'S01', seconds: 3, desc: '' },
  { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, desc: '', transition_out: { to: 'E01-S01' } },
]
const fixed = rows.reconcileProjectShots(drift)
unit('漂移 id 按 episode 修正', fixed.shots[0].id === 'E02-S01' && fixed.shots[1].id === 'E01-S02')
unit('转场 to 随 id 重映射', fixed.shots[1].transition_out?.to === 'E02-S01', fixed.shots[1].transition_out?.to)

const PORT = 5362
const PROJECTS = makeProjectsDir('canvas-episode-')
const PROJ_A = 'ep-proj-a'
const PROJ_B = 'ep-proj-b'
const DRIFT = 'ep-drift'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
const shot = (id, ep, no) => ({ id, episode: ep, no, seconds: 3, desc: no, dialogue: [], cast: [] })
createProject(root, ${JSON.stringify(PROJ_A)}, { title: 'A' })
writeProject(root, ${JSON.stringify(PROJ_A)}, { episodes: [{ no: 1 }, { no: 2 }], shots: [shot('E01-S01', 1, 'S01')] })
createProject(root, ${JSON.stringify(PROJ_B)}, { title: 'B' })
writeProject(root, ${JSON.stringify(PROJ_B)}, { episodes: [{ no: 1 }, { no: 2 }], shots: [shot('E01-S01', 1, 'S01')] })
createProject(root, ${JSON.stringify(DRIFT)}, { title: '漂移' })
writeProject(root, ${JSON.stringify(DRIFT)}, { episodes: [{ no: 1 }, { no: 2 }], shots: [shot('E01-S01', 2, 'S01')] })
console.log('{}')
`,
)

const canvasKey = (name) => `storyboard-canvas-v1:${encodeURIComponent(name)}`

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })

  await page.evaluate(
    ({ keyA, keyB }) => {
      localStorage.setItem(keyA, JSON.stringify({ nodes: [], edges: [], characters: [], epNo: 2 }))
      localStorage.setItem(keyB, JSON.stringify({ nodes: [], edges: [], characters: [], epNo: 1 }))
    },
    { keyA: canvasKey(PROJ_A), keyB: canvasKey(PROJ_B) },
  )

  const openBoardCanvas = async (name, ep) => {
    await page.evaluate((n) => {
      window.location.hash = `#/p/${n}/board`
    }, name)
    await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 20000 })
    await page.locator(`[data-board-ep="${ep}"]`).click()
    await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 20000 })
  }

  await openBoardCanvas(PROJ_A, 2)
  let label = await page.locator('[data-board-ep-label]').innerText()
  unit('项目 A 存档 epNo=2 进单集后显示 E02', label.trim() === 'E02', label)

  await openBoardCanvas(PROJ_B, 1)
  label = await page.locator('[data-board-ep-label]').innerText()
  unit('项目 B 存档 epNo=1', label.trim() === 'E01' && !label.includes('E02'), label)

  await page.evaluate(
    ({ name, key }) => {
      localStorage.setItem(key, JSON.stringify({ nodes: [], edges: [], characters: [], epNo: 2 }))
      window.location.hash = `#/p/${name}/board`
    },
    { name: DRIFT, key: canvasKey(DRIFT) },
  )
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 20000 })
  await page.locator('[data-board-ep="2"]').click()
  await page.locator('.shot-ep[title^="E02"]').waitFor({ timeout: 25000 })
  const epBadge = await page.locator('.shot-ep[title^="E02"]').first().innerText()
  unit('漂移镜头卡头显示 E02', epBadge.trim() === 'E02', epBadge)

  await page.waitForTimeout(1200)
  const shotsRes = await page.request.get(`${app}/api/project?name=${encodeURIComponent(DRIFT)}`)
  const pj = await shotsRes.json()
  const s0 = (pj.project?.shots || []).find((s) => String(s.no) === 'S01')
  unit('打开漂移项目后 id 已修正', s0?.id === 'E02-S01', s0?.id)
} catch (e) {
  console.error('❌ 验收异常', e)
  bad++
} finally {
  await browser.close()
  stop()
  fs.rmSync(outDir, { recursive: true, force: true })
}

if (bad) process.exit(1)
console.log('verify-canvas-episode: 全部通过')
