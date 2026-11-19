/**
 * 存储与旧数据处理测试（第 7 组）。
 *
 * 覆盖：
 * 7.1 `DSH_HOME` 落在应用数据目录，重启后配置与会话目录仍在；
 * 7.2 工具返回的是路径引用而非二进制（会话记录不该被媒体撑爆）；
 * 7.3 旧创意会话表只读：写入口 410，表里不再新增记录；
 * 7.4 旧自定义专家可导出为包，且能在新结构中导入；
 * 7.5 打开旧会话时给中文说明，而不是空白或堆栈。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(import.meta.dirname, '..')
// 服务跑的是 server-build/app.mjs：先构建，否则测到的是上一版（旧写入口还能写）
execFileSync(
  path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ['server/app.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external', '--outfile=server-build/app.mjs'],
  { cwd: ROOT, stdio: 'inherit' },
)
// 工具桥清单来自 studio-tools 构建产物：专家 preset 的 toolIds 收窄要它
execFileSync(
  path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ['server/studio-tools.ts', '--bundle', '--platform=browser', '--format=esm', '--target=node24', '--outfile=server-build/studio-tools.mjs'],
  { cwd: ROOT, stdio: 'inherit' },
)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-legacy-'))
const STATE = path.join(TMP, 'state')
const TOKEN = 'legacy-internal-token'

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

async function startServer() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      SB_PROJECTS_DIR: TMP,
      SB_STATE_ROOT: STATE,
      SB_MEDIA_ROOT: path.join(TMP, 'media'),
      SB_PORT: '0',
      SB_STUDIO_INTERNAL_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buf = ''
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${buf.slice(-500)}`)), 60_000)
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    proc.stderr.on('data', (chunk) => {
      buf += chunk.toString()
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`服务提前退出（${code}）：${buf.slice(-800)}`))
    })
  })
  return { proc, base: `http://127.0.0.1:${port}`, log: () => buf }
}

const first = await startServer()

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(`${first.base}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-studio-internal': TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, body: json }
}

/* ---------------------------------------------------------------- 7.1 DSH_HOME */

await check('DSH_HOME 落在应用数据目录（状态根下）', async () => {
  const dshHome = path.join(STATE, 'dsh')
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dshHome, 'profiles', 'web', 'package.json')); i += 1) {
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(fs.existsSync(path.join(dshHome, 'profiles', 'web', 'package.json')), 'profile 没落在状态根下')
  assert.ok(dshHome.startsWith(STATE), 'DSH_HOME 不在应用数据目录下')
})

/* ---------------------------------------------------------------- 7.3 / 7.5 旧表只读 */

const dbFile = path.join(TMP, 'storyboard.sqlite')

