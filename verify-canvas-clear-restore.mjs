/**
 * 画布清空的真删语义验收（自起临时库 + 无头 Chrome）。
 *
 * 背景：早期「清空画布」只删画布投影，`project.json` 不动，于是 `read_shots`
 * 仍能读到镜头、导出 md 仍有内容、重启服务又恢复。现在清空 = 删除本集全部镜头，
 * 与 agent 读工具和导出对齐。本脚本按真删语义验收。
 *
 * 断言点：
 * 1) 菜单没有「重建本集卡片」，清空项写明删的是本集镜头与镜数；
 * 2) 确认框要手打当前集号，输错时确认按钮禁用且项目镜头不变；
 * 3) 输对后本集镜头真删，其他集镜数、角色 / 设定 / 素材卡不变，画布只剩素材卡；
 * 4) 服务端留下镜头快照，内容只含被删镜头；
 * 5) 指向被删镜头的转场被清掉（含跨集边界）；
 * 6) `read_shots` 不再返回该集，导出 md 不含该集；
 * 7) 刷新页面、重启 dev server 后依然是空的（不再依赖浏览器存档标记）；
 * 8) 空状态提示「这一集还没有镜头」，没有重建按钮，其他集仍可进入并看到卡片。
 *
 * 跑法：node verify-canvas-clear-restore.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
// 随机端口：固定端口一旦被上一轮残留的进程占着，脚本会悄悄打到别人的项目目录，
// 于是「快照不存在」这类断言看起来像代码坏了。带上随机端口并校验子进程活着。
const PORT = 5400 + Math.floor(Math.random() * 500)
const APP = `http://127.0.0.1:${PORT}`
const NAME = `canvas-clear-${Date.now()}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-clear-'))
const DELETED = path.join(WORK, '.deleted')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const shot = (ep, no, extra = {}) => ({
  id: `E${String(ep).padStart(2, '0')}-${no}`,
  episode: ep,
  no,
  scene_no: 1,
  scene_slug: 'SC01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `第 ${ep} 集 ${no}`,
  dialogue: [],
  cast: [],
  keyframe_prompt: '雨夜街头',
  video_prompt: '雨夜街头，推镜头',
  ...extra,
})

// E02-S01 的转场指向 E01-S02：清空 E01 后这条跨集边也必须清掉
const SEED_SHOTS = [
  shot(1, 'S01'),
  shot(1, 'S02'),
  shot(1, 'S03'),
  shot(2, 'S01', { transition_out: { type: 'fade', to: 'E01-S02' } }),
  shot(2, 'S02'),
]
const SEED_CHARS = [{ name: '林舟', desc: '主角', refs: [] }]
const SEED_DESIGNS = [{ kind: 'scene', name: 'SC01 · 雨夜街头', desc: '湿冷霓虹' }]
const SEED_ASSETS = [{ id: 'asset-seed-1', title: '样片', kind: 'video', url: '/tmp/x.mp4' }]

const viteArgs = [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort']
const spawnVite = () =>
  spawn(process.execPath, viteArgs, {
    cwd: root,
    env: { ...process.env, SB_PROJECTS_DIR: WORK },
    stdio: 'ignore',
  })
/** 同时只留一个 dev server；重启时旧的要换掉，finally 里要能杀掉最后一个 */
let child = spawnVite()

const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()
const post = (body) =>
  api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const readProject = async () =>
  (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project ?? { shots: [] }

/**
 * 等 dev server 起来。子进程已经退出时（端口被占、启动报错）立刻失败，
 * 否则会一直打到别人占着这个端口的实例上。
 */
async function waitHealth(proc = child) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`dev server 启动失败（退出码 ${proc.exitCode}，端口 ${PORT} 可能被占用）`)
    }
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 等 vite 起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

const stop = async (proc) => {
  if (!proc || proc.exitCode !== null) return
  proc.kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 600))
}

/** .deleted 里的镜头级快照 */
const shotSnapshots = () => {
  if (!fs.existsSync(DELETED)) return []
  return fs
    .readdirSync(DELETED)
    .filter((f) => f.startsWith('shots-') && f.endsWith('.json'))
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(DELETED, f), 'utf8')) }))
}

// ---------------------------------------------------------------- 纯前端模块：工具与导出
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-clear-bundle-'))
const toolsBundle = path.join(bundleDir, 'tools.mjs')
const mdBundle = path.join(bundleDir, 'md.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  path.join(root, 'src/agent/builtinPlatformTools.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${toolsBundle}`,
])
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  path.join(root, 'src/storyboardMarkdown.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${mdBundle}`,
])

// 工具里的 fetch 走相对路径；在 node 侧补上 dev server 的 origin
const realFetch = globalThis.fetch
globalThis.fetch = (u, init) =>
  realFetch(typeof u === 'string' && u.startsWith('/') ? `${APP}${u}` : u, init)

const tools = await import(toolsBundle)
const md = await import(mdBundle)

