/**
 * 项目生命周期验收：新建入口、删除预览、快照、级联清理、活动任务保护、批量删除、
 * 删除后的全局上下文回退。全部在临时 SB_PROJECTS_DIR 下跑，不碰真实项目。
 *
 * 跑法：node verify-project-lifecycle.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5331
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'project-lifecycle-'))
// 必须在导入 db.mjs 之前设置：resolveRoot 读的是环境变量
process.env.SB_PROJECTS_DIR = TMP

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const dbm = await import('./server/db.mjs')
const lifecycle = await import('./server/project-lifecycle.mjs')
const { createDeliverable, deleteDeliverable } = await import('./server/deliverables.mjs')
const { createJob } = await import('./server/publish-jobs.mjs')

// ---------------------------------------------------------------- 种子数据

const shot = (id, episode = 1) => ({
  id,
  episode,
  no: Number(id.split('-').pop()) || 1,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `${id} 画面`,
  keyframe_prompt: `${id} 画面`,
  dialogue: [],
  cast: [],
})

function seedProject(name, { shots = 2 } = {}) {
  dbm.createProject(TMP, name, { title: `${name} 标题` })
  dbm.writeProject(TMP, name, {
    shots: Array.from({ length: shots }, (_, i) => shot(`${name}-s${i + 1}`)),
    characters: [{ name: '陈曦', role: '主角', age: '28', look_cn: '短发', look_en: 'short hair' }],
    designs: [{ id: `${name}-d1`, kind: 'scene', name: '街口', refs: [], summaryCn: '夜景' }],
    episodes: [
      {
        no: 1,
        title: '开场',
        hook: '悬念',
        scenes: [{ no: 1, slug: '路口', place: '街口', time: '夜', beats: '对峙', characters: ['陈曦'], intensity: 3, tone: '紧张' }],
      },
    ],
    sceneLayouts: [
      { id: `${name}-l1`, episode: 1, sceneNo: 1, w: 6, h: 4, source: 'manual', objects: [] },
    ],
    assets: [{ kind: 'image', title: '参考图', url: `/project-assets/${name}/ref.png` }],
  })
  dbm.upsertStockImport(TMP, name, {
    provider: 'pexels',
    itemId: `${name}-stock-1`,
    url: `/project-assets/${name}/stock.jpg`,
    mediaType: 'image',
    title: '在线图',
  })
  dbm.saveChatThread({ project: name, surface: 'script', episode: 0, shotId: '' }, [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: '你好' }] },
  ])
}

function seedPublish(name, { state = 'draft' } = {}) {
  const rec = createDeliverable(TMP, {
    project: name,
    episode: 1,
    title: `${name} 成片`,
    url: '/exports/placeholder.mp4',
    source: 'export',
  })
  const { job } = createJob(TMP, {
    deliverableId: rec.id,
    project: name,
    episode: 1,
    platform: 'douyin',
    accountId: 'acc-test',
    mode: 'draft',
  })
  return { deliverable: rec, job }
}

function seedIntent(name, deliverableId) {
  const db = dbm.openDatabase(TMP)
  try {
    db.prepare(
      `INSERT INTO publish_intents
       (id,deliverable_id,project,episode,source,config_hash,config,targets,preflight,state,job_ids,reason,created_at,expires_at,confirmed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      `intent-${name}`,
      deliverableId,
      name,
      1,
      'manual',
      'hash-test',
      '{}',
      '[]',
      '{}',
      'staged',
      '[]',
      '',
      new Date().toISOString(),
      new Date(Date.now() + 3600_000).toISOString(),
      '',
    )
  } finally {
    db.close()
  }
}

function rowsOf(name) {
  const db = dbm.openDatabase(TMP)
  try {
    const project = db.prepare('SELECT id FROM projects WHERE name = ?').get(name)
    const out = { project: Boolean(project) }
    for (const item of lifecycle.PROJECT_CASCADE) {
      const args = item.key === 'id' ? [project?.id] : [name]
      if (!project) {
        out[item.table] = 0
        continue
      }
      const where = item.where || `${item.column} = ?`
      out[item.table] = Number(
        db.prepare(`SELECT COUNT(*) AS n FROM ${item.table} WHERE ${where}`).get(...args)?.n || 0,
      )
    }
    return out
  } finally {
    db.close()
  }
}

const PROJECT_TABLES = [
  'shots', 'characters', 'assets', 'designs', 'scenes', 'episodes',
  'scene_layouts', 'stock_imports', 'chat_threads', 'publish_events',
  'publish_jobs', 'publish_intents', 'deliverables',
]

function writeMedia(name) {
  const dir = path.join(TMP, name, 'assets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ref.png'), Buffer.alloc(2048, 1))
  fs.mkdirSync(path.join(ROOT, '.scene-drafts', name, 'shot-1'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, '.scene-drafts', name, 'shot-1', 'draft.py'), '# draft\n')
}

function cleanupDrafts(name) {
  fs.rmSync(path.join(ROOT, '.scene-drafts', name), { recursive: true, force: true })
}

// ---------------------------------------------------------------- 1. 服务端

console.log('\n== 1. 服务端删除能力 ==')

check(
  'PROJECT_CASCADE 覆盖 12 张项目域表 + publish_events',
  lifecycle.PROJECT_CASCADE.length === 13 &&
    PROJECT_TABLES.every((t) => lifecycle.PROJECT_CASCADE.some((e) => e.table === t)),
  `entries=${lifecycle.PROJECT_CASCADE.length}`,
)

seedProject('demo', { shots: 3 })
writeMedia('demo')
const { deliverable } = seedPublish('demo')
seedIntent('demo', deliverable.id)
// 发布任务默认 queued 属于活动状态，先取消，才能测正常删除
{
  const db = dbm.openDatabase(TMP)
  db.prepare("UPDATE publish_jobs SET state='cancelled' WHERE project='demo'").run()
  db.close()
}
seedProject('keep', { shots: 2 })
writeMedia('keep')

const before = rowsOf('demo')
check(
  '种子数据覆盖全部级联表',
  PROJECT_TABLES.every((t) => before[t] > 0),
  JSON.stringify(before),
)

const preview = lifecycle.previewProjectDelete(TMP, 'demo')
check('预览返回 exists=true', preview.exists === true)
check('预览镜头数与种子一致', preview.counts.shots === 3, `shots=${preview.counts.shots}`)
check(
  '预览每个级联表都有计数键',
  PROJECT_TABLES.every((t) => typeof preview.counts[t] === 'number'),
)
check('预览统计媒体体积', preview.mediaBytes >= 2048, `mediaBytes=${preview.mediaBytes}`)
check('预览活动任务为空', preview.activeJobs.length === 0)
check('预览不改数据', JSON.stringify(rowsOf('demo')) === JSON.stringify(before))

const missing = lifecycle.previewProjectDelete(TMP, 'nope-not-here')
check('不存在项目返回 exists=false', missing.exists === false && missing.counts && Object.keys(missing.counts).length === 0)

// 快照失败：把 .deleted 占成文件，mkdirSync 必然失败
const deletedDir = path.join(TMP, lifecycle.DELETED_DIR)
fs.rmSync(deletedDir, { recursive: true, force: true })
fs.writeFileSync(deletedDir, 'not a directory')
const failed = lifecycle.deleteProject(TMP, 'demo', { appRoot: ROOT })
check('快照写入失败时删除中止', failed.ok === false && failed.code === 'snapshot_failed', JSON.stringify(failed))
check('快照失败后数据不变', JSON.stringify(rowsOf('demo')) === JSON.stringify(before))
check('快照失败后项目目录仍在', fs.existsSync(path.join(TMP, 'demo')))
fs.rmSync(deletedDir, { force: true })

// 正常删除
const del = lifecycle.deleteProject(TMP, 'demo', { appRoot: ROOT })
check('删除成功', del.ok === true, JSON.stringify(del))
check('返回共享产物未清理标记', del.sharedFilesKept === true)
check('返回警告为空', Array.isArray(del.warnings) && del.warnings.length === 0, JSON.stringify(del.warnings))

const after = rowsOf('demo')
check('删除后所有级联表无该项目行', PROJECT_TABLES.every((t) => after[t] === 0), JSON.stringify(after))
check('删除后项目主表无该行', after.project === false)

const keepRows = rowsOf('keep')
check(
  '其他项目数据不受影响',
  keepRows.project === true &&
    ['characters', 'assets', 'designs', 'scenes', 'episodes', 'scene_layouts', 'stock_imports', 'chat_threads'].every(
      (t) => keepRows[t] === 1,
    ) &&
    keepRows.shots === 2,
  JSON.stringify(keepRows),
)

const snapDir = path.join(TMP, lifecycle.DELETED_DIR)
const snapFiles = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter((f) => f.startsWith('demo-')) : []
check('快照文件已落盘', snapFiles.length === 1, snapFiles.join(','))
let snap = null
try {
  snap = JSON.parse(fs.readFileSync(path.join(snapDir, snapFiles[0]), 'utf8'))
} catch {
  snap = null
}
check('快照含版本与删除时间', snap?.version === 1 && Boolean(snap?.deletedAt))
check('快照含主表行', snap?.project?.name === 'demo')
check(
  '快照含全部级联表行',
  PROJECT_TABLES.every((t) => Array.isArray(snap?.tables?.[t])),
)
check('快照保留镜头行', snap?.tables?.shots?.length === 3, `shots=${snap?.tables?.shots?.length}`)
check('快照保留聊天与发布记录', snap?.tables?.chat_threads?.length === 1 && snap?.tables?.publish_jobs?.length === 1)

check('项目目录已删除', !fs.existsSync(path.join(TMP, 'demo')))
check('3D 草稿目录已删除', !fs.existsSync(path.join(ROOT, '.scene-drafts', 'demo')))

// 同名重建为空项目
dbm.createProject(TMP, 'demo', { title: '重建' })
const rebuilt = dbm.readProject(TMP, 'demo')
check('同名重建为空项目', (rebuilt.shots ?? []).length === 0 && (rebuilt.characters ?? []).length === 0)
check('同名重建无旧聊天', dbm.getChatThread({ project: 'demo', surface: 'script', episode: 0, shotId: '' }) === undefined)
check('同名重建无旧成片', (await import('./server/deliverables.mjs')).listDeliverables(TMP, { project: 'demo' }).length === 0)

// 活动任务拦截
seedProject('busy', { shots: 1 })
const busy = seedPublish('busy', { state: 'queued' })
const busyBefore = rowsOf('busy')
const busyDel = lifecycle.deleteProject(TMP, 'busy', { appRoot: ROOT })
check(
  '活动发布任务时删除被拒',
  busyDel.ok === false && busyDel.code === 'active_jobs' && busyDel.jobs?.length === 1,
  JSON.stringify(busyDel),
)
check('拒绝后任务行仍在', rowsOf('busy').publish_jobs === busyBefore.publish_jobs)
check('拒绝后项目仍在', rowsOf('busy').project === true)
const busyPreview = lifecycle.previewProjectDelete(TMP, 'busy')
check('预览能看到活动任务', busyPreview.activeJobs.length === 1 && busyPreview.activeJobs[0].state === 'queued')

// 批量：一项被拒，另一项成功
seedProject('fresh', { shots: 1 })
const batch = lifecycle.deleteProjects(TMP, ['busy', 'fresh'], { appRoot: ROOT })
check('批量返回逐项结果', batch.ok && batch.results.length === 2)
check('批量中成功项已删除', batch.deleted.includes('fresh') && rowsOf('fresh').project === false)
check('批量中被拒项保留', batch.results.find((r) => r.name === 'busy')?.code === 'active_jobs')
check('批量中成功项有快照', fs.readdirSync(snapDir).some((f) => f.startsWith('fresh-')))

// 批量不设上限：120 个名字必须全部进入结果（不存在记为 not_found，而不是被整批拒绝）
const manyNames = Array.from({ length: 120 }, (_, i) => `bulk-none-${i}`)
const manyResult = lifecycle.deleteProjects(TMP, manyNames, { appRoot: ROOT })
check(
  '批量 120 个不被数量上限拒绝',
  manyResult.ok === true && manyResult.results.length === 120,
  `results=${manyResult.results?.length}`,
)
check(
  '批量 120 个全部逐项报告 not_found',
  manyResult.results.every((r) => r.code === 'not_found'),
)

let badName = ''
try {
  lifecycle.deleteProjects(TMP, ['../etc'], { appRoot: ROOT })
} catch (e) {
  badName = e.message
}
check('非法项目名被拒', /项目名不合法/.test(badName), badName)

// 共享产物目录保留
fs.mkdirSync(path.join(ROOT, 'public', 'exports'), { recursive: true })
const sharedFile = path.join(ROOT, 'public', 'exports', 'lifecycle-placeholder.mp4')
fs.writeFileSync(sharedFile, 'x')
seedProject('shared', { shots: 1 })
lifecycle.deleteProject(TMP, 'shared', { appRoot: ROOT })
check('共享产物池文件未被删除', fs.existsSync(sharedFile))
fs.rmSync(sharedFile, { force: true })

cleanupDrafts('keep')
cleanupDrafts('busy')
cleanupDrafts('demo')
cleanupDrafts('fresh')
cleanupDrafts('shared')

console.log(`\n服务端段：${bad === 0 ? '全部通过' : `${bad} 项失败`}`)
if (bad > 0) {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
}

// ---------------------------------------------------------------- 2. API 路由

console.log('\n== 2. 项目 API ==')

// API 段用的种子：server 与 verify 进程共享同一个 SB_PROJECTS_DIR
seedProject('api-one', { shots: 2 })
seedProject('api-two', { shots: 1 })
seedProject('api-busy', { shots: 1 })
seedProject('api-batch-a', { shots: 1 })
seedProject('api-batch-b', { shots: 1 })
writeMedia('api-one')

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let json = null
  try {
    json = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json }
}

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

let browser = null
try {
  // 活动任务必须在服务启动之后再建：服务启动会把未完成任务标 unknown（不是活动态）
  seedPublish('api-busy', { state: 'queued' })

  const previewRes = await api('/api/project?name=api-one&preview=delete')
  check('API 预览 200', previewRes.status === 200, `status=${previewRes.status}`)
  check('API 预览返回 exists 与 counts', previewRes.json?.exists === true && previewRes.json?.counts?.shots === 2)
  check('API 预览返回 mediaBytes 与 activeJobs', typeof previewRes.json?.mediaBytes === 'number' && Array.isArray(previewRes.json?.activeJobs))

  const previewMissing = await api('/api/project?name=nope-missing&preview=delete')
  check('API 预览不存在项目返回 exists=false', previewMissing.status === 200 && previewMissing.json?.exists === false)

  const badPreview = await api('/api/project?name=..%2Fetc&preview=delete')
  check('API 预览非法名 400', badPreview.status === 400 && badPreview.json?.ok === false, `status=${badPreview.status}`)

  const busyDel = await api('/api/project?name=api-busy', { method: 'DELETE' })
  check('API 活动任务删除 409', busyDel.status === 409 && busyDel.json?.code === 'active_jobs', `status=${busyDel.status}`)
  check('API 409 返回任务清单', busyDel.json?.jobs?.length === 1)

  const missingDel = await api('/api/project?name=nope-missing', { method: 'DELETE' })
  check('API 删除不存在项目 404', missingDel.status === 404, `status=${missingDel.status}`)

  const badDel = await api('/api/project?names=..%2Fetc', { method: 'DELETE' })
  check('API 批量非法名 400', badDel.status === 400, `status=${badDel.status}`)

  const noName = await api('/api/project', { method: 'DELETE' })
  check('API 删除缺名 400', noName.status === 400, `status=${noName.status}`)

  const oneDel = await api('/api/project?name=api-one', { method: 'DELETE' })
  check('API 单删 200', oneDel.status === 200 && oneDel.json?.ok === true, `status=${oneDel.status}`)
  check('API 单删返回快照与共享标记', Boolean(oneDel.json?.snapshot) && oneDel.json?.sharedFilesKept === true)
  check('API 单删后列表无该项目', !(await api('/api/project')).json.projects.some((p) => p.name === 'api-one'))

  // 批量：一项被拒（api-busy 还挂着 queued），另一项成功；名字走请求体
  const batchDel = await api('/api/project', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: ['api-batch-a', 'api-busy', 'api-batch-b'] }),
  })
  check('API 批量部分失败仍 200', batchDel.status === 200 && batchDel.json?.ok === true, `status=${batchDel.status}`)
  check(
    'API 批量逐项返回结果',
    Array.isArray(batchDel.json?.results) && batchDel.json.results.length === 3 &&
      batchDel.json.results.filter((r) => r.ok).length === 2,
    JSON.stringify(batchDel.json?.results?.map((r) => `${r.name}:${r.code || 'ok'}`)),
  )
  check('API 批量成功项已删', batchDel.json?.deleted?.includes('api-batch-a') && batchDel.json?.deleted?.includes('api-batch-b'))
  check('API 批量被拒项仍在', (await api('/api/project')).json.projects.some((p) => p.name === 'api-busy'))

  // 查询串写法保留兼容
  seedProject('api-qs', { shots: 1 })
  const qsDel = await api('/api/project?names=api-qs', { method: 'DELETE' })
  check('API 查询串批量仍兼容', qsDel.status === 200 && qsDel.json?.deleted?.includes('api-qs'), `status=${qsDel.status}`)

  // 批量预览走 POST 请求体：一次返回逐项 items
  seedProject('api-prev-a', { shots: 1 })
  seedProject('api-prev-b', { shots: 2 })
  const bulkPreview = await api('/api/project?preview=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: ['api-prev-a', 'api-prev-b', 'ghost-project'] }),
  })
  check('API 批量预览 200', bulkPreview.status === 200 && bulkPreview.json?.ok === true, `status=${bulkPreview.status}`)
  check(
    'API 批量预览逐项计数',
    bulkPreview.json?.items?.length === 3 &&
      bulkPreview.json.items[0].counts?.shots === 1 &&
      bulkPreview.json.items[1].counts?.shots === 2,
    JSON.stringify(bulkPreview.json?.items?.map((i) => `${i.name}:${i.counts?.shots}`)),
  )
  check(
    'API 批量预览标记不存在的项目',
    bulkPreview.json?.items?.find((i) => i.name === 'ghost-project')?.exists === false,
  )
  const emptyPreview = await api('/api/project?preview=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: [] }),
  })
  check('API 批量预览空列表 400', emptyPreview.status === 400, `status=${emptyPreview.status}`)

  // 一次删 60 个：不再有 50 上限
  const bulkNames = Array.from({ length: 60 }, (_, i) => `api-bulk-${i}`)
  for (const n of bulkNames) dbm.createProject(TMP, n, { title: n })
  const bulkDel = await api('/api/project', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: bulkNames }),
  })
  check(
    'API 一次删除 60 个项目',
    bulkDel.status === 200 && bulkDel.json?.deleted?.length === 60,
    `deleted=${bulkDel.json?.deleted?.length}`,
  )

  // 创建接口保持可用（顺序上放在删除后面，避免脏数据干扰计数）
  const made = await api('/api/project?name=api-fresh&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '临时项目' }),
  })
  check('API 新建仍可用', made.status === 200 && made.json?.created === true)
  const dup = await api('/api/project?name=api-fresh&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  check('API 同名新建被拒', dup.json?.ok === false && /已存在/.test(dup.json?.message || ''))

  // ---------------------------------------------------------------- 3. 界面

  console.log('\n== 3. 界面入口与上下文回退 ==')

  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  // 镜头表不再有新建入口
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  const shotTableNew = await page.locator('.wb-new').count()
  const shotTableNewBtn = await page.getByRole('button', { name: /新建项目/ }).count()
  check('镜头表没有 wb-new 表单', shotTableNew === 0, `count=${shotTableNew}`)
  check('镜头表没有新建项目按钮', shotTableNewBtn === 0, `count=${shotTableNewBtn}`)

  // 全局带新建入口
  const projectMenu = page.locator('[data-project-menu]')
  check('全局带出现项目菜单', (await projectMenu.count()) === 1)

  // 窄宽度仍可见
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(600)
  const narrowVisible = await projectMenu.isVisible().catch(() => false)
  const narrowBox = await projectMenu.boundingBox().catch(() => null)
  check('窄宽度下项目菜单仍可见', narrowVisible && Boolean(narrowBox), JSON.stringify(narrowBox))
  await page.setViewportSize({ width: 1560, height: 940 })
  await page.waitForTimeout(400)

  // 新建对话框
  await projectMenu.click()
  await page.waitForTimeout(300)
  check('弹层含新建与管理', (await page.locator('[data-project-menu-panel]').count()) === 1)
  await page.locator('[data-project-new]').click()
  await page.waitForTimeout(300)
  const created = `ui-new-${Date.now()}`
  await page.locator('[data-new-project-name]').fill(created)
  await page.locator('[data-new-project-title]').fill('界面新建')
  await page.locator('[data-new-project-submit]').click()
  await page.waitForTimeout(900)
  const afterCreate = await api('/api/project')
  check('界面新建成功', afterCreate.json.projects.some((p) => p.name === created), created)
  const topValue = await page.locator('.topbar-project select').inputValue()
  check('新建后切换到新项目', topValue === created, `value=${topValue}`)

  // 非法名被拦
  await projectMenu.click()
  await page.waitForTimeout(250)
  await page.locator('[data-project-new]').click()
  await page.waitForTimeout(250)
  await page.locator('[data-new-project-name]').fill('bad name!')
  await page.locator('[data-new-project-submit]').click()
  await page.waitForTimeout(400)
  const stillMissing = !(await api('/api/project')).json.projects.some((p) => p.name === 'bad name!')
  check('非法目录名未创建项目', stillMissing)
  await page.locator('[data-new-project-cancel]').click()
  await page.waitForTimeout(300)

  // 管理面板
  await projectMenu.click()
  await page.waitForTimeout(250)
  await page.locator('[data-project-manage]').click()
  await page.waitForTimeout(600)
  const listRows = await page.locator('[data-project-row]').count()
  check('管理面板显示项目列表', listRows > 0, `rows=${listRows}`)
  const search = page.locator('[data-project-search]')
  await search.fill(created)
  await page.waitForTimeout(400)
  const filteredRows = await page.locator('[data-project-row]').count()
  check('搜索只保留匹配项', filteredRows === 1, `rows=${filteredRows}`)

  // 单项删除：错误确认文本不发请求
  await page.locator(`[data-project-row="${created}"] [data-project-delete]`).click()
  await page.waitForTimeout(700)
  check('确认层出现', (await page.locator('[data-project-delete-confirm]').count()) === 1)
  const confirmInput = page.locator('[data-delete-confirm-input]')
  await confirmInput.fill('wrong-name')
  await page.waitForTimeout(200)
  const disabled = await page.locator('[data-delete-confirm-submit]').isDisabled()
  check('确认文本不符时按钮禁用', disabled)
  const beforeCount = (await api('/api/project')).json.projects.length
  await confirmInput.fill(created)
  await page.waitForTimeout(200)
  await page.locator('[data-delete-confirm-submit]').click()
  await page.waitForTimeout(1200)
  const afterDelete = (await api('/api/project')).json.projects
  check('确认后项目被删除', !afterDelete.some((p) => p.name === created))
  check('删除后总项目数减一', afterDelete.length === beforeCount - 1, `${beforeCount} -> ${afterDelete.length}`)

  // 删除当前项目后上下文回退
  const currentAfter = await page.locator('.topbar-project select').inputValue()
  check('删除当前项目后切到剩余项目', currentAfter !== created && currentAfter !== '', `value=${currentAfter}`)
  const canvasKey = await page.evaluate((n) => localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(n)}`), created)
  check('被删项目的画布状态已清除', canvasKey === null)

  // 同名重建不恢复旧画布：先经界面删除一个项目，再看画布 key 是否被清掉
  await api('/api/project?name=canvas-check&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    localStorage.setItem(
      'storyboard-canvas-v1:canvas-check',
      JSON.stringify({ nodes: [], edges: [], characters: [], epNo: 1 }),
    )
  })
  await projectMenu.click()
  await page.waitForTimeout(250)
  await page.locator('[data-project-manage]').click()
  await page.waitForTimeout(600)
  await page.locator('[data-project-search]').fill('canvas-check')
  await page.waitForTimeout(400)
  await page.locator('[data-project-row="canvas-check"] [data-project-delete]').click()
  await page.waitForTimeout(700)
  await page.locator('[data-delete-confirm-input]').fill('canvas-check')
  await page.waitForTimeout(200)
  await page.locator('[data-delete-confirm-submit]').click()
  await page.waitForTimeout(1200)
  const canvasAfterUiDelete = await page.evaluate(() => localStorage.getItem('storyboard-canvas-v1:canvas-check'))
  check('界面删除后同名画布 key 已清除', canvasAfterUiDelete === null, String(canvasAfterUiDelete))
  const canvasProjectGone = !(await api('/api/project')).json.projects.some((p) => p.name === 'canvas-check')
  check('界面删除后项目已不存在', canvasProjectGone)

  // 删除最后一个项目 → 未选项目
  // api-busy 的活动任务会在启动时被标成 unknown（终态），这里显式落成终态再清空，
  // 让「删除到空库」这个分支能确定性地跑到。
  {
    const db = dbm.openDatabase(TMP)
    db.prepare("UPDATE publish_jobs SET state='cancelled' WHERE state IN ('draft','queued','uploading','awaiting_user','awaiting_confirmation','submitted')").run()
    db.close()
  }
  const remaining = (await api('/api/project')).json.projects.map((p) => p.name)
  check('剩余项目非空，可测清空分支', remaining.length > 0, `count=${remaining.length}`)
  if (remaining.length) {
    const batchDelAll = await api(`/api/project?names=${remaining.join(',')}`, { method: 'DELETE' })
    const failedNames = (batchDelAll.json?.results || []).filter((r) => !r.ok).map((r) => r.name)
    check('清空剩余项目', batchDelAll.json?.ok === true && failedNames.length === 0, `failed=${failedNames.join(',')}`)
    if (!failedNames.length) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const emptyValue = await page.locator('.topbar-project select').inputValue()
      check('没有项目时顶栏回到未选', emptyValue === '', `value=${emptyValue}`)
      const optionText = await page.locator('.topbar-project select option').first().innerText()
      check('未选项目显示占位', /无项目|未选/.test(optionText), optionText)
      const autoCreated = (await api('/api/project')).json.projects.length
      check('不自动创建项目', autoCreated === 0, `count=${autoCreated}`)
    }
  }

  check('页面无 JS 异常', errs.length === 0, errs.join(' | '))
} catch (e) {
  bad++
  console.log(`❌ 验收脚本异常：${e?.message || e}`)
  console.log(e?.stack || '')
} finally {
  try {
    await browser?.close()
  } catch {
    /* ignore */
  }
  child.kill()
  try {
    fs.rmSync(path.join(ROOT, '.scene-drafts', 'api-one'), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log(`\n总计：${bad === 0 ? '全部通过 ✅' : `${bad} 项失败 ❌`}`)
process.exit(bad === 0 ? 0 : 1)

