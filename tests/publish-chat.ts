import assert from 'node:assert/strict'
import {
  UNDO_DEPTH,
  applyConfigPatch,
  computeReadiness,
  pushRound,
  readinessSummary,
  takeRound,
  type ConfigPatch,
  type PublishChatAdapter,
  type RoundSnapshot,
} from '../src/publish/publishChat'
import { createPublishToolSet } from '../src/publish/publishTools'
import type {
  DeliverableConfig,
  PlatformCapability,
  PreflightResult,
  PublishAccount,
} from '../src/publish/types'
import { aspectRatioOf, coverCropRect } from '../src/publish/frames'

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

check('内联图片数据不算已准备封面', () => {
  const config = emptyConfig()
  const { next, changes } = applyConfigPatch({
    config,
    patch: { cover: { '9:16': `data:image/jpeg;base64,${'A'.repeat(500)}` } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal('9:16' in next.cover, false)
  assert.equal(changes.length, 0, '坏地址不应产生「已准备」的变更行')
})

check('站内文件路径才算已准备封面', () => {
  const { next, changes } = applyConfigPatch({
    config: emptyConfig(),
    patch: { cover: { '3:4': '/generated/cover-3x4-1.jpg' } },
    accounts: [ACCOUNT],
    platformLabel: labels,
  })
  assert.equal(next.cover['3:4'], '/generated/cover-3x4-1.jpg')
  assert.equal(changes[0].to, '已准备')
})

check('准备度不把坏地址算作已备齐', () => {
  const r = computeReadiness({
    config: emptyConfig({ cover: { '9:16': 'data:image/jpeg;base64,AAA' } }),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: { ok: true, blocking: [], warnings: [], issues: [] } as unknown as PreflightResult,
  })
  const cover = r.items.find((i) => i.key === 'cover')
  assert.equal(cover?.state, 'warn')
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

// ---------------- 助手 set_cover 落盘 ----------------

/** 最小宿主适配器：只记录 applyPatch 收到的 patch */
function coverAdapter(applyPatch: (patch: ConfigPatch) => { ok: boolean; changes: unknown[] }) {
  const snapshot = {
    deliverable: { id: 'dl-1', url: '/exports/v.mp4', episode: 1, version: 1, width: 1080, height: 1920, duration: 10, createdAt: '' },
    deliverables: [],
    config: emptyConfig(),
    platforms: [PLATFORM],
    accounts: [ACCOUNT],
    preflight: null,
    jobs: [],
    health: null,
  }
  return {
    threadKey: { project: 'p', surface: 'publish', episode: 1 },
    scope: () => 'E01',
    snapshot: () => snapshot as unknown as ReturnType<PublishChatAdapter['snapshot']>,
    beginRound: () => 'r1',
    undoRound: () => true,
    applyPatch: (patch: ConfigPatch) => ({ roundId: 'r1', ...applyPatch(patch) }) as never,
    stage: async () => ({ ok: false, error: 'not needed' }),
    connectAccount: async () => ({ ok: false, platform: 'douyin', status: 'error', message: '' }),
  } as unknown as PublishChatAdapter
}

check('助手抽帧写入的是落盘后的文件地址', async () => {
  const patches: ConfigPatch[] = []
  const tools = createPublishToolSet(
    coverAdapter((patch) => {
      patches.push(patch)
      return { ok: true, changes: [] }
    }),
    { captureFrame: async () => '/generated/cover-9x16-1.jpg' },
  )
  const r = (await tools.get('set_cover')!.invoke({
    aspect: '9:16',
    source: 'frame',
    atPercent: 0.3,
  })) as { ok: boolean }
  assert.equal(r.ok, true)
  assert.equal(patches[0].cover?.['9:16'], '/generated/cover-9x16-1.jpg')
})

check('助手抽帧落盘失败时不写入配置', async () => {
  const patches: ConfigPatch[] = []
  const tools = createPublishToolSet(
    coverAdapter((patch) => {
      patches.push(patch)
      return { ok: true, changes: [] }
    }),
    {
      captureFrame: async () => {
        throw new Error('保存封面失败：服务端没有返回文件地址')
      },
    },
  )
  const r = (await tools.get('set_cover')!.invoke({ aspect: '9:16', source: 'frame' })) as {
    ok: boolean
    error?: string
  }
  assert.equal(r.ok, false, '落盘失败必须返回未成功')
  assert.match(String(r.error), /保存封面失败/)
  assert.equal(patches.length, 0, '失败时不应写入配置，更不能声称已准备')
})

check('助手拒绝把内联图片数据当封面写入', async () => {
  const patches: ConfigPatch[] = []
  const tools = createPublishToolSet(
    coverAdapter((patch) => {
      patches.push(patch)
      return { ok: true, changes: [] }
    }),
  )
  const r = (await tools.get('set_cover')!.invoke({
    aspect: '9:16',
    source: 'url',
    url: 'https://remote.test/a.jpg',
  })) as { ok: boolean; error?: string }
  assert.equal(r.ok, false)
  assert.match(String(r.error), /站内文件路径/)
  assert.equal(patches.length, 0)
})

// ---------------- 封面裁切几何 ----------------

check('比例解析支持四档并拒绝非法输入', () => {
  assert.equal(aspectRatioOf('9:16'), 9 / 16)
  assert.equal(aspectRatioOf('16:9'), 16 / 9)
  assert.equal(aspectRatioOf('3:4'), 3 / 4)
  assert.equal(aspectRatioOf('4:3'), 4 / 3)
  assert.equal(aspectRatioOf(''), 0)
  assert.equal(aspectRatioOf('9x16'), 0)
  assert.equal(aspectRatioOf('0:16'), 0)
})

check('竖屏成片要横版封面：保留宽度裁上下', () => {
  // 1080×1920 → 16:9 应是 1080×608，垂直居中
  const c = coverCropRect(1080, 1920, '16:9')
  assert.equal(c.sw, 1080)
  assert.equal(c.sh, Math.round(1080 / (16 / 9)))
  assert.equal(c.sx, 0)
  assert.equal(c.sy, Math.round((1920 - c.sh) / 2))
  assert.ok(Math.abs(c.sw / c.sh - 16 / 9) < 0.01)
})

check('横屏成片要竖版封面：保留高度裁两侧', () => {
  // 1920×1080 → 9:16 应是 608×1080，水平居中
  const c = coverCropRect(1920, 1080, '9:16')
  assert.equal(c.sh, 1080)
  assert.equal(c.sw, Math.round(1080 * (9 / 16)))
  assert.equal(c.sy, 0)
  assert.equal(c.sx, Math.round((1920 - c.sw) / 2))
  assert.ok(Math.abs(c.sw / c.sh - 9 / 16) < 0.01)
})

check('四档裁切输出都符合目标比例', () => {
  for (const aspect of ['9:16', '16:9', '3:4', '4:3']) {
    for (const [w, h] of [
      [1080, 1920],
      [1920, 1080],
      [1080, 1080],
      [720, 1280],
    ]) {
      const c = coverCropRect(w, h, aspect)
      const got = c.sw / c.sh
      assert.ok(Math.abs(got - aspectRatioOf(aspect)) < 0.01, `${w}x${h} → ${aspect} 得到 ${c.sw}x${c.sh}`)
      // 裁切矩形必须落在源图内，不能取到画外
      assert.ok(c.sx >= 0 && c.sy >= 0)
      assert.ok(c.sx + c.sw <= w && c.sy + c.sh <= h, `${w}x${h} → ${aspect} 越界`)
    }
  }
})

check('不成比例或未知尺寸时退回原始画幅', () => {
  assert.deepEqual(coverCropRect(1080, 1920, ''), { sx: 0, sy: 0, sw: 1080, sh: 1920 })
  assert.deepEqual(coverCropRect(0, 0, '9:16'), { sx: 0, sy: 0, sw: 0, sh: 0 })
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 发布助手纯函数全部通过')
if (bad) process.exit(1)
