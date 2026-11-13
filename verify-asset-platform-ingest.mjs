/**
 * 素材页链接下载面板 + API 登记视频素材。
 * 跑法：node verify-asset-platform-ingest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import { ingestShot3dReference } from './server/shot3d-ingest.mjs'
import { resolveRoot, readProject, createProject } from './server/db.mjs'

const PORT = 5362
const check = createCheck()
const PROJECTS = makeProjectsDir('asset-ingest-')
const PROJ = `asset-ingest-${Date.now()}`

seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '素材摄取验收' })
console.log('{}')
`,
)

process.env.SB_PROJECTS_DIR = PROJECTS
const rootDir = resolveRoot(process.cwd())
const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })

const fixture = path.join(process.cwd(), 'fixtures/evidence-scene3d-chat-mp4/output.mp4')
check('fixture 存在', fs.existsSync(fixture))

const b64 = fs.readFileSync(fixture).toString('base64')
const result = await ingestShot3dReference(
  process.cwd(),
  {
    projectName: PROJ,
    adapter: 'upload',
    name: 'panel-sample.mp4',
    data: `data:video/mp4;base64,${b64}`,
  },
  { ingest: {} },
)
check('API 返回站内 URL', result.videoUrl.startsWith(`/project-assets/`))

const after = readProject(rootDir, PROJ)
const vids = (after?.assets || []).filter((a) => a.kind === 'video')
check('assets 含视频', vids.length >= 1 && vids.some((a) => a.url === result.videoUrl.split('?')[0]))

const listRes = await fetch(`${app}/api/project`).then((r) => r.json())
check('项目在 API 列表', (listRes.projects || []).some((p) => p.name === PROJ), PROJ)

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  await page.goto(`${app}/#/p/${encodeURIComponent(PROJ)}/assets`, { waitUntil: 'networkidle' })
  await page.locator('.board').waitFor({ timeout: 30000 })
  await page.locator('[data-asset-video-tab]').click()
  await page.locator('[data-asset-video-board]').waitFor({ timeout: 30000 })
  await page.locator('[data-asset-link-ingest]').waitFor({ timeout: 10000 })
  const listText = await page.locator('[data-asset-ingest-video-list]').innerText()
  check('视频分类列出新视频', listText.includes('panel-sample') || listText.includes('发布素材卡'), listText)
  check('视频卡片存在', (await page.locator('[data-asset-video-card]').count()) >= 1)
  check('下载输入可见', (await page.locator('[data-asset-ingest-url]').count()) === 1)
} finally {
  await browser.close()
  stop()
}

const bad = check.bad()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 素材页链接下载验收通过')
process.exit(bad ? 1 : 0)
