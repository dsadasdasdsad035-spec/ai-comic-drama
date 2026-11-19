/**
 * 集成验收（任务 9.1–9.5）。
 *
 * 这里只放「不需要真实渠道 Key」也能证明的链路：把模型门面指到应用自带的
 * Mock 渠道，用 `dsh headless` 真的跑一次模型回合，于是下面这些都成了可断言事实：
 *
 * - 9.1 连续两轮落在同一个会话里（第二轮 `--session-id` 续上），会话文件里两段原文都在，
 *       且合成配置里挂着自动压缩 —— 长会话不会无界增长。
 * - 9.3 一轮内并行调两个工具：工具桥并发执行互不串结果，摘要与详情各归各位。
 * - 9.4 宿主中途死掉：反代给出可读失败而不是挂住，重试后能恢复。
 * - 9.5 关掉入口开关：`/studio/` 立刻 503 且给出中文原因，旧创意会话仍能读取。
 *
 * 真实出图出片与账本结算要渠道 Key，按 `docs/creative-host.md` 手测。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-integration-'))
const STATE = path.join(TMP, 'state')
const DSH_HOME = path.join(STATE, 'dsh')
const GATEWAY_KEY = 'integration-gateway-key'
const INTERNAL_TOKEN = 'integration-internal-token'

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

const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: TMP,
    SB_STATE_ROOT: STATE,
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    SB_STUDIO_GATEWAY_KEY: GATEWAY_KEY,
    SB_STUDIO_INTERNAL_TOKEN: INTERNAL_TOKEN,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`启动超时：${log.slice(-800)}`)), 60_000)
  proc.stdout.on('data', (c) => {
    log += c.toString()
    const m = log.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  proc.stderr.on('data', (c) => {
    log += c.toString()
  })
  proc.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${log.slice(-800)}`))
  })
})
const base = `http://127.0.0.1:${port}`

/** 把默认文本模型换成 Mock：这条路径不访问外网，也不需要 Key */
async function useMockModel() {
  const cur = (await (await fetch(`${base}/api/settings`)).json()).settings
  const providers = cur.providers.map((p) => (p.id === 'openai' ? { ...p, apiKey: 'mock' } : p))
  const models = [
    { key: 'mock-text', label: 'Mock 文本', cap: 'text', provider: 'openai', model: 'gpt-4o-mini' },
    ...cur.models.filter((m) => m.key !== 'mock-text'),
  ]
  const res = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providers,
      models,
      defaults: { ...(cur.defaults || {}), text: 'mock-text', textPro: 'mock-text' },
      stageModels: { ...(cur.stageModels || {}), creative: 'mock-text' },
    }),
  })
  const body = await res.json()
  assert.equal(body.ok, true, `保存设置失败：${body.message || res.status}`)
}

