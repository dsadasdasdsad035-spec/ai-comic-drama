/**
 * 工具清单热更新（dsh-tool-bridge 的「工具清单变更无需重启即可生效」）。
 *
 * 契约有三个容易写错的地方，都是静默失效：
 * 1. 版本相等却重注册——每次工具调用都换一次表，进行中的调用会丢定义；
 * 2. 拉取失败却清空旧表——网络抖一下整套工具消失；
 * 3. 执行中换表——被注销的正是即将被调用的那个工具。
 *
 * 不启动真实 dsh：用最小 ctx + 可编程的应用替身，精确断言注册表的变化时机。
 * 真实宿主能否加载插件由 tests/studio-host-plugin.mjs 覆盖。
 *
 * 跑法：`node tests/studio-tools-hot.mjs`
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import plugin from '../server/dsh-plugins/creative-tools/index.js'

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

const TOKEN = 'tools-hot-token'

/** 应用侧替身：清单内容、版本、失败开关都由用例直接改 */
const state = {
  version: 'v1',
  tools: [
    { name: 'read_source', description: '读原著', parameters: { type: 'object', properties: {} } },
    { name: 'read_shots', description: '读镜头', parameters: { type: 'object', properties: {} } },
  ],
  failCatalog: false,
  /** 清单请求计数：用来确认「没变就不拉」「变了才拉」 */
  catalogCalls: 0,
  /** 让 execute 挂起，模拟「执行中」 */
  holdExecuteMs: 0,
}

