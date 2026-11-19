/**
 * 专家闸门插件测试：工具子集与技能白名单的拒绝语义。
 *
 * 用最小 ctx 捕获 restrict 与 pre-execute，不启动宿主 ——
 * 断言的是「我们声明的限制」，宿主是否遵守由 tests/studio-host-experts.mjs 覆盖。
 */
import assert from 'node:assert/strict'
import plugin from '../server/dsh-plugins/creative-expert/index.js'

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

function makeCtx() {
  const restrictions = []
  const listeners = new Map()
  return {
    restrictions,
    listeners,
    ctx: {
      tools: {
        restrict(filter) {
          restrictions.push(filter)
          return () => {}
        },
      },
      on(event, handler) {
        listeners.set(event, handler)
        return () => {}
      },
      effect(fn) {
        fn()
        return () => {}
      },
      logger: { info() {}, warn() {} },
    },
  }
}

await check('按 toolIds 收窄工具（allow 过滤）', async () => {
  const { ctx, restrictions } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_source', 'list_experts'] })
  assert.equal(restrictions.length, 1)
  assert.deepEqual(restrictions[0].allow, ['read_source', 'list_experts'])
})

await check('没声明 toolIds 时不加限制', async () => {
  const { ctx, restrictions } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: [] })
  assert.equal(restrictions.length, 0)
})

await check('白名单外的技能读被拒绝', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_skill'], skillIds: ['short-drama'] })
  const pre = listeners.get('tools/pre-execute')
  assert.ok(pre, '没有注册技能闸门')
  const decision = await pre({ name: 'read_skill', args: { id: 'other-skill' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /other-skill/)
  assert.match(decision.reason, /白名单/)
})

await check('白名单内的技能读放行', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_skill'], skillIds: ['short-drama'] })
  const pre = listeners.get('tools/pre-execute')
  let delegated = false
  const decision = await pre({ name: 'read_skill', args: { id: 'short-drama' } }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
  assert.equal(decision.kind, 'allow')
})

await check('技能子文件工具同样受白名单约束', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_skill_file'], skillIds: ['short-drama'] })
  const pre = listeners.get('tools/pre-execute')
  const denied = await pre({ name: 'read_skill_file', args: { id: 'other', path: 'references/x.md' } }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
})

await check('非技能工具不参与白名单判断', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_source'], skillIds: ['short-drama'] })
  const pre = listeners.get('tools/pre-execute')
  let delegated = false
  await pre({ name: 'read_source', args: { id: 'whatever' } }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
})

await check('通配专家展开 ids 后仍注册技能闸门', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_skill'], skillIds: ['short-drama', 'short-drama-write'] })
  const pre = listeners.get('tools/pre-execute')
  assert.ok(pre, '应有 pre-execute 闸门')
  const denied = await pre({ name: 'read_skill_text', args: { id: 'other' } }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
})

await check('pre-execute 为工具调用打上 studioExpertId', async () => {
  const { ctx, listeners } = makeCtx()
  plugin.apply(ctx, { expertId: 'e1', toolIds: ['read_source'] })
  const pre = listeners.get('tools/pre-execute')
  const exec = { name: 'read_source', args: {} }
  await pre(exec, async () => ({ kind: 'allow' }))
  assert.equal(exec.studioExpertId, 'e1')
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n专家闸门插件测试全部通过')
process.exit(0)