async function waitHostReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = await (await fetch(`${base}/studio/_host/status`)).json()
    if (s.state === 'ready') return s
    if (s.state === 'failed') throw new Error(`宿主启动失败：${s.error || '未知'}｜${s.log || ''}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`宿主未就绪：${log.slice(-800)}`)
}

await fetch(`${base}/studio/`).catch(() => {})
await useMockModel()
await fetch(`${base}/studio/`).catch(() => {})
await waitHostReady()

const profilePatch = path.join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
const dshBin = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** 真实模型回合：把宿主用的同一份模型配置交给 headless 跑一次 */
function headless(task, extra = []) {
  return execFileSync(process.execPath, [dshBin, '--profile', 'headless', '--patch', profilePatch, '--json', ...extra, task], {
    cwd: ROOT,
    env: { ...process.env, DSH_HOME, SB_STUDIO_GATEWAY_KEY: GATEWAY_KEY, SB_STUDIO_INTERNAL_TOKEN: INTERNAL_TOKEN },
    timeout: 180_000,
    encoding: 'utf8',
  })
}

function parseEvents(out) {
  return String(out)
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

let sessionId = ''

await check('9.1 模型回合真的走通：门面 → 应用 → Mock 渠道', async () => {
  let out = ''
  let error = ''
  try {
    out = headless('说一句你好')
  } catch (e) {
    error = `${e?.stderr || ''}${e?.message || ''}`
  }
  assert.ok(!error, `headless 失败：${error.slice(0, 600)}`)
  const events = parseEvents(out)
  const final = events.find((e) => e.type === 'final')
  assert.ok(final, `没有 final 事件：${out.slice(0, 400)}`)
  const kind = String(final.reason?.kind || '')
  assert.ok(kind === 'ok' || kind === 'completed', `回合失败：${JSON.stringify(final.reason)}`)
  assert.match(String(final.text), /本地 Mock/, `回复不是 Mock 内容：${final.text}`)
  sessionId = String(final.sessionId || '')
  assert.ok(sessionId, '没有拿到会话 id')
})

await check('9.1 第二轮续上同一会话：原文仍在，历史不丢', async () => {
  assert.ok(sessionId, '上一轮没拿到会话 id')
  const out = headless('再说一句第二句', ['--session-id', sessionId])
  const final = parseEvents(out).find((e) => e.type === 'final')
  const kind = String(final?.reason?.kind || '')
  assert.ok(kind === 'ok' || kind === 'completed', `第二轮失败：${JSON.stringify(final?.reason)}`)
  assert.equal(String(final.sessionId), sessionId, '第二轮换了会话')
  const files = fs
    .readdirSync(path.join(DSH_HOME, 'sessions'), { recursive: true })
    .map(String)
    .filter((f) => {
      try {
        return fs.statSync(path.join(DSH_HOME, 'sessions', f)).isFile()
      } catch {
        return false
      }
    })
  const hit = files.find((f) => f.includes(sessionId) && f.endsWith('.jsonl.zstd'))
  assert.ok(hit, `DSH_HOME 下找不到会话「${sessionId}」的落盘文件`)
  // 会话日志是 zstd 压缩的 JSONL：解压后必须同时看到两轮原文
  const raw = fs.readFileSync(path.join(DSH_HOME, 'sessions', hit))
  const text = zstdDecompressSync(raw).toString('utf8')
  assert.match(text, /说一句你好|本地 Mock/, '会话文件里没有第一轮原文')
  assert.match(text, /再说一句第二句/, '会话文件里没有第二轮原文')
})

await check('9.1 合成配置里挂着自动压缩，专家 preset 带 persona', () => {
  const dump = execFileSync(process.execPath, [dshBin, '--profile', 'headless', '--patch', profilePatch, '--dump-config'], {
    cwd: ROOT,
    env: { ...process.env, DSH_HOME, SB_STUDIO_GATEWAY_KEY: GATEWAY_KEY },
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.match(dump, /dsh-compaction-basic/, '合成配置里没有自动压缩')
  // 专家 preset 是 web profile 的叠加层：persona 应该在那一份里
  const experts = fs.readFileSync(path.join(DSH_HOME, 'profiles', 'web', 'creative-experts.patch.yml'), 'utf8')
  assert.match(experts, /@deepseek-ai\/dsh-persona/, '专家 preset 里没有 persona')
  assert.match(experts, /complete: true/, 'persona 没有声明 complete（会退回通用壳）')
})

await check('9.2 新建窄口专家后，preset 只放行它声明的工具与技能', async () => {
  const put = await (
    await fetch(`${base}/api/experts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experts: [
          {
            id: 'expert-narrow',
            name: '窄口专家',
            description: '只允许读分镜与读技能',
            soul: '你只做分镜只读核对。',
            skillIds: ['short-drama'],
            toolIds: ['read_shots', 'read_skill_text'],
          },
        ],
      }),
    })
  ).json()
  assert.equal(put.ok, true, `保存专家失败：${put.message || ''}`)

  const expertPatch = path.join(DSH_HOME, 'profiles', 'web', 'creative-experts.patch.yml')
  let text = ''
  for (let i = 0; i < 40; i += 1) {
    text = fs.existsSync(expertPatch) ? fs.readFileSync(expertPatch, 'utf8') : ''
    if (text.includes('expert-narrow')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.match(text, /expert-narrow/, '窄口专家没有进宿主 preset')
  const block = text.slice(text.indexOf('expertId: expert-narrow'))
  const toolIds = [...block.matchAll(/^ {16}- (\w+)$/gm)].map((m) => m[1])
  // 系统保底项只有「列专家」；list_installed_skills 不再强制注入，
  // 所以可见集 = list_experts + 专家自己声明的子集
  assert.deepEqual(
    toolIds.sort(),
    ['list_experts', 'read_shots', 'read_skill_text'],
    `工具没有收紧：${toolIds.join(',')}`,
  )
  assert.match(text, /dsh-plugin-creative-expert/, '专家 patch 没有挂白名单插件')
})

