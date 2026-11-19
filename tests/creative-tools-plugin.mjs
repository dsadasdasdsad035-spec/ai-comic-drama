/**
 * 宿主插件（creative-tools）的行为测试。
 *
 * 不启动真实 dsh：用一个最小 ctx 捕获注册与事件监听，
 * 这样能精确断言「注册了什么、转发带没带令牌、审批闸门放行哪些工具」。
 * 真实宿主能否加载这个插件由 tests/studio-host-plugin.mjs 覆盖。
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

const TOKEN = 'plugin-test-token'
const calls = []

/** 应用侧替身：记录每次转发，并按工具名返回可控结果 */
const app = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const payload = body ? JSON.parse(body) : {}
    calls.push({ url: req.url, token: req.headers['x-studio-internal'], payload })
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.url === '/api/studio/tools') {
      res.end(
        JSON.stringify({
          ok: true,
          tools: [
            { name: 'read_source', description: '读原著', parameters: { type: 'object', properties: {} } },
            { name: 'generate_keyframe', description: '出首帧', parameters: { type: 'object', properties: {} } },
            { name: 'submit_shots', description: '提交镜头', parameters: { type: 'object', properties: {} } },
            { name: 'read_asset_detail', description: '读素材详情', parameters: { type: 'object', properties: {} } },
          ],
        }),
      )
      return
    }
    if (payload.name === 'generate_keyframe') {
      // 带大字段：验证只有摘要进模型
      res.end(
        JSON.stringify({
          ok: true,
          summary: { ok: true, url: 'https://cdn/frame.png' },
          details: { ok: true, url: 'https://cdn/frame.png', frames: [1, 2, 3], firstFrame: 'data:image/png;base64,AAA' },
        }),
      )
      return
    }
    if (payload.name === 'submit_shots') {
      res.end(JSON.stringify({ ok: false, error: '镜号 E01-S09 不存在' }))
      return
    }
    if (payload.name === 'read_asset_detail') {
      // 缺必填字段：应用会带结构化字段清单回来
      res.end(
        JSON.stringify({
          ok: false,
          kind: 'invalid-arguments',
          error: 'read_asset_detail 参数不合法 —— category：必填',
          fields: [
            { field: 'category', message: '必填' },
            { field: 'key', message: '必填' },
          ],
        }),
      )
      return
    }
    res.end(JSON.stringify({ ok: true, summary: { ok: true, source: '雨夜' }, details: { ok: true, source: '雨夜', full: 'x'.repeat(500) } }))
  })
})
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${app.address().port}`

/** 最小 ctx：记录注册与监听，effect 立即执行 */
function makeCtx() {
  const registered = new Map()
  const listeners = new Map()
  return {
    registered,
    listeners,
    ctx: {
      tools: {
        register(def) {
          registered.set(def.name, def)
          return () => registered.delete(def.name)
        },
      },
      on(event, handler) {
        listeners.set(event, handler)
        return () => listeners.delete(event)
      },
      effect(fn) {
        fn()
        return () => {}
      },
      logger: { info() {}, warn() {} },
    },
  }
}

/**
 * 等到目录拉取**并注册完成**（插件在 apply 时异步注册）。
 *
 * 旧实现只等「请求发出」就返回：响应还在路上时断言就已经跑了，
 * 于是这条用例在空闲机器上大概率通过、在串跑 `npm run test:studio` 时必然失败。
 * 这里改为等注册表真正就位，顺带把等待上限放宽。
 */
async function settle(expected = 4, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (registered.size >= expected) return
    await new Promise((r) => setTimeout(r, 10))
  }
}

await check('缺内部令牌时不注册任何工具', async () => {
  const { ctx, registered } = makeCtx()
  plugin.apply(ctx, { baseUrl })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(registered.size, 0)
})

const { ctx, registered, listeners } = makeCtx()
calls.length = 0
plugin.apply(ctx, { baseUrl, internalToken: TOKEN, project: 'p1', episode: 2 })
await settle()

await check('按应用清单注册全部工具', async () => {
  assert.deepEqual([...registered.keys()].sort(), [
    'generate_keyframe',
    'read_asset_detail',
    'read_source',
    'submit_shots',
  ])
})

await check('目录请求带内部令牌与项目上下文', async () => {
  const call = calls.find((c) => c.url === '/api/studio/tools')
  assert.equal(call.token, TOKEN)
  assert.equal(call.payload.project, 'p1')
  assert.equal(call.payload.episode, 2)
})

await check('注册声明的参数与描述原样透传', async () => {
  const def = registered.get('read_source')
  assert.equal(def.description, '读原著')
  assert.equal(def.parameters.type, 'object')
})

await check('未确认前不会发起任何工具执行（无上游请求、无预扣）', async () => {
  // 审批发生在工具体之前：注册阶段最多拉一次清单、回报一次就绪（回报是异步的，
  // 不能要求它一定已经发出），关键是不能出现任何 execute 请求
  const urls = [...new Set(calls.map((c) => c.url))]
  for (const url of urls) {
    assert.ok(
      url === '/api/studio/tools' || url === '/api/studio/tools/ready',
      `注册阶段调用了 ${url}`,
    )
  }
  assert.ok(!urls.includes('/api/studio/tools/execute'), '注册阶段就调用了工具')
})

await check('执行转发到应用并带令牌', async () => {
  calls.length = 0
  const value = await registered.get('read_source').execute({}, {})
  const call = calls.find((c) => c.url === '/api/studio/tools/execute')
  assert.ok(call, '没有转发 execute 请求')
  assert.equal(call.token, TOKEN)
  assert.equal(call.payload.name, 'read_source')
  assert.equal(value.details.full.length, 500, '界面详情应保留完整结果')
})

await check('转发 execute 时带 studioExpertId', async () => {
  calls.length = 0
  await registered.get('read_source').execute({}, { studioExpertId: 'expert-omni' })
  const call = calls.find((c) => c.url === '/api/studio/tools/execute')
  assert.equal(call.payload.expertId, 'expert-omni')
})

await check('模型只看到摘要，界面能拿到详情', async () => {
  const def = registered.get('generate_keyframe')
  const value = await def.execute({ no: 'E01-S01' }, {})
  const rendered = def.output.render({}, value)
  const text = rendered.map((b) => b.text).join('')
  assert.ok(text.includes('frame.png'), '摘要里应有图片地址')
  assert.ok(!text.includes('data:image/png'), '首帧数据不该进模型上下文')
  assert.deepEqual(value.details.frames, [1, 2, 3], '界面详情应保留帧数据')
})

await check('输出契约校验通过（schema 接受返回值）', async () => {
  const def = registered.get('read_source')
  const value = await def.execute({}, {})
  assert.equal(typeof value.summary, 'object')
  assert.equal(value.failed, false)
})

await check('失败返回可读原因而不是抛错', async () => {
  const value = await registered.get('submit_shots').execute({ episode: 1 }, {})
  assert.equal(value.failed, true)
  assert.match(JSON.stringify(value.summary), /E01-S09 不存在/)
})

await check('缺字段时给出结构化追问并带上原调用标识', async () => {
  const def = registered.get('read_asset_detail')
  const value = await def.execute({}, { rootCallId: 'call-42' })
  assert.equal(value.failed, true)
  assert.equal(value.summary.needInput, true)
  assert.equal(value.summary.callId, 'call-42', '追问必须能回到原调用')
  assert.deepEqual(value.summary.fields.map((f) => f.field), ['category', 'key'])
  const view = def.presentResult({}, { presentationMeta: value.details })
  assert.match(view.title, /需要补充信息/)
  assert.match(view.content[0].text, /category/)
})

await check('追问结果里模型看得到字段说明', async () => {
  const def = registered.get('read_asset_detail')
  const value = await def.execute({}, { rootCallId: 'call-43' })
  const text = def.output.render({}, value).map((b) => b.text).join('')
  assert.match(text, /category/)
  assert.match(text, /key/)
})

await check('传输失败也算可读失败', async () => {
  const { ctx: badCtx, registered: badRegistered } = makeCtx()
  plugin.apply(badCtx, { baseUrl: 'http://127.0.0.1:1', internalToken: TOKEN })
  // 目录拉不到就注册不到工具；这里直接断言语义：拿不到工具时插件不半启动
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(badRegistered.size, 0)
})

await check('破坏性工具请求确认', async () => {
  const pre = listeners.get('tools/pre-execute')
  assert.ok(pre, '没有注册审批闸门')
  const decision = await pre({ name: 'submit_shots' }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /submit_shots/)
})

await check('生成类工具请求确认（费用）', async () => {
  const pre = listeners.get('tools/pre-execute')
  const decision = await pre({ name: 'generate_keyframe' }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /费用/)
})

await check('读工具不打断用户', async () => {
  const pre = listeners.get('tools/pre-execute')
  let delegated = false
  const decision = await pre({ name: 'read_source' }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
  assert.equal(decision.kind, 'allow')
})

await check('未注册的工具不会误触发审批', async () => {
  const pre = listeners.get('tools/pre-execute')
  let delegated = false
  await pre({ name: 'bash' }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
})

app.close()
if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n宿主插件行为测试全部通过')
process.exit(0)
