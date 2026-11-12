/**
 * 画布导入回归：表格 → 镜头 → 落库计划。
 *
 * 断言点：
 * 1) 只有结构的表（镜号/秒/景别/运镜/画面）能生成镜头，keyframe_prompt 为空也不算错；
 * 2) 同一份文件连续导入两次，镜数不翻倍（按镜号合并）；
 * 3) 镜号重复时计划直接报错，不产生写入；
 * 4) 替换整集时，文件外镜头计入显式删除集合；
 * 5) 落库失败不会产生半份数据——计划是纯函数，调用方只在整个计划成功后提交。
 *
 * 跑法：node verify-canvas-intake.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-canvas-intake-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

const rows = await import(bundle('src/intake/rows.ts', 'rows'))
const format = await import(bundle('src/intake/format.ts', 'format'))
const shotDraft = await import(bundle('src/agent/shotDraft.ts', 'shotDraft'))
const shotSync = await import(bundle('src/shotSync.ts', 'shotSync'))
const ops = await import(bundle('src/canvasShotOps.ts', 'ops'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const TABLE = `镜号,秒,景别,运镜,画面
S01,3,中景,固定,雨夜街头，霓虹倒影
S02,4,近景,推,主角回头看见旧照片
S03,3.5,全景,拉,巷口空无一人`

const kind = format.detectFormat(TABLE).kind
check('表格被识别为可解析格式', format.isTabular(kind), kind)

const parsed = rows.rowsFromTable(TABLE, kind, { epNo: 1, episodes: [] })
check('表格解析出 3 行', parsed.rows.length === 3 && !parsed.error, parsed.error || String(parsed.rows.length))

const built = shotDraft.buildShotsFromImport(
  parsed.rows.map((r) => ({
    no: r.no,
    seconds: r.seconds,
    size: r.size,
    move: r.move,
    desc: r.desc,
    dialogue: r.dialogue,
    keyframe_prompt: r.keyframe_prompt,
    video_prompt: r.video_prompt,
  })),
  [],
  1,
)
check('结构表生成 3 镜', built.shots.length === 3, String(built.shots.length))
check(
  '只有结构时首帧提示词为空（不拦水合）',
  built.shots.every((s) => !String(s.keyframe_prompt ?? '').trim()),
)

const first = shotSync.mergeShotsDraft([], built.shots, 1, 'merge')
check('首次导入新增 3 镜', first.added === 3 && first.shots.length === 3)

// 幂等：同一份文件导入第二次
const second = shotSync.mergeShotsDraft(first.shots, built.shots, 1, 'merge')
check('重复导入镜数不翻倍', second.shots.length === 3, String(second.shots.length))
check('重复导入不新增', second.added === 0 && second.updated === 3)

// 替换整集：文件外镜头进入显式删除
const stale = [...first.shots, { ...first.shots[0], id: 'E01-S09', no: 'S09', secs: 3 }]
const plan = ops.planShotImport(stale, built.shots)
check('替换整集时旧镜头计入删除', plan.deletes.includes('E01-S09'), JSON.stringify(plan.deletes))
check('计划不改原数组', stale.length === 4)

// 镜号重复：计划报错，不提交
const duped = [first.shots[0], { ...first.shots[1], no: 'S01' }]
const badPlan = ops.planShotImport([], duped)
check('镜号重复被拦下', Boolean(badPlan.error), badPlan.error || '')
check('重复时返回原镜头（无写入）', badPlan.shots.length === 0)

fs.rmSync(outDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// UI：画布「导入」入口 → 预览 → 确认即落库并水合；失败不改；重复导入幂等
// ---------------------------------------------------------------------------
const PORT = 5396
const APP = `http://127.0.0.1:${PORT}`
const NAME = `canvas-intake-${Date.now()}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-intake-'))
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, env: { ...process.env, SB_PROJECTS_DIR: WORK }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

const seedShots = ['S01', 'S02'].map((no) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  scene_no: 1,
  scene_slug: 'SC01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `原有 ${no}`,
  dialogue: [],
  cast: [],
  keyframe_prompt: '',
  video_prompt: '',
}))

async function boot() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) break
    } catch {
      /* 等 vite 起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: NAME, aspect: '16:9' }),
  })
  await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: '画布导入验收',
      style: '写实',
      aspect: '16:9',
      episodes: [{ no: 1, title: 'EP1', scenes: [{ no: 1, slug: 'SC01' }] }],
      characters: [],
      shots: seedShots,
      designs: [],
    }),
  })
}

const readShots = async () => ((await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project?.shots ?? [])

let browser = null
try {
  await boot()
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  let failWrites = false
  await page.route('**/api/project**', async (route) => {
    const req = route.request()
    if (failWrites && req.method() === 'POST' && req.url().includes('/api/project?')) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: '模拟落库失败' }),
      })
    }
    return route.continue()
  })

  const nodeCount = () => page.locator('.react-flow__node-shot').count()
  const waitNodes = (n) =>
    page.waitForFunction((want) => document.querySelectorAll('.react-flow__node-shot').length === want, n, {
      timeout: 20000,
    })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await waitNodes(2)
  check('画布先水合项目原有镜头', (await nodeCount()) === 2, String(await nodeCount()))

  const csvPath = path.join(WORK, 'shots.csv')
  fs.writeFileSync(csvPath, TABLE + '\n')

  const openIntake = async (file) => {
    await page.getByRole('button', { name: '导入', exact: true }).click()
    await page.locator('.intake-dialog').waitFor({ timeout: 15000 })
    await page.locator('.intake-dialog button', { hasText: '上传文件' }).click()
    await page.locator('.intake-dialog input[type=file]').setInputFiles(file)
    await page.locator('[data-intake-plan]').waitFor({ timeout: 15000 })
    return page.locator('[data-intake-plan]').innerText()
  }

  // 1) 首次导入：确认后直接落库 + 水合
  const firstPlan = await openIntake(csvPath)
  check('画布导入：上传 CSV 出现预览', /新增 1/.test(firstPlan) && /更新 2/.test(firstPlan), firstPlan.replace(/\n/g, ' | '))
  await page.locator('[data-intake-apply]').click()
  await waitNodes(3)
  await page.locator('.intake-dialog').waitFor({ state: 'detached', timeout: 15000 })
  const afterFirst = await readShots()
  check('画布导入：写入项目（3 镜）', afterFirst.length === 3, String(afterFirst.length))
  check('画布导入：画布出现卡片（3 镜）', (await nodeCount()) === 3, String(await nodeCount()))
  check('画布导入：结构镜头首帧为空也能上画布', afterFirst.every((s) => !String(s.keyframe_prompt ?? '').trim()))

  // 2) 重复导入同一文件：镜数与节点数不变
  const secondPlan = await openIntake(csvPath)
  check('重复导入：预览不再新增', /新增 0/.test(secondPlan), secondPlan.replace(/\n/g, ' | '))
  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(900)
  const afterSecond = await readShots()
  check('重复导入：项目仍是 3 镜', afterSecond.length === 3, String(afterSecond.length))
  check('重复导入：画布仍是 3 镜', (await nodeCount()) === 3, String(await nodeCount()))

  // 3) 落库失败：对话框保留、画布与项目都不变
  const failCsv = path.join(WORK, 'fail.csv')
  fs.writeFileSync(failCsv, '镜号,秒,景别,运镜,画面\nS09,3,中景,固定,失败用例镜头\n')
  await openIntake(failCsv)
  failWrites = true
  await page.locator('[data-intake-apply]').click()
  await page.locator('[data-intake-apply-error]').waitFor({ timeout: 15000 })
  failWrites = false
  check('落库失败：对话框保留', (await page.locator('.intake-dialog').count()) === 1)
  check('落库失败：给出错误', /模拟落库失败/.test(await page.locator('[data-intake-apply-error]').innerText()))
  check('落库失败：画布不变（3 镜）', (await nodeCount()) === 3, String(await nodeCount()))
  check('落库失败：项目不变（3 镜）', (await readShots()).length === 3, String((await readShots()).length))
  await page.locator('.intake-dialog button', { hasText: '取消' }).click()
  await page.waitForTimeout(300)

  check('画布导入：页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(WORK, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
