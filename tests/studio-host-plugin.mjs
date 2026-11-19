/**
 * 真实宿主加载工具桥插件的集成测试。
 *
 * 证明三件不能靠桩证明的事：
 * 1. profile patch 里按绝对路径写的插件，dsh 真的能加载；
 * 2. 插件能回调应用拿到工具清单（内部令牌经环境变量传入，没写进配置文件）；
 * 3. 加载失败不会静默：日志里没有注册成功就是测试失败。
 *
 * 依赖本机已安装 `@deepseek-ai/dsh`；未安装时跳过。
 */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCreativeHost, isDshInstalled } from '../server/creative-host.mjs'
import { writeStudioProfile, profilePatchPath } from '../server/studio-profile.mjs'
import { installCreativeToolsBundle, profileDir } from '../server/dsh-bundle.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

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

if (!isDshInstalled(ROOT)) {
  console.log('⚠️  跳过真实宿主插件加载测试：未安装 @deepseek-ai/dsh')
  process.exit(0)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-host-plugin-'))
const PROJECT = 'host-plugin-fixture'
const TOKEN = 'host-plugin-internal-token'

const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `
import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'data.mjs'))}
createProject(${JSON.stringify(TMP)}, ${JSON.stringify(PROJECT)}, { title: '宿主插件夹具' })
writeProject(${JSON.stringify(TMP)}, ${JSON.stringify(PROJECT)}, {
  source: '宿主插件夹具原文',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'E01-S01', seconds: 3, size: '中景', desc: '街口' }],
  characters: [],
  designs: [],
})
console.log('ok')
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP } })

// ---- 起应用：插件要回调它 ----
const app = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: TMP,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    SB_STUDIO_INTERNAL_TOKEN: TOKEN,
    SB_CREATIVE_STUDIO: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const appLogs = []

const appPort = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('应用启动超时')), 60_000)
  let buf = ''
  app.stdout.on('data', (c) => {
    buf += c.toString()
    appLogs.push(...c.toString().split('\n').filter(Boolean))
    const m = buf.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  app.stderr.on('data', (c) => (buf += c.toString()))
  app.on('exit', (code) => reject(new Error(`应用提前退出（${code}）：${buf}`)))
})
const base = `http://127.0.0.1:${appPort}`

// ---- 写 profile：模型 + 工具桥插件 ----
const dshHome = path.join(TMP, 'dsh')
writeStudioProfile({
  dshHome,
  gatewayBaseUrl: `${base}/v1`,
  models: [{ id: 'sb/default', key: 'default' }],
  defaultModelId: 'sb/default',
})
installCreativeToolsBundle({ dshHome, root: ROOT })

const logs = []
const host = createCreativeHost({
  root: ROOT,
  dshHome,
  publicUrl: `http://127.0.0.1:${appPort}/studio/`,
  trustedHosts: [`127.0.0.1:${appPort}`],
  readyTimeoutMs: 120_000,
  // 令牌只走环境变量；配置文件里只有 baseUrl
  env: { SB_STUDIO_INTERNAL_TOKEN: TOKEN, SB_STUDIO_BASE_URL: base },
  log: (line) => {
    logs.push(String(line))
  },
})

await check('profile 里登记了工具桥 bundle，且不含内部令牌', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(dshHome), 'package.json'), 'utf8'))
  assert.ok(manifest.dsh.profile.bundles.includes('dsh-plugin-creative-tools'), 'bundle 未登记')
  assert.ok(
    fs.existsSync(path.join(profileDir(dshHome), 'node_modules', 'dsh-plugin-creative-tools', 'index.js')),
    '插件文件没装进 profile',
  )
  const raw = fs.readFileSync(profilePatchPath(dshHome), 'utf8')
  assert.ok(!raw.includes(TOKEN), '内部令牌不该落到配置文件里')
})

let started = false
try {
  started = await host.start()
} catch (e) {
  logs.push(`start 异常：${e?.message || String(e)}`)
}

await check('宿主带插件正常启动', async () => {
  assert.equal(started, true, `启动失败：\n${logs.slice(-15).join('\n')}`)
  assert.equal(host.status().state, 'ready')
})

await check('插件注册数量可由应用状态接口查到（失败不静默）', async () => {
  // 插件注册是异步的：宿主 ready 之后还要拉一次清单，这里给一点时间
  let payload = null
  for (let i = 0; i < 100; i += 1) {
    const res = await fetch(`${base}/studio/_host/status`)
    if (res.status !== 401) {
      payload = await res.json()
      if (payload.tools?.count) break
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.ok(payload?.tools, '状态里没有工具桥信息')
  const catalog = await (
    await fetch(`${base}/api/studio/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-internal': TOKEN },
      body: JSON.stringify({ project: PROJECT, episode: 1 }),
    })
  ).json()
  assert.equal(payload.tools.count, catalog.tools.length, `注册数 ${payload.tools.count} ≠ 清单 ${catalog.tools.length}`)
})

await check('应用日志记录宿主注册结果', async () => {
  const line = appLogs.find((l) => l.includes('[studio-tools] 宿主已注册'))
  assert.ok(line, `应用日志里没有注册记录：\n${appLogs.slice(-10).join('\n')}`)
  assert.match(line, /宿主已注册 \d+ 个工具/)
})

await host.stop()
app.kill('SIGTERM')
await new Promise((resolve) => {
  app.on('exit', resolve)
  setTimeout(resolve, 5000)
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n真实宿主插件加载测试全部通过')
process.exit(0)
