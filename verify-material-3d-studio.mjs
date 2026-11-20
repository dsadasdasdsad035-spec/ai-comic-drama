/**
 * 素材 · 场景三维：Tab、新建场景、机位书签、持久化
 * 跑法：node verify-material-3d-studio.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import { readProject, resolveRoot, writeProject } from './server/db.mjs'

const PORT = 5368
const check = createCheck()
const PROJECTS = makeProjectsDir('m3d-studio-')
const PROJ = `m3d-${Date.now()}`

seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '场景三维验收' })
console.log('{}')
`,
)

process.env.SB_PROJECTS_DIR = PROJECTS
const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  await page.goto(`${app}/#/p/${encodeURIComponent(PROJ)}/assets`, { waitUntil: 'networkidle' })
  await page.locator('.board').waitFor({ timeout: 30000 })
  await page.locator('[data-asset-studio3d-tab]').click()
  await page.locator('[data-material3d-studio]').waitFor({ timeout: 30000 })
  await page.locator('[data-m3d-new-scene]').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-m3d-new-scene]')
      return b instanceof HTMLButtonElement && !b.disabled
    },
    { timeout: 15000 },
  )
  await page.locator('[data-m3d-new-scene]').click()
  await page.locator('[data-m3d-save-bookmark]').waitFor({ timeout: 60000 })
  await page.locator('[data-m3d-bookmark-label]').fill('验收机位')
  await page.locator('[data-m3d-save-bookmark]').click()
  const postOk = page.waitForResponse(
    (r) => r.url().includes('/api/project') && r.request().method() === 'POST' && r.ok(),
    { timeout: 20000 },
  )
  await postOk
  const saved = readProject(resolveRoot(process.cwd()), PROJ)
  const scenesBeforeReload = saved?.material3dScenes || []
  check(
    '保存后库里有场景与机位',
    scenesBeforeReload.length >= 1 && scenesBeforeReload.some((s) => (s.cameras || []).length >= 1),
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-asset-studio3d-tab]').click()
  await page.locator('[data-material3d-studio]').waitFor({ timeout: 30000 })
  const afterReload = await page.locator('[data-m3d-scene-card]').count()
  check('刷新后场景仍在', afterReload >= 1, String(afterReload))
  const savedAfter = readProject(resolveRoot(process.cwd()), PROJ)
  const scenes = savedAfter?.material3dScenes || []
  check('刷新后库内机位仍在', scenes.some((s) => (s.cameras || []).length >= 1))

  const root = resolveRoot(process.cwd())
  const cur = readProject(root, PROJ)
  const scene0 = (cur?.material3dScenes || [])[0]
  if (scene0) {
    const objId = 'obj-verify-m3d'
    const transform = {
      position: { x: 1.25, y: 0.5, z: -2 },
      rotation: { x: 0, y: 0.2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    writeProject(root, PROJ, {
      ...cur,
      designs: [
        {
          id: 'design-verify',
          kind: 'scene',
          name: '验收场景',
          refs: [],
          summaryCn: '',
          promptEn: '',
          keywords: [],
          image: '/project-assets/p/verify-placeholder.png',
        },
      ],
      material3dScenes: [
        {
          ...scene0,
          objects: [
            {
              id: objId,
              kind: 'billboard',
              designId: 'design-verify',
              transform,
            },
          ],
        },
      ],
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('[data-asset-studio3d-tab]').click()
    await page.locator('[data-material3d-studio]').waitFor({ timeout: 30000 })
    await page.locator(`[data-m3d-scene-card="${scene0.id}"] button`, { hasText: '打开工作台' }).click()
    await page.locator('[data-m3d-save-bookmark]').waitFor({ timeout: 60000 })
    await page.locator(`[data-m3d-object-item="${objId}"]`).click({ force: true })
    await page.waitForFunction(
      (id) => document.querySelector(`[data-m3d-object-item="${id}"]`)?.closest('li')?.classList.contains('m3d-list-selected'),
      objId,
      { timeout: 10000 },
    )
    await page.evaluate(() => document.querySelector('[data-m3d-inspector-toggle]')?.click())
    await page.waitForFunction(
      () => document.querySelector('[data-m3d-inspector-host]')?.dataset.m3dInspectorReady === 'true',
      { timeout: 60000 },
    )
    const afterPick = readProject(root, PROJ)
    const obj = afterPick?.material3dScenes?.[0]?.objects?.[0]
    check(
      '对象 transform 在库内可解析',
      !!obj?.transform?.position && Number.isFinite(obj.transform.position.x),
    )
    await page.reload({ waitUntil: 'networkidle' })
    const afterReloadObj = readProject(root, PROJ)?.material3dScenes?.[0]?.objects?.[0]
    check(
      '刷新后 transform 仍在',
      afterReloadObj?.transform?.position?.x === transform.position.x,
      JSON.stringify(afterReloadObj?.transform),
    )
  }
} finally {
  await browser.close()
  stop()
}

check('projects 目录存在', fs.existsSync(PROJECTS))
const bad = check.bad()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 场景三维验收通过')
process.exit(bad ? 1 : 0)