await check('9.3 一轮内并行两个工具：互不串结果，摘要与详情各归各位', async () => {
  const call = (name, args) =>
    fetch(`${base}/api/studio/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-internal': INTERNAL_TOKEN },
      body: JSON.stringify({ project: '', episode: 1, name, args }),
    }).then((r) => r.json())
  const [a, b] = await Promise.all([call('list_installed_skills', {}), call('list_experts', {})])
  assert.equal(a.ok, true, `list_installed_skills 失败：${a.error || ''}`)
  assert.equal(b.ok, true, `list_experts 失败：${b.error || ''}`)
  assert.ok(Array.isArray(a.details?.skills), '技能清单没进详情')
  const summary = a.summary
  assert.ok(
    (typeof summary === 'object' && summary !== null) || (typeof summary === 'string' && summary.length > 0),
    '技能清单没有模型可见摘要',
  )
  assert.ok(!JSON.stringify(summary).includes('"attachments"'), '详情字段漏进了摘要')
})

await check('9.4 宿主中途死掉：请求不挂住，且能自动恢复到就绪', async () => {
  const before = await waitHostReady()
  // 直接杀掉宿主子进程，模拟崩溃
  const pids = execFileSync('lsof', ['-ti', `tcp:${before.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  assert.ok(pids.length > 0, `找不到监听 ${before.port} 的宿主进程`)
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      /* 已经退了 */
    }
  }
  // 断线期间的请求必须有响应（可读失败或有壳），不能无限挂住
  const started = Date.now()
  const during = await fetch(`${base}/studio/`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) }).catch(() => null)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 8_000, `断线期间请求挂住了 ${elapsed}ms`)
  assert.ok(during !== null, '断线期间的请求没有得到任何响应')

  // 宿主管理器负责重启：最终必须回到 ready，而不是停在 failed
  const recovered = await waitHostReady(120_000)
  assert.ok(recovered.restarts >= 1 || recovered.state === 'ready', '宿主没有恢复')
})

await check('9.5 关掉入口开关：/studio/ 立刻 503 且原因可读，旧会话仍可读', async () => {
  const off = await (
    await fetch(`${base}/api/studio/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
  ).json()
  assert.equal(off.enabled, false, '开关没关掉')
  const res = await fetch(`${base}/studio/`, { redirect: 'manual' })
  assert.equal(res.status, 503, `/studio/ 应返回 503，实际 ${res.status}`)
  const body = await res.json().catch(() => ({}))
  assert.match(String(body.message || ''), /已停用/, `说明不可读：${JSON.stringify(body)}`)
  // 回滚演练：旧创意会话（只读）不受开关影响
  const sessions = await (await fetch(`${base}/api/creative/sessions`)).json()
  assert.equal(sessions.ok, true, '旧会话列表读不到')

  const on = await (
    await fetch(`${base}/api/studio/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
  ).json()
  assert.equal(on.enabled, true, '开关没打开')
  await fetch(`${base}/studio/`).catch(() => {})
  await waitHostReady()
})

proc.kill('SIGTERM')

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n集成验收通过（真实出图出片与账本结算需渠道 Key，按 docs/creative-host.md 手测）')
process.exit(0)
