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
import { createStudioStarter } from '../server/studio-start.mjs'

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
      // 只有已经有在飞的启动时才复用；手工置成 starting 但没 inflight 的桩要能发起
      if (host.state === 'starting' && host.inflight) return host.inflight
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

await check('cancel 后不再触发', async () => {  let prepared = 0
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

/**
 * 三态调度：到点撞上「启动中」不应把机会用掉。
 * 这是「第二次点创意仍然慢」的一个隐蔽成因：预热以为自己做过了，
 * 用户退出创意再点回来时宿主其实没热起来。
 */
await check('到点撞上启动中记延后，不视为已用掉', async () => {
  const host = fakeHost()
  host.state = 'starting'
  let prepared = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => host.status(),
    prepare: async () => {
      prepared += 1
      return true
    },
    delayMs: 0,
    retryDelayMs: 30,
  })
  const fired = await prewarm.warmUp()
  assert.equal(fired, false, '被占用时不应报告已发起')
  assert.equal(prepared, 0, '占用期间不该动手')
  assert.equal(prewarm.phase(), 'deferred', '应记为延后而不是 spent')

  // 宿主被用户这次进入拉起：补触发看到 ready 就放手，不重复拉起
  host.state = 'ready'
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(prepared, 0, '宿主已热时补触发不应再拉起')
  assert.equal(prewarm.phase(), 'spent', '补触发后应结束')
})

await check('延后可补触发一次，之后彻底结束', async () => {
  const host = fakeHost()
  host.state = 'starting'
  let prepared = 0
  const prewarm = createStudioPrewarm({
    isEnabled: () => true,
    status: () => host.status(),
    prepare: async () => {
      prepared += 1
      host.state = 'ready'
      return true
    },
    delayMs: 0,
    retryDelayMs: 30,
  })
  await prewarm.warmUp()
  assert.equal(prewarm.phase(), 'deferred')
  // 那次启动没成，宿主退回 idle：补触发应当接手
  host.state = 'idle'
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(prepared, 1, '补触发必须真的拉起一次')
  assert.equal(prewarm.phase(), 'spent')

  // 再安排也不会触发第二次
  prewarm.schedule()
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(prepared, 1, '补触发上限为一次')
})

/**
 * 转发路径的拉起入口：每个 `/studio/*` 请求都会经过它。
 * 坏掉的形态只有一种但很贵——宿主已就绪时还重复做配置同步，
 * 表现是每次点创意都额外花掉 20ms 级同步阻塞，且日志被「已生成专家 preset」刷屏。
 */
function starterHarness(initialState = 'idle') {
  const host = fakeHost()
  host.state = initialState
  const calls = { profile: 0, experts: 0, start: 0 }
  const logs = []
  const start = createStudioStarter({
    host: {
      status: () => host.status(),
      start: () => {
        calls.start += 1
        return host.start()
      },
    },
    prepareProfile: () => {
      calls.profile += 1
    },
    prepareExperts: async () => {
      calls.experts += 1
    },
    log: (line) => logs.push(line),
  })
  return { host, calls, logs, start }
}

await check('已就绪宿主不做任何配置准备', async () => {
  const { calls, start } = starterHarness('ready')
  const ok = await start()
  assert.equal(ok, true, '已就绪时应当报告可用')
  assert.equal(calls.profile, 0, '已就绪时不应写模型配置')
  assert.equal(calls.experts, 0, '已就绪时不应重编专家 preset')
  assert.equal(calls.start, 0, '已就绪时不应再次调用 start')

  // 连打两次同样零准备：这就是「一个请求不再顺带全量同步」的契约
  await start()
  assert.deepEqual(calls, { profile: 0, experts: 0, start: 0 }, '连续请求同样不应产生准备动作')
})

await check('未就绪时先对齐配置再启动', async () => {
  const { host, calls, start } = starterHarness('idle')
  const ok = await start()
  assert.equal(ok, true)
  assert.equal(calls.profile, 1, '启动前必须对齐模型配置')
  assert.equal(calls.experts, 1, '启动前必须对齐专家 preset')
  assert.equal(host.launches, 1, '应当拉起一次宿主')
})

await check('启动中仍对齐配置且复用同一次启动', async () => {
  const { host, calls, start } = starterHarness('starting')
  // 模拟预热已经发起的那次启动
  const inflight = host.start()
  const ok = await start()
  assert.equal(ok, true)
  assert.equal(calls.experts, 1, '启动中也要对齐配置（宿主尚未读取 preset）')
  assert.equal(host.launches, 1, '不得拉起第二个宿主进程')
  await inflight
})

await check('准备后变成 failed 时不再启动', async () => {
  const host = fakeHost()
  host.state = 'idle'
  let started = 0
  const start = createStudioStarter({
    host: {
      status: () => host.status(),
      start: () => {
        started += 1
        return Promise.resolve(false)
      },
    },
    // 准备期间宿主被判失败（例如 syncExperts 触发重启但启动失败）
    prepareExperts: async () => {
      host.state = 'failed'
    },
  })
  assert.equal(await start(), false, '失败态不应继续启动')
  assert.equal(started, 0, '不应调用 start')
})

await check('准备抛错不阻断启动', async () => {
  const host = fakeHost()
  host.state = 'idle'
  const logs = []
  const start = createStudioStarter({
    host,
    prepareProfile: () => {
      throw new Error('配置目录只读')
    },
    prepareExperts: async () => {
      throw new Error('专家编译失败')
    },
    log: (line) => logs.push(line),
  })
  assert.equal(await start(), true, '准备失败时仍尝试启动，错误由宿主自身报告')
  assert.equal(host.launches, 1)
  assert.equal(logs.length, 2, '两条准备失败都应记录')
  assert.match(logs[0], /模型配置/)
  assert.match(logs[1], /专家配置/)
})

if (bad > 0) {
  console.error(`\n❌ 宿主预热测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 宿主预热行为全部通过')