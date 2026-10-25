import assert from 'node:assert/strict'
import {
  UNDO_DEPTH,
  applyConfigPatch,
  computeReadiness,
  pushRound,
  readinessSummary,
  takeRound,
  type ConfigPatch,
  type RoundSnapshot,
} from '../src/publish/publishChat'
import type {
  DeliverableConfig,
  PlatformCapability,
  PreflightResult,
  PublishAccount,
} from '../src/publish/types'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const PLATFORM: PlatformCapability = {
  id: 'douyin',
  label: '抖音',
  short: '抖',
  backendUrl: 'https://example.com',
  contentTypes: ['video'],
  modes: ['draft', 'publish', 'package'],
  manualOnly: false,
  verified: false,
  coverAspects: ['9:16'],
  limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 20 },
  max: {},
  notes: '',
  draftKind: 'server',
}

const XHS: PlatformCapability = { ...PLATFORM, id: 'xiaohongshu', label: '小红书', coverAspects: ['3:4'], draftKind: 'local' }

const ACCOUNT: PublishAccount = {
  id: 'pa-1',
  platform: 'douyin',
  label: '主号',
  status: 'connected',
  lastCheckedAt: '',
  autoDraft: false,
  createdAt: '',
  updatedAt: '',
}

function emptyConfig(over: Partial<DeliverableConfig> = {}): DeliverableConfig {
  return {
    master: { title: '', description: '', tags: [], aiGenerated: true, ...(over.master || {}) },
    cover: { ...(over.cover || {}) },
    targets: {
      douyin: { selected: true, accountId: ACCOUNT.id, mode: 'draft', override: null },
      ...(over.targets || {}),
    },
  }
}

function labels(id: string) {
  return id === 'xiaohongshu' ? '小红书' : '抖音'
}

// ---------------- 准备度 ----------------

check('未选平台时其余四格是 not-applicable 而不是错误', () => {
  const r = computeReadiness({
    config: emptyConfig({ targets: { douyin: { selected: false, accountId: '', mode: 'draft', override: null } } }),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: null,
  })
  assert.equal(r.items[0].state, 'warn')
  for (const item of r.items.slice(1)) {
    assert.equal(item.state, 'not-applicable')
    assert.notEqual(item.state, 'danger')
  }
})

check('全部齐备时为 5/5', () => {
  const r = computeReadiness({
    config: emptyConfig({ master: { title: '标题', description: '简介', tags: [], aiGenerated: true }, cover: { '9:16': '/a.jpg' } }),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: { ok: true, blocking: [], warnings: [], issues: [] } as PreflightResult,
  })
  assert.equal(r.done, 5)
  assert.deepEqual(r.items.map((i) => i.state), ['ok', 'ok', 'ok', 'ok', 'ok'])
})

check('缺封面时为 warn 并说明缺哪个比例', () => {
  const r = computeReadiness({
    config: emptyConfig({
      master: { title: '标题', description: '', tags: [], aiGenerated: true },
      targets: {
        douyin: { selected: true, accountId: ACCOUNT.id, mode: 'draft', override: null },
        xiaohongshu: { selected: true, accountId: 'pa-2', mode: 'draft', override: null },
      },
    }),
    platforms: [PLATFORM, XHS],
    accounts: [ACCOUNT, { ...ACCOUNT, id: 'pa-2', platform: 'xiaohongshu' }],
    preflight: { ok: false, blocking: [], warnings: [], issues: [] } as PreflightResult,
  })
  const cover = r.items.find((i) => i.key === 'cover')
  assert.equal(cover?.state, 'warn')
  assert.match(cover?.detail || '', /3:4/)
})

check('账号未连接时账号格为 warn', () => {
  const r = computeReadiness({
    config: emptyConfig({ master: { title: '标题', description: '', tags: [], aiGenerated: true }, cover: { '9:16': '/a.jpg' } }),
    platforms: [PLATFORM],
    accounts: [{ ...ACCOUNT, status: 'expired' }],
    preflight: { ok: true, blocking: [], warnings: [], issues: [] } as PreflightResult,
  })
  assert.equal(r.items.find((i) => i.key === 'accounts')?.state, 'warn')
})

check('预检阻断时预检格为 danger', () => {
  const r = computeReadiness({
    config: emptyConfig({ master: { title: '标题', description: '', tags: [], aiGenerated: true }, cover: { '9:16': '/a.jpg' } }),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: {
      ok: false,
      blocking: [{ level: 'block', code: 'x', target: '', field: 'copy.title', message: '超限' }],
      warnings: [],
      issues: [],
    } as PreflightResult,
  })
  assert.equal(r.items.find((i) => i.key === 'preflight')?.state, 'danger')
})

check('准备度摘要覆盖五格', () => {
  const r = computeReadiness({
    config: emptyConfig(),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: null,
  })
  const text = readinessSummary(r)
  for (const label of ['目标', '文案', '封面', '账号', '预检']) assert.match(text, new RegExp(label))
})

// ---------------- 配置 patch ----------------

