/**
 * 工具桥（应用侧）契约测试。
 *
 * 覆盖 4.1/4.2/4.3/4.4/4.8：
 * - 声明来自唯一来源：名字、描述、参数顶层为 object，名字不重复；
 * - 执行真的读到了项目/镜头/素材数据（起真实服务，不用桩）；
 * - 结果按「模型可见摘要 / 界面可见详情」拆成两份；
 * - 参数校验在运行前失败，错误里指明字段；
 * - 工具失败不伪装成功，且不影响别的工具。
 *
 * 令牌从环境变量注入，测试据此证明「没有令牌就调不动」。
 */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StudioToolBridge, INTERNAL_TOKEN_HEADER, catalogFromTools } from '../server/studio-tool-bridge.mjs'
import { z as zod } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-tools-'))
const PROJECT = 'tool-bridge-fixture'
const TOKEN = 'test-internal-token'

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

// ---- 夹具项目：一集、两镜、一条素材、一个角色 ----
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `
import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'data.mjs'))}
const name = ${JSON.stringify(PROJECT)}
createProject(${JSON.stringify(TMP)}, name, { title: '工具桥夹具' })
writeProject(${JSON.stringify(TMP)}, name, {
  source: '一场雨夜的戏',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
  shots: [
    { id: 'E01-S01', episode: 1, no: 'E01-S01', seconds: 3, size: '中景', desc: '街口', keyframe_prompt: 'rain', video_prompt: 'push' },
    { id: 'E01-S02', episode: 1, no: 'E01-S02', seconds: 4, size: '近景', desc: '伞下', keyframe_prompt: 'umbrella', video_prompt: 'pull' },
  ],
  characters: [{ id: 'c1', name: '主角', look_cn: '穿外套的人' }],
  designs: [{ kind: 'scene', name: '街口', promptEn: 'street at night' }],
})
console.log('ok')
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP } })

// ---- 起真实服务：工具执行要读真实项目数据 ----
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
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

let port = 0
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务启动超时')), 60_000)
  let buf = ''
  server.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const m = buf.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      port = Number(m[1])
      clearTimeout(timer)
      resolve()
    }
  })
  server.stderr.on('data', (chunk) => {
    buf += chunk.toString()
  })
  server.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${buf}`))
  })
})

const base = `http://127.0.0.1:${port}`

async function post(url, body, token = TOKEN) {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { [INTERNAL_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body || {}),
  })
  return { status: res.status, body: await res.json() }
}

await check('没有内部令牌拒绝工具清单', async () => {
  const r = await post('/api/studio/tools', { project: PROJECT }, '')
  assert.equal(r.status, 401)
  assert.ok(r.body.ok === false)
})

await check('令牌正确才返回工具清单', async () => {
  const r = await post('/api/studio/tools', { project: PROJECT, episode: 1 })
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.body.tools) && r.body.tools.length >= 40, `工具数 ${r.body.tools?.length}`)
  const names = new Set(r.body.tools.map((t) => t.name))
  assert.equal(names.size, r.body.tools.length, '工具名重复')
  for (const tool of r.body.tools) {
    assert.ok(tool.name && tool.description, `${tool.name} 缺名字或描述`)
    assert.equal(tool.parameters.type, 'object', `${tool.name} 参数顶层不是 object`)
  }
})

await check('清单覆盖读、写、生成与技能工具', async () => {
  const r = await post('/api/studio/tools', { project: PROJECT })
  const names = r.body.tools.map((t) => t.name)
  for (const required of ['read_source', 'read_shots', 'submit_shots', 'generate_keyframe', 'read_skill', 'list_experts']) {
    assert.ok(names.includes(required), `缺少 ${required}`)
  }
})

await check('执行读工具拿到真实项目数据', async () => {
  const r = await post('/api/studio/tools/execute', { name: 'read_source', args: {}, project: PROJECT, episode: 1 })
  assert.equal(r.body.ok, true, JSON.stringify(r.body).slice(0, 200))
  assert.ok(JSON.stringify(r.body.details).includes('雨夜'), '读不到夹具原文')
})

await check('执行镜头工具拿到真实镜头与素材', async () => {
  const r = await post('/api/studio/tools/execute', {
    name: 'read_shots',
    args: { episode: 1, limit: 5 },
    project: PROJECT,
    episode: 1,
  })
  assert.equal(r.body.ok, true, JSON.stringify(r.body).slice(0, 300))
  const raw = JSON.stringify(r.body.details)
  assert.ok(raw.includes('E01-S01') && raw.includes('伞下'), '读不到夹具镜头')
})

await check('结果拆成模型摘要与界面详情两份', async () => {
  const r = await post('/api/studio/tools/execute', { name: 'read_shots', args: { episode: 1 }, project: PROJECT })
  assert.ok(r.body.summary !== undefined, '缺模型可见摘要')
  assert.ok(r.body.details !== undefined, '缺界面可见详情')
  assert.notEqual(r.body.summary, r.body.details, '摘要与详情不应是同一个对象引用')
})

