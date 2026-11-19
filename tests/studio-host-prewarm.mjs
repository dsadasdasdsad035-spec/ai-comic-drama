/**
 * 宿主空闲预热的行为测试。
 *
 * 预热是「慢」的主治之一，坏掉的形态都很安静：入口关了还在拉宿主、
 * 宿主起了两次、失败后无声地每 2 秒重试一次。这里把四种形态都钉住。
 *
 * 不依赖真实宿主：预热只做调度，拉起动作是注入的，
 * 因此用一个模拟 `creative-host` 单飞语义的假宿主就能断言调用次数。
 */
import assert from 'node:assert/strict'
import { createStudioPrewarm } from '../server/studio-prewarm.mjs'

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

/**
 * 假宿主：`start()` 与真实 `creative-host` 一样单飞——
 * `starting` 期间复用同一个 promise，不会拉起第二个进程。
 */
function fakeHost() {
  const host = {
    launches: 0,
    state: 'idle',
    /** @type {Promise<boolean> | null} */
    inflight: null,
    status: () => ({ state: host.state }),
    start() {
      if (host.state === 'ready') return Promise.resolve(true)
      if (host.state === 'starting') return host.inflight
      host.launches += 1
      host.state = 'starting'
      host.inflight = new Promise((resolve) => {
        setTimeout(() => {
          host.state = 'ready'
          resolve(true)
        }, 20)
      })
      return host.inflight
    },
  }
  return host
}

await check('入口关闭时不预热', async () => {
  const host = fakeHost()
  let prepared = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => false,
    status: () => host.status(),
    prepare: async () => {
      prepared += 1
      return host.start()
    },
    delayMs: 0,
  })
  const fired = await prewarm.warmUp()
  assert.equal(fired, false, '入口关闭时不应发起预热')
  assert.equal(prepared, 0, '入口关闭时不应触达拉起函数')
  assert.equal(host.launches, 0, '入口关闭时不应拉起宿主进程')
})

await check('宿主不是 idle 时预热不动手', async () => {
  for (const state of ['starting', 'ready', 'failed', 'stopped']) {
    const host = fakeHost()
    host.state = state
    let prepared = 0
    const prewarm = createStudioPrewarm({
      isEnabled: () => true,
      status: () => host.status(),
      prepare: async () => {
        prepared += 1
        return true
      },
      delayMs: 0,
    })
    const fired = await prewarm.warmUp()
    assert.equal(fired, false, `${state} 状态下不应发起预热`)
    assert.equal(prepared, 0, `${state} 状态下不应触达拉起函数`)
  }
})

await check('预热失败只记录一次、不重试', async () => {
  const logs = []
  let attempts = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => ({ state: 'idle' }),
    prepare: async () => {
      attempts += 1
      throw new Error('入口产物缺失')
    },
    delayMs: 0,
    log: (line) => logs.push(line),
  })
  const fired = await prewarm.warmUp()
  assert.equal(fired, false, '失败时不应报告为已发起成功')
  assert.equal(attempts, 1, '失败后不应自动重试')
  assert.equal(logs.length, 1, '失败只记一条日志')
  assert.match(logs[0], /预热失败/, '日志应带可读中文原因')
  assert.match(logs[0], /入口产物缺失/, '日志应包含原始失败原因')

  // 再调一次也不该重试：预热不是守护进程
  await prewarm.warmUp()
  assert.equal(attempts, 2, '显式再次调用才允许重试，schedule 不应自行重试')
  prewarm.cancel()
})

await check('定时器到点只触发一次', async () => {
  let prepared = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => ({ state: 'idle' }),
    prepare: async () => {
      prepared += 1
      return true
    },
    delayMs: 1,
  })
  prewarm.schedule()
  prewarm.schedule() // 重复安排不应叠加两次触发
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(prepared, 1, '重复 schedule 不应触发两次预热')
  prewarm.schedule() // 已经跑过就不再安排
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(prepared, 1, '预热只触发一次，失败也不重试')
})

await check('预热未完成时进入创意不会拉起第二个进程', async () => {
  const host = fakeHost()
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => host.status(),
    prepare: () => host.start(),
    delayMs: 0,
  })

  // 预热先起，紧接着「用户进入创意」走同一条拉起路径
  const warming = prewarm.warmUp()
  const entering = host.start()
  await Promise.all([warming, entering])

  assert.equal(host.launches, 1, '预热与进入必须落在同一次启动上')
  assert.equal(host.status().state, 'ready')
})

await check('cancel 后不再触发', async () => {
  let prepared = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => ({ state: 'idle' }),
    prepare: async () => {
      prepared += 1
      return true
    },
    delayMs: 30,
  })
  prewarm.schedule()
  prewarm.cancel()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(prepared, 0, '已取消的预热不应再执行')
})

if (bad > 0) {
  console.error(`\n❌ 宿主预热测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 宿主预热行为全部通过')
