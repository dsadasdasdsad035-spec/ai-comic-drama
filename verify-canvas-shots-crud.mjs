/**
 * 画布镜头增删插回归（纯函数层）。
 *
 * 断言点：
 * 1) 新增生成正式的 `E{集}-{镜号}` 镜头，镜号取集内最大号 +1；
 * 2) 在中间插入时新镜紧跟所选镜，镜号在集内唯一（相邻整数被占用时用小数后缀）；
 * 3) 删除同时清掉上一镜指向它的 transition_out，并给出显式删除集合；
 * 4) 改镜号按「新镜 + 删旧镜」，冲突时拒绝且不改数组；
 * 5) 改号后指向旧 id 的转场跟到新 id。
 *
 * 跑法：node verify-canvas-shots-crud.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-canvas-crud-'))
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

const ops = await import(bundle('src/canvasShotOps.ts', 'ops'))
const canvas = await import(bundle('src/canvasShots.ts', 'canvasShots'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shot = (ep, no, extra = {}) => ({
  id: `E${String(ep).padStart(2, '0')}-${no}`,
  episode: ep,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: '',
  dialogue: [],
  cast: [],
  ...extra,
})

const shots = [shot(1, 'S01'), shot(1, 'S02'), shot(1, 'S03'), shot(2, 'S01')]

// ---------------------------------------------------------------- 新增
const add = ops.planAddShot(shots, 1)
check('新增镜号取集内最大号 +1', add.shot.no === 'S04', add.shot.no)
check('新增 id 为 E{集}-{镜号}', add.shot.id === 'E01-S04', add.shot.id)
check('新增不改原数组', shots.length === 4)

// ---------------------------------------------------------------- 插入
const mid = ops.planInsertAfter(shots, 'E01-S01')
check('S01 之后插入落在数组紧邻位置', mid.next[1].id === mid.shot.id, mid.next.map((s) => s.id).join(','))
check('S02 已被占用时用小数号保持相邻', mid.shot.no === 'S01.1', mid.shot.no)
const order = [...mid.next.filter((s) => s.episode === 1)].sort((a, b) =>
  String(a.no).localeCompare(String(b.no), undefined, { numeric: true }),
)
check('按号排序后紧跟 S01', order[1].id === mid.shot.id, order.map((s) => s.no).join(','))

const gap = ops.planInsertAfter([shot(1, 'S01'), shot(1, 'S03')], 'E01-S01')
check('目标与下一镜之间有空号时直接占用', gap.shot.no === 'S02', gap.shot.no)

// ---------------------------------------------------------------- 删除
const withTransition = [
  shot(1, 'S01', { transition_out: { to: 'E01-S02' } }),
  shot(1, 'S02'),
  shot(1, 'S03'),
]
const del = ops.planDeleteShot(withTransition, 'E01-S02')
check('删除给出显式 deleteShotIds', del.deletes[0] === 'E01-S02')
check('删除后项目少一镜', del.next.length === 2)
check('上一镜 transition_out 被清掉', del.next[0].transition_out === undefined)

const delMany = ops.planDeleteShots(withTransition, ['E01-S02', 'E01-S03'])
check('批量删除清掉所有指向它们的转场', delMany.next.length === 1 && delMany.next[0].transition_out === undefined)

// ---------------------------------------------------------------- 改号
const renamed = ops.planRenameShotNo(withTransition, 'E01-S02', 'S05')
check('改号成功', renamed.ok === true)
check('新 id 由新镜号生成', renamed.ok && renamed.newId === 'E01-S05')
check('旧 id 计入删除', renamed.ok && renamed.deletes[0] === 'E01-S02')
check(
  '指向旧 id 的转场跟到新 id',
  renamed.ok && renamed.next.find((s) => s.id === 'E01-S01')?.transition_out?.to === 'E01-S05',
)

const conflict = ops.planRenameShotNo(withTransition, 'E01-S02', 'S03')
check('改号冲突被拒', conflict.ok === false && /S03/.test(conflict.error || ''), conflict.error || '')
check('冲突时原数组不变', withTransition[1].no === 'S02')

// ---------------------------------------------------------------- 删除后水合不复活
const nodes = canvas.composeShotCanvasNodes([], withTransition)
const afterDelete = canvas.composeShotCanvasNodes(nodes, del.next)
const edges = canvas.composeShotCanvasEdges([], afterDelete)
check('删除后画布不再出现该镜', !afterDelete.some((n) => n.data.shotId === 'E01-S02'))
check('删除后画布不复活指向它的转场边', edges.every((e) => e.target !== 'E01-S02'))

fs.rmSync(outDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// UI：画布新增 / 插入 / 删除 / 改号都要落到 project.json 并同步画布
// ---------------------------------------------------------------------------
const PORT = 5397
const APP = `http://127.0.0.1:${PORT}`
const NAME = `canvas-crud-${Date.now()}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-crud-'))
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, env: { ...process.env, SB_PROJECTS_DIR: WORK }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

const seed = ['S01', 'S02', 'S03'].map((no) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  scene_no: 1,
  scene_slug: 'SC01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `镜头 ${no}`,
  dialogue: [],
  cast: [],
  keyframe_prompt: '雨夜街头',
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
      source: '画布增删改验收',
      style: '写实',
      aspect: '16:9',
      episodes: [{ no: 1, title: 'EP1', scenes: [{ no: 1, slug: 'SC01' }] }],
      characters: [],
      shots: seed,
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
  page.on('dialog', (d) => void d.accept())

  const nodeCount = () => page.locator('.react-flow__node-shot').count()
  const waitNodes = (n) =>
    page.waitForFunction((want) => document.querySelectorAll('.react-flow__node-shot').length === want, n, {
      timeout: 20000,
    })
  const shotNode = (no) => page.locator('.react-flow__node-shot').filter({ hasText: no }).first()
  // 卡片可能被顺序边的 chip 压住，直接派发选中事件，避免点到别的层
  const selectShot = async (no) => {
    await shotNode(no).evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(300)
  }

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await waitNodes(3)

  // 新增：正式 E01-S04
  await page.locator('.bm .tm-btn').click()
  await page.getByRole('button', { name: /新建镜头卡/ }).click()
  await waitNodes(4)
  const afterAdd = await readShots()
  check('新增：项目多一镜', afterAdd.length === 4, afterAdd.map((s) => s.id).join(','))
  check('新增：镜号取最大号 +1', afterAdd.some((s) => s.id === 'E01-S04'), afterAdd.map((s) => s.id).join(','))
  check('新增：画布多一张卡', (await nodeCount()) === 4, String(await nodeCount()))

  // 插入：S02 之后（S03 已占用 → S02.1）
  await selectShot('S02')
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await waitNodes(5)
  const afterInsert = await readShots()
  check('插入：项目多一镜', afterInsert.length === 5, afterInsert.map((s) => s.id).join(','))
  check('插入：镜号避让已占用值', afterInsert.some((s) => s.id === 'E01-S02.1'), afterInsert.map((s) => s.id).join(','))
  check('插入：画布多一张卡', (await nodeCount()) === 5, String(await nodeCount()))

  // 删除：Inspector 菜单 → 删除镜头（确认框自动同意）
  await selectShot('S02.1')
  await page.locator('.shot-inspector .si-menu summary').click()
  await page.locator('.shot-inspector .si-menu-pop button', { hasText: '删除镜头' }).click()
  await waitNodes(4)
  const afterDelete = await readShots()
  check('删除：项目少一镜', afterDelete.length === 4, afterDelete.map((s) => s.id).join(','))
  check('删除：项目里不再有该镜', !afterDelete.some((s) => s.id === 'E01-S02.1'), afterDelete.map((s) => s.id).join(','))
  check('删除：画布不再出现该镜', (await nodeCount()) === 4, String(await nodeCount()))
  await page.waitForTimeout(1200)
  check('删除：防抖没有把旧镜写回', (await readShots()).length === 4, String((await readShots()).length))

  // 改号：冲突不写
  await selectShot('S01')
  // 镜头参数默认折叠，改镜号前先展开
  const params = page.locator('.shot-inspector [data-section="shotParams"]')
  if (!(await params.evaluate((el) => el.open))) await params.locator('summary').click()
  await page.waitForTimeout(200)
  const noInput = params.locator('label.field', { hasText: '镜号' }).locator('input').first()
  await noInput.fill('S03')
  const conflictToast = await page
    .waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('已有镜号') === true, null, {
      timeout: 4000,
    })
    .then(async () => await page.locator('.toast').innerText())
    .catch(() => '')
  check('改号：重号被提示', /S03/.test(conflictToast), conflictToast)
  check('改号：冲突时项目不变', (await readShots()).some((s) => s.id === 'E01-S01'), (await readShots()).map((s) => s.id).join(','))

  // 改号：成功后新镜 + 删旧镜
  await noInput.fill('S07')
  await page.waitForTimeout(900)
  const afterRename = await readShots()
  check('改号：新 id 由新镜号生成', afterRename.some((s) => s.id === 'E01-S07'), afterRename.map((s) => s.id).join(','))
  check('改号：旧 id 已删除', !afterRename.some((s) => s.id === 'E01-S01'), afterRename.map((s) => s.id).join(','))
  check('改号：镜数不变', afterRename.length === 4, String(afterRename.length))
  check('改号：画布仍是 4 镜', (await nodeCount()) === 4, String(await nodeCount()))

  check('画布增删改：页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(WORK, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