/** 直接写一条旧会话：模拟升级前留下的历史数据 */
function seedLegacySession() {
  const db = new DatabaseSync(dbFile)
  db.exec('PRAGMA busy_timeout = 5000;')
  db.prepare(
    `INSERT OR REPLACE INTO creative_sessions (id, title, mode, project, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run('legacy-1', '旧会话', 'plan', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  db.prepare(
    `INSERT OR REPLACE INTO creative_threads (session_id, messages, active_skills, updated_at) VALUES (?,?,?,?)`,
  ).run('legacy-1', '[]', '[]', '2026-01-01T00:00:00.000Z')
  db.close()
}

function countSessions() {
  const db = new DatabaseSync(dbFile)
  const row = db.prepare('SELECT COUNT(*) AS n FROM creative_sessions').get()
  db.close()
  return Number(row.n)
}

seedLegacySession()

await check('新建旧会话被拒绝，且返回中文说明', async () => {
  const before = countSessions()
  const r = await call('/api/creative/sessions', { method: 'POST', body: { title: '不该创建' } })
  assert.equal(r.status, 410, `状态码 ${r.status}`)
  assert.match(r.body.message, /已停用/)
  assert.match(r.body.message, /宿主/)
  assert.equal(countSessions(), before, '仍然写入了新会话')
})

await check('写旧线程被拒绝', async () => {
  const r = await call('/api/creative/sessions/legacy-1/thread', {
    method: 'PUT',
    body: { messages: [{ role: 'user', text: 'x' }] },
  })
  assert.equal(r.status, 410)
  assert.match(r.body.message, /已停用/)
})

await check('删除旧会话被拒绝', async () => {
  const r = await call('/api/creative/sessions/legacy-1', { method: 'DELETE' })
  assert.equal(r.status, 410)
  assert.equal(countSessions(), 1, '旧会话被删掉了')
})

await check('旧会话仍可列出与查看（只读保留）', async () => {
  const list = await call('/api/creative/sessions')
  assert.ok(list.body.sessions.some((s) => s.id === 'legacy-1'), '列表里看不到旧会话')
})

await check('打开旧会话给出中文说明，而不是空白或堆栈', async () => {
  const r = await call('/api/creative/sessions/legacy-1')
  assert.equal(r.status, 200)
  assert.equal(r.body.session.openable, false)
  assert.match(r.body.session.notice, /旧版创意会话/)
  assert.doesNotMatch(r.body.session.notice, /at .*\(.*:\d+:\d+\)/, '说明里混进了堆栈')
})

/* ---------------------------------------------------------------- 7.2 媒体只存引用 */

await check('工具结果只有路径引用，没有内联二进制', async () => {
  const r = await call('/api/studio/tools/execute', {
    method: 'POST',
    body: { project: '', episode: 1, tool: 'list_installed_skills', args: {} },
  })
  assert.equal(r.status, 200)
  const text = JSON.stringify(r.body)
  assert.ok(!/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(text), '结果里出现了 data: base64')
  const bigBase64 = /[A-Za-z0-9+/]{2048,}={0,2}/
  assert.ok(!bigBase64.test(text), '结果里出现了超长内联二进制块')
})

await check('会话媒体目录在 creatives/<会话>/ 下且按绝对路径解析', async () => {
  const mod = await import('../server/creative.mjs')
  const dir = mod.sessionDir(TMP, 'legacy-1')
  assert.ok(path.isAbsolute(dir), '不是绝对路径')
  assert.ok(dir.includes(`${path.sep}creatives${path.sep}legacy-1`), `目录不对：${dir}`)
})

/* ---------------------------------------------------------------- 7.4 旧专家导出 */

await check('自定义专家导出为包后可重新导入（新结构）', async () => {
  const { saveCustomExperts, listAllExperts } = await import('../server/experts.mjs')
  const { dbPath } = await import('../server/db.mjs')
  process.env.SB_STATE_ROOT = STATE
  dbPath(TMP)
  const expert = {
    id: 'legacy-export-test',
    name: '待导出专家',
    soul: '你是待导出的旧专家。',
    skillIds: ['short-drama'],
    toolIds: ['read_source'],
  }
  saveCustomExperts([expert])
  const custom = listAllExperts().filter((e) => e.source === 'custom')
  assert.ok(custom.length >= 1, '自定义专家没读到')
  const { expertsBundleToZipBuffer, expertsFromZipBuffer } = await import('../server/expertZip.mjs')
  const zip = expertsBundleToZipBuffer(custom)
  const back = expertsFromZipBuffer(zip)
  const found = back.find((e) => e.id === expert.id)
  assert.ok(found, '导出包里没有该专家')
  assert.equal(found.soul, expert.soul)
  assert.deepEqual(found.skillIds, expert.skillIds)
  saveCustomExperts([])
})

/* ---------------------------------------------------------------- 8.1 创意入口开关 */

await check('开关关闭后 /studio/ 拒绝进入并给出中文说明', async () => {
  const off = await call('/api/studio/enabled', { method: 'POST', body: { enabled: false } })
  assert.equal(off.status, 200)
  assert.equal(off.body.enabled, false)
  const r = await fetch(`${first.base}/studio/`)
  assert.equal(r.status, 503)
  const body = await r.json()
  assert.match(body.message, /已停用/)
})

await check('开关状态可读回，重新打开立即恢复', async () => {
  const read = await call('/api/studio/enabled')
  assert.equal(read.body.enabled, false)
  const on = await call('/api/studio/enabled', { method: 'POST', body: { enabled: true } })
  assert.equal(on.body.enabled, true)
  const read2 = await call('/api/studio/enabled')
  assert.equal(read2.body.enabled, true)
})

await check('前端在开关关闭时隐藏创意入口', async () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
  assert.match(app, /hiddenViews=\{studioEnabled \? \[\] : \['creative'\]\}/)
  const nav = fs.readFileSync(path.join(ROOT, 'src/shell/SideNav.tsx'), 'utf8')
  assert.match(nav, /!hiddenViews\.includes\(i\.id\)/)
})

await check('重启后宿主配置与专家 preset 仍在', async () => {
  const patch = path.join(STATE, 'dsh', 'profiles', 'web', 'creative-experts.patch.yml')
  // 专家同步是异步的（要等工具清单构建），给一点时间而不是抢跑
  for (let i = 0; i < 50 && !fs.existsSync(patch); i += 1) await new Promise((r) => setTimeout(r, 100))
  assert.ok(fs.existsSync(patch), '专家 patch 不在配置目录')
  const before = fs.readFileSync(patch, 'utf8')
  first.proc.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  const second = await startServer()
  try {
    assert.equal(fs.readFileSync(patch, 'utf8'), before, '重启后 preset 内容变了')
    // 新进程读到的是同一份配置：列表接口仍能返回专家
    const r = await fetch(`${second.base}/api/studio/experts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-internal': TOKEN },
      body: '{}',
    })
    assert.equal(r.status, 200)
    const body = await r.json()
    assert.ok(body.experts.length >= 1, '重启后专家列表空了')
  } finally {
    second.proc.kill('SIGTERM')
  }
})


first.proc.kill('SIGTERM')

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n存储与旧数据测试全部通过')
process.exit(0)