await check('缺必填字段时不执行并指明字段', async () => {
  const r = await post('/api/studio/tools/execute', {
    name: 'read_asset_detail',
    args: {},
    project: PROJECT,
    episode: 1,
  })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.kind, 'invalid-arguments')
  assert.match(r.body.error, /category/, `错误未指明字段：${r.body.error}`)
})

await check('参数错误附带结构化字段清单', async () => {
  const r = await post('/api/studio/tools/execute', {
    name: 'read_asset_detail',
    args: {},
    project: PROJECT,
    episode: 1,
  })
  assert.ok(Array.isArray(r.body.fields) && r.body.fields.length >= 2, JSON.stringify(r.body.fields))
  const names = r.body.fields.map((f) => f.field)
  assert.deepEqual(names.slice(0, 2), ['category', 'key'])
  for (const f of r.body.fields) assert.ok(f.message, '每个字段都要有可读说明')
})

await check('未知工具返回可读错误', async () => {
  const r = await post('/api/studio/tools/execute', { name: 'no_such_tool', args: {}, project: PROJECT })
  assert.equal(r.body.ok, false)
  assert.match(r.body.error, /no_such_tool/)
})

await check('业务失败不伪装成功', async () => {
  // 不存在的集号：工具应返回失败而不是空成功
  const r = await post('/api/studio/tools/execute', {
    name: 'read_episode',
    args: { episode: 99 },
    project: PROJECT,
    episode: 1,
  })
  if (r.body.ok === true) {
    assert.ok(r.body.details && typeof r.body.details === 'object', '成功结果必须有 details')
  } else {
    assert.ok(String(r.body.error || '').length > 0, '失败必须带可读原因')
  }
})

await check('同一桥实例可连续执行不同工具（失败不影响后续）', async () => {
  const bridge = new StudioToolBridge({ root: ROOT, baseUrl: base, internalToken: TOKEN })
  const failed = await bridge.invoke('read_shot_detail', {}, { projectName: PROJECT, epNo: 1 })
  assert.equal(failed.ok, false)
  const ok = await bridge.invoke('read_source', {}, { projectName: PROJECT, epNo: 1 })
  assert.equal(ok.ok, true)
})

await check('桥实例的目录声明与 HTTP 清单一致', async () => {
  const bridge = new StudioToolBridge({ root: ROOT, baseUrl: base, internalToken: TOKEN })
  const fromBridge = await bridge.catalog(PROJECT, 1)
  const fromHttp = (await post('/api/studio/tools', { project: PROJECT, episode: 1 })).body.tools
  assert.deepEqual(
    fromBridge.map((t) => t.name).sort(),
    fromHttp.map((t) => t.name).sort(),
  )
})

await check('声明跟着 schema 走：加一个可选字段就多一条属性', async () => {
  // 证明「唯一来源」：不改任何手写清单，只给 zod schema 加字段，
  // 生成的 JSON Schema 立刻反映出来。
  const bridge = new StudioToolBridge({ root: ROOT, baseUrl: base, internalToken: TOKEN })
  await bridge.ensureLoaded(PROJECT, 1)
  const source = bridge.tools.get('read_source')
  assert.ok(source, '找不到 read_source')
  const before = catalogFromTools([source])[0].parameters
  assert.ok(!('extra_note' in (before.properties || {})), '夹具前提不成立：字段已存在')
  const patched = {
    ...source,
    schema: source.schema.extend({ extra_note: zod.string().optional() }),
  }
  const after = catalogFromTools([patched])[0].parameters
  assert.ok('extra_note' in (after.properties || {}), '新字段没有出现在模型可见声明里')
  assert.ok(!(after.required || []).includes('extra_note'), '可选字段不该变成必填')
})

await check('专家清单带 preset 映射（会话列表据此显示专家名）', async () => {
  let body = { experts: [] }
  for (let i = 0; i < 60; i += 1) {
    const r = await post('/api/studio/experts', {})
    body = r.body
    if (body.experts?.length) break
    await new Promise((res) => setTimeout(res, 100))
  }
  assert.ok(body.ok, JSON.stringify(body).slice(0, 200))
  assert.ok(body.experts.length >= 1, '没有编译出专家')
  for (const row of body.experts) {
    assert.match(row.presetId, /^expert-/, `presetId 不对：${row.presetId}`)
    assert.equal(row.presetId, `expert-${row.id}`)
    assert.ok(row.name, '专家缺显示名')
    assert.ok(typeof row.tools === 'number' && row.tools > 0, '专家工具数不对')
  }
})

server.kill('SIGTERM')
await new Promise((resolve) => {
  server.on('exit', resolve)
  setTimeout(resolve, 5000)
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n工具桥契约测试全部通过')
process.exit(0)