check('只改传入字段，未传的保持原值', () => {
  const config = emptyConfig({ master: { title: '旧', description: '旧简介', tags: ['a'], aiGenerated: true } })
  const { next, changes } = applyConfigPatch({
    config,
    patch: { master: { title: '新' } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(next.master.title, '新')
  assert.equal(next.master.description, '旧简介')
  assert.deepEqual(next.master.tags, ['a'])
  assert.equal(changes.length, 1)
  assert.equal(changes[0].field, '主标题')
  assert.equal(changes[0].from, '旧')
  assert.equal(changes[0].to, '新')
})

check('勾选平台时补默认账号', () => {
  const config = emptyConfig({ targets: { douyin: { selected: false, accountId: '', mode: 'draft', override: null } } })
  const { next } = applyConfigPatch({
    config,
    patch: { targets: { douyin: { selected: true } } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(next.targets.douyin.selected, true)
  assert.equal(next.targets.douyin.accountId, ACCOUNT.id)
})

check('清除覆写恢复继承', () => {
  const config = emptyConfig({
    targets: {
      douyin: { selected: true, accountId: ACCOUNT.id, mode: 'draft', override: { title: '专', description: '', tags: [] } },
    },
  })
  const { next, changes } = applyConfigPatch({
    config,
    patch: { override: { douyin: null } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(next.targets.douyin.override, null)
  assert.match(changes[0].to, /继承/)
})

check('清除封面从配置里删键', () => {
  const config = emptyConfig({ cover: { '9:16': '/a.jpg' } })
  const { next } = applyConfigPatch({
    config,
    patch: { cover: { '9:16': null } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal('9:16' in next.cover, false)
})

check('配置 patch 不改变原对象', () => {
  const config = emptyConfig({ master: { title: '旧', description: '', tags: [], aiGenerated: true } })
  const before = JSON.stringify(config)
  applyConfigPatch({ config, patch: { master: { title: '新' } }, accounts: [ACCOUNT], platformLabel: labels })
  assert.equal(JSON.stringify(config), before)
})

check('无变化时不产生变更行', () => {
  const config = emptyConfig({ master: { title: '同名', description: '', tags: [], aiGenerated: true } })
  const { changes } = applyConfigPatch({
    config,
    patch: { master: { title: '同名' } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(changes.length, 0)
})

// ---------------- 撤销栈 ----------------

check('撤销某轮回到该轮开始前', () => {
  let stack: RoundSnapshot[] = []
  const c0 = emptyConfig({ master: { title: '0', description: '', tags: [], aiGenerated: true } })
  const c1 = emptyConfig({ master: { title: '1', description: '', tags: [], aiGenerated: true } })
  const c2 = emptyConfig({ master: { title: '2', description: '', tags: [], aiGenerated: true } })
  stack = pushRound(stack, 'r1', c0)
  stack = pushRound(stack, 'r2', c1)
  const taken = takeRound(stack, 'r2')
  assert.ok(taken)
  assert.equal(taken!.config.master.title, '1')
  // 撤销 r2 后 r1 仍在
  assert.equal(taken!.stack.length, 1)
  assert.equal(taken!.stack[0].roundId, 'r1')
  // 撤销 r1 回到 c0
  const taken2 = takeRound(taken!.stack, 'r1')
  assert.equal(taken2!.config.master.title, '0')
  void c2
})

check('未知 roundId 撤销返回 null', () => {
  const stack = pushRound([], 'r1', emptyConfig())
  assert.equal(takeRound(stack, 'nope'), null)
})

check(`栈深上限 ${UNDO_DEPTH}，更早的被丢弃`, () => {
  let stack: RoundSnapshot[] = []
  for (let i = 0; i < UNDO_DEPTH + 2; i++) {
    stack = pushRound(stack, `r${i}`, emptyConfig({ master: { title: String(i), description: '', tags: [], aiGenerated: true } }))
  }
  assert.equal(stack.length, UNDO_DEPTH)
  assert.equal(stack[0].roundId, 'r2')
})

check('撤销不触碰配置以外的数据', () => {
  const config = emptyConfig()
  const stack = pushRound([], 'r1', config)
  const taken = takeRound(stack, 'r1')
  // 只返回配置快照；任务与发布记录不在这个数据结构里
  assert.deepEqual(Object.keys(taken!).sort(), ['config', 'stack'])
})

// ---------------- patch 类型边界 ----------------

check('未知字段不被写入，也不产生变更行', () => {
  const config = emptyConfig({ master: { title: '原', description: '', tags: [], aiGenerated: true } })
  const before = JSON.stringify(config)
  const { next, changes } = applyConfigPatch({
    config,
    // 模型可能塞进来的越界字段：整份配置、成片地址、任务字段
    patch: { master: { title: '原' }, deliverableId: 'x', jobs: [] } as unknown as ConfigPatch,
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(changes.length, 0)
  assert.equal(JSON.stringify(next), before)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 发布助手纯函数全部通过')
if (bad) process.exit(1)