const runTool = async (name, args) => {
  const set = tools.createBuiltinPlatformTools({
    projectName: NAME,
    epNo: () => 1,
    confirm: async () => true,
  })
  const t = set.find((x) => x.name === name)
  if (!t) throw new Error(`没有工具 ${name}`)
  return t.run(args, {})
}

try {
  if (!(await waitHealth())) throw new Error('dev server 没起来')
  await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: NAME, aspect: '16:9' }),
  })
  await post({
    source: '清空画布真删验收',
    style: '写实',
    aspect: '16:9',
    episodes: [
      { no: 1, title: 'EP1', scenes: [{ no: 1, slug: 'SC01' }] },
      { no: 2, title: 'EP2' },
    ],
    characters: SEED_CHARS,
    designs: SEED_DESIGNS,
    assets: SEED_ASSETS,
    shots: SEED_SHOTS,
  })

  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack || e)))
    // 真删不该再弹原生确认框；有的话记下来，说明旧路径没退干净
    const dialogs = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })

    const nodes = () => page.locator('.react-flow__node-shot').count()
    const assetNodes = () => page.locator('.react-flow__node-asset').count()
    const hint = page.locator('.canvas-hint')
    const waitNodes = (n) =>
      page.waitForFunction(
        (want) => document.querySelectorAll('.react-flow__node-shot').length === want,
        n,
        { timeout: 20000 },
      )
    const enterEp = async (no) => {
      await page.locator(`.board-ep-card[data-board-ep="${no}"]`).click()
      await page.locator('.wb-bar-detail').waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(800)
    }
    const openMenu = async () => {
      await page.locator('.bm .tm-btn').click()
      await page.waitForTimeout(300)
    }
    const landed = async () => {
      await page.locator('.rail').waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForLoadState('networkidle').catch(() => {})
    }

    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.evaluate((h) => {
      window.location.hash = h
    }, `#/p/${encodeURIComponent(NAME)}/board`)
    await landed()
    await page.locator('.board-ep-card[data-board-ep="1"]').waitFor({ state: 'visible', timeout: 20000 })
    await enterEp(1)
    await waitNodes(3)

    // 素材卡只是画布投影，不在 removeShots 的范围里；先记下基线，清空后要一模一样
    const assetsBefore = await assetNodes()
    check('清空前画布有素材卡', assetsBefore > 0, String(assetsBefore))

    // ---------------------------------------------------------------- 菜单
    await openMenu()
    const items = await page.locator('.bm-panel .bm-item').allInnerTexts()
    const flat = items.map((t) => t.replace(/\s+/g, ' '))
    check('菜单没有重建本集卡片', !flat.some((t) => t.includes('重建本集卡片')), flat.join(' | '))
    const clearItem = flat.find((t) => t.startsWith('清空画布')) || ''
    check('清空项写明删本集镜数', /删本集 3 镜/.test(clearItem), clearItem)
    check('清空项不再承诺可重建', !/可重建/.test(clearItem), clearItem)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    const before = await readProject()

    // ---------------------------------------------------------------- 输错集号
    await openMenu()
    await page.locator('.bm-item:has-text("清空画布")').click()
    await page.locator('[data-prompt-input]').waitFor({ state: 'visible', timeout: 8000 })
    const dlgTitle = await page.locator('[role="dialog"] h3').innerText()
    check('确认框点名当前集', /E01/.test(dlgTitle), dlgTitle)
    const hintText = await page.locator('[role="dialog"] .st-hint').innerText()
    check('确认框写明不可撤销与保留范围', /不可撤销/.test(hintText) && /素材卡/.test(hintText), hintText)

    await page.locator('[data-prompt-input]').fill('E02')
    await page.waitForTimeout(200)
    const disabled = await page.locator('[data-prompt-submit]').isDisabled()
    check('输错集号时确认不可用', disabled)
    // 禁用状态下点一次也不能生效
    await page.locator('[data-prompt-submit]').click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    const afterWrong = await readProject()
    check(
      '输错集号时项目镜头不变',
      JSON.stringify(afterWrong.shots?.map((s) => s.id)) === JSON.stringify(before.shots?.map((s) => s.id)),
      String(afterWrong.shots?.length),
    )
    check('输错集号时画布卡片不变', (await nodes()) === 3, String(await nodes()))
    await page.locator('[data-prompt-cancel]').click()
    await page.waitForTimeout(300)

    // ---------------------------------------------------------------- 输对集号
    await openMenu()
    await page.locator('.bm-item:has-text("清空画布")').click()
    await page.locator('[data-prompt-input]').fill('e01')
    await page.waitForTimeout(200)
    check('大小写不敏感也能确认', !(await page.locator('[data-prompt-submit]').isDisabled()))
    await page.locator('[data-prompt-submit]').click()
    await waitNodes(0)

    check('清空后分镜卡清零', (await nodes()) === 0, String(await nodes()))
    check('清空后素材卡保留', (await assetNodes()) === assetsBefore, `${assetsBefore} -> ${await assetNodes()}`)
    check('清空后没有原生确认框', dialogs.length === 0, dialogs.slice(0, 2).join(' / '))

    // ---------------------------------------------------------------- 数据层
    const after = await readProject()
    const afterIds = (after.shots ?? []).map((s) => s.id)
    check('项目里 E01 镜头已删除', !afterIds.some((id) => id.startsWith('E01-')), afterIds.join(','))
    check('其他集镜数不变', afterIds.filter((id) => id.startsWith('E02-')).length === 2, afterIds.join(','))
    // 服务端会补 id / 默认字段，按业务标识比对而不是整段 JSON
    const names = (list) => (list ?? []).map((x) => String(x?.name ?? '')).join(',')
    check('角色不被清空', names(after.characters) === names(before.characters) && names(after.characters) !== '', names(after.characters))
    check('设定不被清空', names(after.designs) === names(before.designs), names(after.designs))
    check(
      '项目素材不被清空',
      (after.assets ?? []).length === (before.assets ?? []).length,
      `${(before.assets ?? []).length} -> ${(after.assets ?? []).length}`,
    )
    const e2s01 = (after.shots ?? []).find((s) => s.id === 'E02-S01')
    check('跨集边界转场被清掉', !e2s01?.transition_out?.to, JSON.stringify(e2s01?.transition_out ?? null))

    // ---------------------------------------------------------------- 服务端快照
    const snaps = shotSnapshots()
    check('服务端留下镜头快照', snaps.length >= 1, snaps.map((s) => s.file).join(','))
    const snapIds = (snaps.at(-1)?.data?.shots ?? []).map((s) => s.id).sort()
    check('快照只含被删的 E01 三镜', snapIds.join(',') === 'E01-S01,E01-S02,E01-S03', snapIds.join(','))
    check('快照能区分是镜头级', snaps.at(-1)?.data?.kind === 'shots', String(snaps.at(-1)?.data?.kind))

    // ---------------------------------------------------------------- agent 读工具 / 导出
    const read = await runTool('read_shots', {})
    const readIds = (read.shots ?? []).map((s) => s.id)
    check('read_shots 不再返回 E01', !readIds.some((id) => id.startsWith('E01-')), readIds.join(','))
    check('read_shots 仍返回 E02', readIds.filter((id) => id.startsWith('E02-')).length === 2, readIds.join(','))

    const epMd = md.episodeMarkdown(after, 1)
    check('导出 md 不含被删镜头的描述', !epMd.text.includes('第 1 集 S01'), epMd.text.slice(0, 120))
    check('导出 md 不含被删镜头的提示词', !epMd.text.includes('雨夜街头，推镜头'), epMd.text.slice(0, 120))
    check('E02 导出仍含自己的镜头', md.episodeMarkdown(after, 2).text.includes('第 2 集 S01'))

    // ---------------------------------------------------------------- 刷新
    await page.waitForTimeout(900)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await landed()
    await page.locator('.board-ep-card[data-board-ep="1"]').waitFor({ state: 'visible', timeout: 20000 })
    await enterEp(1)
    await page.waitForTimeout(900)
    check('刷新后该集仍是空的', (await nodes()) === 0, String(await nodes()))
    check('刷新后素材卡还在', (await assetNodes()) === assetsBefore, `${assetsBefore} -> ${await assetNodes()}`)

    // ---------------------------------------------------------------- 空状态
    await hint.waitFor({ state: 'visible', timeout: 5000 })
    const hintFlat = (await hint.innerText()).replace(/\s+/g, ' ')
    check('空状态说这一集还没有镜头', /E01 还没有镜头/.test(hintFlat), hintFlat)
    check('空状态没有重建按钮', (await hint.getByRole('button', { name: '重建本集卡片' }).count()) === 0)
    check('空状态给新建入口', (await hint.getByRole('button', { name: '新建生图镜' }).count()) === 1)
    check('空状态列出其他集镜数', /E02 · 2 镜/.test(hintFlat), hintFlat)

    // 切到 E02：卡片照常水合
    await hint.getByRole('button', { name: /E02/ }).click()
    await waitNodes(2)
    check('切到 E02 能看到 2 张卡', (await nodes()) === 2, String(await nodes()))

    check('清空链路无脚本错误', errors.length === 0, errors.slice(0, 2).join(' / '))
  } finally {
    await browser.close()
  }

  // ---------------------------------------------------------------- 重启服务
  await stop(child)
  child = spawnVite()
  if (!(await waitHealth(child))) throw new Error('重启后 dev server 没起来')
  const restarted = await readProject()
  const ids = (restarted.shots ?? []).map((s) => s.id)
  check('重启服务后 E01 仍为空', !ids.some((id) => id.startsWith('E01-')), ids.join(','))
  check('重启服务后 E02 仍在', ids.filter((id) => id.startsWith('E02-')).length === 2, ids.join(','))
} finally {
  await stop(child)
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.rmSync(bundleDir, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