const app = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    const payload = body ? JSON.parse(body) : {}
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.url === '/api/studio/tools') {
      state.catalogCalls += 1
      if (state.failCatalog) {
        res.statusCode = 500
        res.end(JSON.stringify({ ok: false, message: '模拟清单不可用' }))
        return
      }
      res.end(JSON.stringify({ ok: true, version: state.version, tools: state.tools }))
      return
    }
    if (req.url === '/api/studio/tools/ready') {
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.url === '/api/studio/tools/execute') {
      if (state.holdExecuteMs) await new Promise((r) => setTimeout(r, state.holdExecuteMs))
      res.end(JSON.stringify({ ok: true, summary: { ok: true, name: payload.name }, details: { ok: true } }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false }))
  })
})
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${app.address().port}`

/**
 * 最小 ctx。
 *
 * `register` 对重名抛错，与 dsh 的真实行为一致：热更新若不做「先摘后装」，
 * 这里会立刻炸出来，而不是等到线上才发现。
 */
function makeCtx() {
  const registered = new Map()
  const listeners = new Map()
  const logs = []
  let disposer = null
  return {
    registered,
    listeners,
    logs,
    ctx: {
      tools: {
        register(def) {
          if (registered.has(def.name)) throw new Error(`工具重名：${def.name}`)
          registered.set(def.name, def)
          return () => {
            // 与 dsh 一致：注销后名字才可复用
            if (registered.get(def.name) === def) registered.delete(def.name)
          }
        },
      },
      on(event, handler) {
        listeners.set(event, handler)
        return () => listeners.delete(event)
      },
      effect(fn) {
        disposer = fn()
        return () => {}
      },
      logger: {
        info: (line) => logs.push(`info ${line}`),
        warn: (line) => logs.push(`warn ${line}`),
      },
    },
    dispose() {
      disposer?.()
    },
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** 等首次加载完成（插件在 apply 里异步注册） */
async function settle(registered, expect = 1) {
  for (let i = 0; i < 200; i += 1) {
    if (registered.size >= expect) return
    await wait(10)
  }
}

const h = makeCtx()
const { ctx } = h
plugin.apply(ctx, { baseUrl, internalToken: TOKEN, project: '', episode: 1, reconcileIntervalMs: 60000 })
await settle(h.registered)

await check('按版本加载并注册全部工具', () => {
  assert.deepEqual([...h.registered.keys()].sort(), ['read_shots', 'read_source'])
})

await check('预执行时清单未变则不重注册', async () => {
  const before = h.registered.get('read_source')
  const pre = h.listeners.get('tools/pre-execute')
  await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
  assert.equal(h.registered.get('read_source'), before, '版本没变时不该换掉工具定义')
  assert.equal(state.catalogCalls, 2, '应拉取一次用于比对')
})

await check('version 变化后下一轮预执行即重注册', async () => {
  const before = h.registered.get('read_source')
  // 新增一个工具：新出现的工具必须立刻可调用
  state.version = 'v2'
  state.tools = [
    ...state.tools,
    { name: 'submit_shots', description: '提交镜头', parameters: { type: 'object', properties: {} } },
  ]
  const pre = h.listeners.get('tools/pre-execute')
  await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
  assert.ok(h.registered.has('submit_shots'), '新增工具没有注册')
  assert.notEqual(h.registered.get('read_source'), before, '清单变了应换用新定义')
  assert.match(h.logs.join('\n'), /工具清单已热更新/)
})

await check('工具被移除时从注册表消失', async () => {
  state.version = 'v3'
  state.tools = state.tools.filter((t) => t.name !== 'read_shots')
  const pre = h.listeners.get('tools/pre-execute')
  await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
  assert.ok(!h.registered.has('read_shots'), '已下线的工具不该还留在注册表里')
})

await check('拉取失败时保留旧表', async () => {
  const snapshot = new Map(h.registered)
  state.version = 'v4'
  state.failCatalog = true
  try {
    const pre = h.listeners.get('tools/pre-execute')
    await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
  } finally {
    state.failCatalog = false
  }
  assert.deepEqual([...h.registered.keys()].sort(), [...snapshot.keys()].sort(), '失败不该清空注册表')
  // 定义实例也必须是原来那些：不能被「注销后重装」偷偷换掉
  for (const [name, def] of snapshot) assert.equal(h.registered.get(name), def, `${name} 被替换了`)
  assert.match(h.logs.join('\n'), /刷新失败，保留现有/)
})

await check('执行中不刷新注册表', async () => {
  const def = h.registered.get('read_source')
  const beforeKeys = [...h.registered.keys()].sort()
  state.holdExecuteMs = 300
  state.version = 'v5'
  state.tools = [...state.tools, { name: 'delete_shots', description: '删镜头', parameters: { type: 'object', properties: {} } }]
  try {
    const running = def.execute({}, {})
    // 执行挂起期间触发一次预执行（另一个工具的调用）
    await wait(30)
    const pre = h.listeners.get('tools/pre-execute')
    await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
    assert.ok(!h.registered.has('delete_shots'), '执行中不该换表')
    assert.deepEqual([...h.registered.keys()].sort(), beforeKeys, '执行中注册表不该变化')
    await running
  } finally {
    state.holdExecuteMs = 0
  }
  // 执行结束后下一次预执行才允许换表
  const pre = h.listeners.get('tools/pre-execute')
  await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
  assert.ok(h.registered.has('delete_shots'), '执行结束后应完成换表')
})

await check('15 秒兜底：无工具调用时也会刷新', async () => {
  const idle = makeCtx()
  plugin.apply(idle.ctx, { baseUrl, internalToken: TOKEN, reconcileIntervalMs: 80 })
  await settle(idle.registered)
  assert.ok(idle.registered.has('delete_shots'))
  // 只改版本与清单，不触发任何 pre-execute
  state.version = 'v6'
  state.tools = state.tools.filter((t) => t.name !== 'delete_shots')
  for (let i = 0; i < 60 && idle.registered.has('delete_shots'); i += 1) await wait(20)
  assert.ok(!idle.registered.has('delete_shots'), '兜底轮询没有生效')
  idle.dispose()
  await wait(20)
})

await check('旧服务端（无 version）不刷新也不轮询', async () => {
  const legacy = makeCtx()
  const savedVersion = state.version
  state.version = undefined
  try {
    plugin.apply(legacy.ctx, { baseUrl, internalToken: TOKEN, reconcileIntervalMs: 60 })
    await settle(legacy.registered)
    assert.ok(legacy.registered.size > 0, '无 version 也要能正常注册')
    const callsAfterLoad = state.catalogCalls
    const pre = legacy.listeners.get('tools/pre-execute')
    await pre({ name: 'read_source' }, async () => ({ kind: 'allow' }))
    assert.equal(state.catalogCalls, callsAfterLoad, '无 version 时不该再去比对')
    await wait(200)
    assert.equal(state.catalogCalls, callsAfterLoad, '无 version 时不该轮询')
    assert.equal(legacy.registered.size, 2, '工具应保持注册状态')
  } finally {
    state.version = savedVersion
    legacy.dispose()
  }
})

await check('插件处置后不再刷新', async () => {
  const doomed = makeCtx()
  plugin.apply(doomed.ctx, { baseUrl, internalToken: TOKEN, reconcileIntervalMs: 40 })
  await settle(doomed.registered)
  doomed.dispose()
  const callsAfterDispose = state.catalogCalls
  state.version = 'v7'
  await wait(200)
  assert.equal(state.catalogCalls, callsAfterDispose, '处置后不该再拉清单')
  assert.equal(doomed.registered.size, 0, '处置应注销全部工具')
})

h.dispose()
app.close()
if (bad) {
  console.error(`\n❌ 工具热更新测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 工具清单热更新测试全部通过')
process.exit(0)
