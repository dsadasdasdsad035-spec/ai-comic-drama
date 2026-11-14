/**
 * 画布集目录两阶段：左栏先进目录、点集进 Flow、概览点集直达单集。
 * 跑法：node verify-board-episode-picker.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bep-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const coverMod = await import(bundle(path.join(root, 'src/board/episodeCover.ts'), 'episodeCover'))
const epOps = await import(bundle(path.join(root, 'src/board/episodeOps.ts'), 'episodeOps'))
const scriptPlan = await import(bundle(path.join(root, 'src/board/scriptIntake.ts'), 'scriptIntake'))

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shots = [
  { id: 'E01-S02', episode: 1, no: 'S02', keyframe: '/a.png', clip: '/v.mp4' },
  { id: 'E01-S01', episode: 1, no: 'S01', clip: '/v-only.mp4' },
  { id: 'E02-S01', episode: 2, no: 'S01', keyframe: '/c.png' },
]
const c1 = coverMod.resolveEpisodeCover(shots, 1)
unit('封面取排序后首条 keyframe', c1.kind === 'keyframe' && c1.src === '/a.png', `${c1.kind}:${c1.src}`)
const c2 = coverMod.resolveEpisodeCover(shots, 2)
unit('第二集取 keyframe', c2.kind === 'keyframe' && c2.src === '/c.png', `${c2.kind}:${c2.src}`)
const list = coverMod.listBoardEpisodes([{ no: 1, title: '一' }, { no: 2, title: '二' }], shots)
unit('listBoardEpisodes 集数', list.length === 2 && list[0].shotCount === 2 && list[1].shotCount === 1)
unit('nextEpisodeNo', epOps.nextEpisodeNo([{ no: 1 }, { no: 2 }], shots) === 3)
const planned = scriptPlan.planScriptImport([{ no: 1, title: '旧', scenes: [] }], [
  { no: 2, title: '新', scenes: [{ slug: 'a', place: 'p', time: 't', beats: 'b' }] },
])
unit('剧本导入合并', planned.added === 1 && planned.episodes.length === 2, String(planned.added))

const PORT = 5370
const PROJECTS = makeProjectsDir('board-ep-picker-')
const PROJ = 'bep-demo'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
const shot = (id, ep, no, kf) => ({ id, episode: ep, no, seconds: 3, desc: no, keyframe: kf, dialogue: [], cast: [] })
createProject(root, ${JSON.stringify(PROJ)}, { title: 'BEP' })
writeProject(root, ${JSON.stringify(PROJ)}, {
  episodes: [{ no: 1, title: '第一集' }, { no: 2, title: '第二集' }],
  shots: [
    shot('E01-S01', 1, 'S01', '/generated/a.png'),
    shot('E02-S01', 2, 'S01', '/generated/b.png'),
  ],
})
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${app}/#/p/${PROJ}/board`, { waitUntil: 'networkidle' })
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 20000 })
  unit('刷新/深链先进集目录', (await page.locator('.react-flow').count()) === 0)
  unit('顶栏无集下拉', (await page.locator('.epbar-trigger').count()) === 0)
  unit('目录屏无分镜聊天', (await page.locator('[data-shots-chat]').count()) === 0)

  await page.locator('[data-board-ep="1"]').click()
  await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 20000 })
  await page.locator('.react-flow').waitFor({ timeout: 20000 })
  const label = await page.locator('[data-board-ep-label]').innerText()
  unit('点卡进入单集画布', label.trim() === 'E01', label)
  unit('单集仍无顶栏集下拉', (await page.locator('.epbar-trigger').count()) === 0)

  await page.locator('.board-ep-back').click()
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
  unit('返回集列表', (await page.locator('.react-flow').count()) === 0)

  await page.evaluate((proj) => {
    window.location.hash = `#/p/${proj}/overview`
  }, PROJ)
  await page.locator('.ov').waitFor({ timeout: 15000 })
  await page.locator('[data-ov-ep="2"]').click()
  await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 20000 })
  await page.locator('.react-flow').waitFor({ timeout: 20000 })
  const label2 = await page.locator('[data-board-ep-label]').innerText()
  unit('概览点集直达 E02', label2.trim() === 'E02', label2)

  const boardBtn = page.locator('nav.viewtabs button[aria-label="画布"]')
  if ((await boardBtn.count()) > 0) {
    await boardBtn.click()
    await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
    unit('左栏再点画布回落目录', (await page.locator('.react-flow').count()) === 0)
  }
} catch (e) {
  console.error('❌ 验收异常', e)
  bad++
} finally {
  await browser.close()
  stop()
  fs.rmSync(outDir, { recursive: true, force: true })
}

if (bad) process.exit(1)
console.log('verify-board-episode-picker: 全部通过')
