/**
 * 真实写回验收：起一个独立服务实例（临时数据根），用真实工具跑「合并写回 → 读回」。
 *
 * 为什么要临时数据根：验收需要往项目里写卡，绝不能动用户正在用的项目库。
 * 夹具取自现有 `a` 项目的一份 SQLite 备份，所以形状与线上一致（含历史空标识的卡）。
 *
 * 运行前先 `npm run build:server`（服务端是预打包产物）。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = process.cwd()
const LIVE =
  process.env.SB_LIVE_PROJECTS ||
  path.join(os.homedir(), 'Library/Application Support/storyboard-canvas/projects')

if (!fs.existsSync(path.join(REPO, 'server-build/app.mjs'))) {
  console.error('缺少 server-build/app.mjs，请先 npm run build:server')
  process.exit(1)
}
if (!fs.existsSync(path.join(LIVE, 'storyboard.sqlite'))) {
  console.error(`找不到现有项目库：${LIVE}`)
  process.exit(1)
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-design-e2e-'))
const projects = path.join(base, 'projects')
fs.mkdirSync(projects, { recursive: true })

// 用 SQLite 备份接口取一致快照：直接拷 WAL 有可能拿到半提交状态
execFileSync('sqlite3', [path.join(LIVE, 'storyboard.sqlite'), `.backup ${path.join(projects, 'storyboard.sqlite')}`])
const liveA = path.join(LIVE, 'a')
if (fs.existsSync(liveA)) execFileSync('cp', ['-R', liveA, path.join(projects, 'a')])

const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: REPO,
  env: {
    ...process.env,
    SB_PORT: '0',
    SB_PROJECTS_DIR: projects,
    SB_STATE_ROOT: path.join(base, 'state'),
    SB_MEDIA_ROOT: path.join(base, 'media'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`服务启动超时：\n${serverLog}`)), 20_000)
  child.stdout.on('data', (d) => {
    serverLog += String(d)
    const m = serverLog.match(/listening http:\/\/[\d.]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  child.stderr.on('data', (d) => {
    serverLog += String(d)
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：\n${serverLog}`))
  })
})

const BASE = `http://127.0.0.1:${port}`
const realFetch = globalThis.fetch
// 客户端代码用同源相对路径请求；在 node 里补上基地址即可跑真实 HTTP
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' && input.startsWith('/') ? BASE + input : input
  return realFetch(url as RequestInfo, init)
}

let bad = 0
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

async function readProjectA() {
  const r = await realFetch(`${BASE}/api/project?name=a`)
  const j = await r.json()
  assert.equal(j.ok, true, `读取项目失败：${JSON.stringify(j)}`)
  return j.project
}

/** 与 read_asset_inventory 同一套准入规则 */
function visibleScenes(project: { designs?: Array<{ kind?: string; id?: string }> }) {
  return (project.designs || []).filter((d) => d.kind === 'scene' && String(d.id || '').trim())
}

const { createBuiltinPlatformTools } = await import('../src/agent/builtinPlatformTools')

function tools() {
  const all = createBuiltinPlatformTools({ projectName: 'a', epNo: 1 })
  const byName = new Map(all.map((t) => [t.name, t]))
  return byName
}

try {
  await check('启动回填让历史空标识的场景卡重新可见', async () => {
    const p = await readProjectA()
    const scenes = visibleScenes(p)
    assert.equal(scenes.length, 1, '雨夜空地 应已获得标识')
    assert.match(String(scenes[0].id), /^design-scene-/)
    assert.ok(String(scenes[0].image || '').length > 0, '图片字段应保留')
  })

  await check('5.1 同名写回合并：scenes 仍为 1，图片与摘要不被覆盖', async () => {
    const before = await readProjectA()
    const beforeScene = visibleScenes(before)[0]
    const submit = tools().get('submit_designs')
    assert.ok(submit)
    const r = (await submit.run({
      scenes: [{ name: '雨夜空地', summary_cn: '合并校验：不该覆盖旧摘要' }],
    })) as { ok: boolean; counts?: Record<string, number>; error?: string }
    assert.equal(r.ok, true, `写回失败：${r.error}`)
    assert.deepEqual(r.counts, { total: 1, added: 0, updated: 1 })

    const after = await readProjectA()
    const scenes = visibleScenes(after)
    assert.equal(scenes.length, 1, '不得新增重复卡')
    assert.equal(scenes[0].id, beforeScene.id, '标识应沿用')
    assert.equal(scenes[0].image, beforeScene.image, '图片应保留')
    // 合并只补空字段：旧摘要非空才保留，否则采纳本次提交
    assert.equal(scenes[0].summaryCn, beforeScene.summaryCn || '合并校验：不该覆盖旧摘要')

    const inv = (await tools()
      .get('read_asset_inventory')!
      .run({ category: 'scenes', includeRows: true })) as {
      ok: boolean
      total?: number
      rows?: Array<{ key: string; hasImage?: boolean }>
    }
    assert.equal(inv.ok, true)
    assert.equal(inv.total, 1)
    assert.equal(inv.rows?.length, 1)
    assert.equal(inv.rows?.[0].hasImage, true)

    const detail = (await tools()
      .get('read_asset_detail')!
      .run({ category: 'scenes', key: inv.rows![0].key })) as { ok: boolean; error?: string }
    assert.equal(detail.ok, true, `按 key 取详情失败：${detail.error}`)
  })

  await check('5.2 两张新场景同时落库：scenes 从 1 变 3，无唯一约束错误', async () => {
    const submit = tools().get('submit_designs')!
    const r = (await submit.run({
      scenes: [{ name: '天台' }, { name: '走廊' }],
    })) as { ok: boolean; counts?: Record<string, number>; error?: string }
    assert.equal(r.ok, true, `写回失败：${r.error}`)
    assert.deepEqual(r.counts, { total: 2, added: 2, updated: 0 })

    const after = await readProjectA()
    const scenes = visibleScenes(after)
    assert.equal(scenes.length, 3)
    assert.equal(new Set(scenes.map((d) => d.id)).size, 3)

    const inv = (await tools()
      .get('read_asset_inventory')!
      .run({ category: 'scenes', includeRows: true })) as { total?: number }
    assert.equal(inv.total, 3)
  })
} finally {
  child.kill('SIGTERM')
  globalThis.fetch = realFetch
  fs.rmSync(base, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
