/**
 * 画布几何持久化验收（`canvas-layout-persistence` 的 4.6 验收脚本）。
 *
 * 复现的正是桌面端丢参考连线的那条路径：
 * 本地服务端口每次启动都不同 → `localStorage` 按 origin 隔离 → 节点按栅格重排、
 * 素材卡换新 uid → `shot.refIds` 里的 `asset-<uid>` 对不上。
 * 所以这里刻意让两个服务跑在不同端口、共用同一个项目目录，断言两次读到的
 * canvas 行与素材卡身份完全一致，并且镜头里的 refIds 既没被改写也没被清空。
 *
 * 跑法：node verify-canvas-persist.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-persist-'))
// 必须在导入 db.mjs 之前设置：resolveRoot 读的是环境变量
process.env.SB_PROJECTS_DIR = TMP

const PROJECT = 'canvas-persist'
const CID = 'cid-persist-1'
const ASSET_NODE_ID = `asset-${CID}`
const ASSET_KEY = `asset:${CID}`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const dbm = await import('./server/db.mjs')

// ---------------------------------------------------------------- 种子

dbm.createProject(TMP, PROJECT, { title: '画布持久化' })
dbm.writeProject(TMP, PROJECT, {
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '第一镜', refIds: [ASSET_NODE_ID] },
    { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, desc: '第二镜' },
  ],
  assets: [{ kind: 'image', title: '参考图', url: '', canvasId: CID }],
  canvas: [
    { key: 'shot:E01-S01', x: 40, y: 20 },
    { key: 'shot:E01-S02', x: 420, y: 20 },
    { key: ASSET_KEY, x: 120, y: -220 },
  ],
})

const expectedCanvas = [
  { key: ASSET_KEY, x: 120, y: -220 },
  { key: 'shot:E01-S01', x: 40, y: 20 },
  { key: 'shot:E01-S02', x: 420, y: 20 },
]
const sameCanvas = (rows) => JSON.stringify(rows) === JSON.stringify(expectedCanvas)

// ---------------------------------------------------------------- 服务

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

const startServer = async () => {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
  )
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/api/health`)
      if (r.ok) return { base, child, port }
    } catch {
      /* 等下一轮 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  child.kill()
  throw new Error(`临时 dev server 启动失败：${base}`)
}

const stopServer = (s) => {
  try {
    s.child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
}

const api = async (base, p, init) => {
  const r = await fetch(`${base}${p}`, init)
  let json = null
  try {
    json = await r.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: r.status, json }
}

const postJson = (base, body) =>
  api(base, `/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const getProject = async (base, name = PROJECT) =>
  (await api(base, `/api/project?name=${encodeURIComponent(name)}`)).json?.project

let server = null
let browser = null

try {
  // ---------------------------------------------------------------- 1. API：两次启动端口不同，数据一致
  console.log('\n== 1. 端口无关的持久化 ==')

  server = await startServer()
  const first = await getProject(server.base)
  check('首次读取布局与种子一致（按 key 排序）', sameCanvas(first?.canvas), JSON.stringify(first?.canvas))
  check('素材卡带回 canvasId', first?.assets?.[0]?.canvasId === CID, JSON.stringify(first?.assets?.[0]))
  check('镜头 refIds 指向素材卡节点 id', (first?.shots?.[0]?.refIds ?? []).includes(ASSET_NODE_ID))

  // 拖一张卡：只提交这一行
  const moved = await postJson(server.base, { canvas: [{ key: 'shot:E01-S01', x: 480, y: 120 }] })
  check('写单行布局 200', moved.status === 200, `status=${moved.status}`)
  const afterMove = await getProject(server.base)
  check(
    '单行写入不影响其余行',
    afterMove?.canvas?.length === 3 && afterMove.canvas.find((c) => c.key === 'shot:E01-S01')?.x === 480,
    JSON.stringify(afterMove?.canvas),
  )

  const badKey = await postJson(server.base, { canvas: [{ key: 'bogus:x', x: 0, y: 0 }] })
  check('非法 key 400', badKey.status === 400, `status=${badKey.status}`)
  const badCoord = await postJson(server.base, { canvas: [{ key: 'shot:E01-S01', x: '左', y: 0 }] })
  check('非数字坐标 400', badCoord.status === 400, `status=${badCoord.status}`)

  // 整表替换 assets 但漏带 canvasId：身份必须沿用，否则参考连线立刻断
  const replaced = await postJson(server.base, {
    assets: [{ kind: 'image', title: '参考图', url: '' }],
  })
  check('整表替换 assets 200', replaced.status === 200, `status=${replaced.status}`)
  const kept = await getProject(server.base)
  check('漏带 canvasId 时身份沿用', kept?.assets?.[0]?.canvasId === CID, JSON.stringify(kept?.assets?.[0]))

  // 换端口重启：这是桌面端的真实场景
  const before = JSON.stringify({ canvas: kept?.canvas, assets: kept?.assets, refIds: kept?.shots?.[0]?.refIds })
  stopServer(server)
  server = await startServer()
  const second = await getProject(server.base)
  check('换端口后端口不同', second !== null)
  check(
    '换端口后布局与素材身份逐字一致',
    JSON.stringify({ canvas: second?.canvas, assets: second?.assets, refIds: second?.shots?.[0]?.refIds }) === before,
    JSON.stringify(second?.canvas),
  )

  // ---------------------------------------------------------------- 2. 浏览器：卡片 id 稳定、拖动只发一次、连线还在
  console.log('\n== 2. 画布交互 ==')

  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const posts = []
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('/api/project')) return
    let body = {}
    try {
      body = JSON.parse(req.postData() || '{}')
    } catch {
      /* 非 JSON */
    }
    posts.push(body)
  })

  const openProject = async (name = PROJECT) => {
    // 画布是两阶段的：先到集目录，点进第一集才是 Flow。
    // 同地址才 reload：hash 跳到新地址时路由会自己重挂载，先 goto 再 reload 会打断
    // 上一次加载（旧页面的在途写回仍会落库），把迁移刚写好的身份覆盖成新 uid。
    const target = `${server.base}/#/p/${name}/board`
    if (page.url() === target) await page.reload({ waitUntil: 'domcontentloaded' })
    else await page.goto(target, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-board-ep="1"]', { timeout: 20000 })
    await page.click('[data-board-ep="1"]')
    await page.waitForSelector('.react-flow__node', { timeout: 20000 })
    // onlyRenderVisibleElements 开着：先适配视图，保证素材卡与参考连线都在视野内
    await page.click('.react-flow__controls-fitview').catch(() => {})
    await page.waitForTimeout(600)
  }

  // 参考连线的 id 是 `ref-<token>-<分镜节点 id>`，分镜节点 id 是随机 uid，只能按前缀找
  const REF_EDGE = `[data-id^="ref-${ASSET_NODE_ID}-"]`

  const transformOf = async (id) => {
    const el = await page.$(`[data-id="${id}"]`)
    if (!el) return null
    const style = await el.evaluate((n) => n.style.transform || '')
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(style)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }

  await openProject()
  const assetPos = await transformOf(ASSET_NODE_ID)
  check('素材卡节点 id 由 canvasId 派生', Boolean(await page.$(`[data-id="${ASSET_NODE_ID}"]`)))
  check('素材卡位置取自项目布局', assetPos?.x === 120 && assetPos?.y === -220, JSON.stringify(assetPos))
  const refEdge = await page.$(`${REF_EDGE}`)
  check('参考连线在载入后存在', Boolean(refEdge))

  // 载入不应改写 refIds
  const afterLoad = await getProject(server.base)
  check(
    '载入后 refIds 未被清理',
    (afterLoad?.shots?.find((s) => s.id === 'E01-S01')?.refIds ?? []).includes(ASSET_NODE_ID),
    JSON.stringify(afterLoad?.shots?.[0]?.refIds),
  )

  // 拖动一张素材卡：只应产生一次布局写回，且只含这一行
  await page.waitForTimeout(1600)
  posts.length = 0
  const box = await page.$eval(`[data-id="${ASSET_NODE_ID}"]`, (n) => {
    const r = n.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w / 2 + 140, box.y + box.h / 2 + 80, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1400)

  const layoutPosts = posts.filter((b) => Array.isArray(b.canvas) || Array.isArray(b.canvasDelete))
  check('拖动后只发一次布局写回', layoutPosts.length === 1, `posts=${layoutPosts.length}`)
  check(
    '请求体只含被拖动的那一行',
    layoutPosts[0]?.canvas?.length === 1 && layoutPosts[0]?.canvas?.[0]?.key === ASSET_KEY,
    JSON.stringify(layoutPosts[0]?.canvas),
  )

  const draggedTo = await transformOf(ASSET_NODE_ID)
  const persisted = await getProject(server.base)
  const row = persisted?.canvas?.find((c) => c.key === ASSET_KEY)
  check(
    '拖动结果已落库且与画布一致',
    row && draggedTo && Math.abs(row.x - draggedTo.x) < 1 && Math.abs(row.y - draggedTo.y) < 1,
    `${JSON.stringify(row)} vs ${JSON.stringify(draggedTo)}`,
  )

  // 重新载入：id 与位置都不变，参考连线仍在
  await openProject()
  const afterReload = await transformOf(ASSET_NODE_ID)
  check('重新载入后素材卡 id 不变', Boolean(await page.$(`[data-id="${ASSET_NODE_ID}"]`)))
  check(
    '重新载入后位置不变',
    afterReload && draggedTo && Math.abs(afterReload.x - draggedTo.x) < 1 && Math.abs(afterReload.y - draggedTo.y) < 1,
    `${JSON.stringify(afterReload)} vs ${JSON.stringify(draggedTo)}`,
  )
  check('重新载入后参考连线仍在', Boolean(await page.$(`${REF_EDGE}`)))
  const finalProject = await getProject(server.base)
  check(
    '全程 refIds 未被清理',
    (finalProject?.shots?.find((s) => s.id === 'E01-S01')?.refIds ?? []).includes(ASSET_NODE_ID),
  )

  // ---------------------------------------------------------------- 3. 存量 v1 本地画布的一次性迁移
  console.log('\n== 3. 旧本地画布迁移 ==')

  const LEGACY = 'legacy-canvas'
  dbm.createProject(TMP, LEGACY, { title: '旧画布' })
  dbm.writeProject(TMP, LEGACY, {
    shots: [
      { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '一', refIds: ['asset-legacy-uid-1'] },
      { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, desc: '二' },
    ],
    // 旧库里的素材卡还没有画布身份
    assets: [{ kind: 'image', title: '参考图', url: '' }],
  })
  const legacyKey = `storyboard-canvas-v1:${encodeURIComponent(LEGACY)}`
  const legacyPayload = {
    nodes: [
      { id: 'asset-legacy-uid-1', type: 'asset', position: { x: 200, y: -300 }, data: { title: '参考图', kind: 'image', url: '' } },
      // 指向一张素材库里已经没有的卡：迁移报告必须点名，而不是静默丢掉
      { id: 'asset-legacy-gone', type: 'asset', position: { x: 500, y: -300 }, data: { title: '已删除的卡', kind: 'image', url: '' } },
      // 无业务 id 的遗留节点
      { id: 'S99', type: 'shot', position: { x: 0, y: 600 }, data: { no: 'S99', seconds: 3 } },
      { id: 'uid-shot-1', type: 'shot', position: { x: 700, y: 90 }, data: { shotId: 'E01-S02', no: 'S02', seconds: 3 } },
    ],
    edges: [{ id: 'keep-me', source: 'uid-shot-1', target: 'uid-shot-1', type: 'shot' }],
    characters: [],
    epNo: 1,
  }

  await page.goto(`${server.base}/#/`)
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key, raw),
    [legacyKey, JSON.stringify(legacyPayload)],
  )
  await openProject(LEGACY)
  await page.waitForTimeout(800)
  const toastText = await page.evaluate(() => document.body.innerText)

  const migrated = await getProject(server.base, LEGACY)
  const legacyAsset = migrated?.assets?.[0]
  check('迁移后素材卡拿到旧节点 uid', legacyAsset?.canvasId === 'legacy-uid-1', JSON.stringify(legacyAsset))
  const legacyCanvas = migrated?.canvas ?? []
  check(
    '迁移写入素材卡位置',
    JSON.stringify(legacyCanvas.find((c) => c.key === 'asset:legacy-uid-1')) === JSON.stringify({ key: 'asset:legacy-uid-1', x: 200, y: -300 }),
    JSON.stringify(legacyCanvas),
  )
  check(
    '迁移写入分镜位置',
    legacyCanvas.find((c) => c.key === 'shot:E01-S02')?.x === 700,
    JSON.stringify(legacyCanvas),
  )
  check('迁移不写无业务 id 的遗留节点', !legacyCanvas.some((c) => c.x === 0 && c.y === 600), JSON.stringify(legacyCanvas))
  check('迁移报告在界面上可见', toastText.includes('已把旧画布'), toastText.slice(0, 80))
  check('报告点名未匹配的素材卡', toastText.includes('已删除的卡'), toastText.slice(0, 120))

  const legacyLeft = await page.evaluate(
    ([live, backup]) => ({
      live: localStorage.getItem(live),
      backup: localStorage.getItem(backup),
    }),
    [legacyKey, `${legacyKey}:legacy-backup`],
  )
  check('旧存档改名保留为备份', Boolean(legacyLeft.backup) && JSON.parse(legacyLeft.backup).nodes.length === 4)
  check('项目存档降级为 v2 缓存', JSON.parse(legacyLeft.live)?.version === 2 && !('nodes' in JSON.parse(legacyLeft.live)))
  check('边在降级后保留', JSON.parse(legacyLeft.live)?.edges?.length === 1)

  // 再打开一次：已经有布局行，迁移不该再跑一遍
  await openProject(LEGACY)
  await page.waitForTimeout(600)
  const again = await getProject(server.base, LEGACY)
  check(
    '重复打开不重复迁移',
    again?.canvas?.length === legacyCanvas.length && again?.assets?.[0]?.canvasId === 'legacy-uid-1',
    JSON.stringify(again?.canvas),
  )

  // ---------------------------------------------------------------- 4. 反向：refIds 指向不存在的素材卡
  console.log('\n== 4. 孤儿参考不崩溃 ==')

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))

  const cur = await getProject(server.base)
  const shotCount = (cur?.shots ?? []).filter((s) => s.episode === 1).length
  const ghost = await postJson(server.base, {
    shots: (cur?.shots ?? []).map((s) =>
      s.id === 'E01-S01' ? { ...s, refIds: ['asset-ghost-missing', ASSET_NODE_ID] } : s,
    ),
  })
  check('写入孤儿参考 200', ghost.status === 200, `status=${ghost.status}`)

  await openProject()
  const nodeCount = await page.$$eval('.react-flow__node', (ns) => ns.length)
  check('孤儿参考不影响画布渲染', nodeCount >= shotCount + 1, `nodes=${nodeCount}`)
  check('有效的参考连线仍在', Boolean(await page.$(`${REF_EDGE}`)))
  check('页面上没有未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))

  const withGhost = await getProject(server.base)
  const ghostRefs = withGhost?.shots?.find((s) => s.id === 'E01-S01')?.refIds ?? []
  check(
    '载入不会静默清理孤儿 refIds',
    ghostRefs.includes('asset-ghost-missing') && ghostRefs.includes(ASSET_NODE_ID),
    JSON.stringify(ghostRefs),
  )
  check(
    '其余镜头的 refIds 未受影响',
    (withGhost?.shots ?? []).filter((s) => s.id !== 'E01-S01').every((s) => !(s.refIds ?? []).includes('asset-ghost-missing')),
  )
} finally {
  if (browser) await browser.close().catch(() => {})
  if (server) stopServer(server)
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 画布几何持久化全部通过')
process.exit(bad ? 1 : 0)
