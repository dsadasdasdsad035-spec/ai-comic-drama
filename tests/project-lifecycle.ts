/**
 * 项目生命周期工具验收：create_project / update_project_meta / delete_shots。
 *
 * 重点不是「能调通」，而是 fail-closed：没有确认通道、或用户取消时，
 * 一个字节都不许写进项目。
 */
import assert from 'node:assert/strict'
import {
  assertPlatformToolConsistency,
  builtinPlatformToolNames,
  createBuiltinPlatformTools,
} from '../src/agent/builtinPlatformTools'
import type { ProjectData } from '../src/api'
import { validateContract } from '../src/skills/contracts'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`)
    })
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

type Call = { url: string; init: RequestInit | undefined }

/** 拦截 fetch：记录调用并按 URL 返回假响应 */
function stubFetch(reply: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = []
  const prev = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => reply(url, init),
      text: async () => JSON.stringify(reply(url, init)),
    } as unknown as Response
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = prev) }
}

function toolOf(tools: { name: string }[], name: string) {
  const t = tools.find((x) => x.name === name)
  assert.ok(t, `工具 ${name} 应存在`)
  return t as never as { invoke: (a: unknown) => Promise<Record<string, unknown>> }
}

function project(over: Partial<ProjectData> = {}): ProjectData {
  return {
    name: '演示项目',
    logline: '原梗概',
    style: '原画风',
    aspect: '16:9',
    source: '',
    shots: [],
    characters: [],
    designs: [],
    assets: [],
    episodes: [],
    ...over,
  } as unknown as ProjectData
}

async function main() {
  await check('三个生命周期工具都真实注册且进入清单', () => {
    const tools = createBuiltinPlatformTools({ projectName: 'demo', epNo: 1 })
    const names = tools.map((t) => t.name)
    for (const n of ['create_project', 'update_project_meta', 'delete_shots']) {
      assert.ok(names.includes(n), `${n} 未注册`)
      assert.ok(builtinPlatformToolNames().includes(n), `${n} 未进入名字清单`)
    }
    assert.doesNotThrow(() => assertPlatformToolConsistency(names))
  })

  await check('新建项目没有确认通道时 fail-closed，不发请求', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({ projectName: '', epNo: 1 })
      const r = await toolOf(tools, 'create_project').invoke({ name: 'newproj', title: '新项目' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('没有确认通道'))
      assert.equal(calls.length, 0, '未确认前不得发任何写请求')
    } finally {
      restore()
    }
  })

  await check('用户取消时不落库', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, name: 'newproj' }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: '',
        epNo: 1,
        confirm: async () => false,
      })
      const r = await toolOf(tools, 'create_project').invoke({ name: 'newproj' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('取消'))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('确认后新建项目：带 create=1，返回项目名且不切换当前项目', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, name: 'newproj', created: true }))
    const created: string[] = []
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'oldproj',
        epNo: 1,
        confirm: async (req) => {
          assert.equal(req.action, 'create_project')
          return true
        },
        onProjectCreated: (n) => created.push(n),
      })
      const r = await toolOf(tools, 'create_project').invoke({
        name: 'newproj',
        title: '新项目',
        style: '赛博',
        aspect: '9:16',
      })
      assert.equal(r.ok, true)
      assert.equal(r.name, 'newproj')
      assert.equal(r.projectSwitched, false)
      assert.deepEqual(created, ['newproj'])
      assert.equal(calls.length, 1)
      assert.ok(calls[0].url.includes('/api/project?name=newproj&create=1'))
      const body = JSON.parse(String(calls[0].init?.body))
      assert.deepEqual(body, { title: '新项目', style: '赛博', aspect: '9:16' })
    } finally {
      restore()
    }
  })

  await check('同名项目已存在时返回可读失败，不覆盖数据', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: false, message: '项目已存在：newproj' }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: '',
        epNo: 1,
        confirm: async () => true,
      })
      const r = await toolOf(tools, 'create_project').invoke({ name: 'newproj' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('已存在'))
      assert.equal(calls.length, 1, '只尝试一次，不重试覆盖')
    } finally {
      restore()
    }
  })

  await check('非法目录名被本地拒绝，不需要确认也不发请求', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({ projectName: '', epNo: 1 })
      const r = await toolOf(tools, 'create_project').invoke({ name: '包含中文/斜杠' })
      assert.equal(r.ok, false)
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('画幅不在枚举内被 schema 拒绝，不发请求', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: '',
        epNo: 1,
        confirm: async () => true,
      })
      await assert.rejects(
        () => toolOf(tools, 'create_project').invoke({ name: 'okname', aspect: '21:9' }),
        /aspect|Invalid option/,
      )
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('改项目设定只提交传入字段，并同步本地快照', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, shots: [], characters: [], savedAt: '' }))
    let snap = project()
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'demo',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        confirm: async (req) => {
          assert.equal(req.action, 'update_project_meta')
          return true
        },
      })
      const r = await toolOf(tools, 'update_project_meta').invoke({ style: '水墨', aspect: '3:4' })
      assert.equal(r.ok, true)
      const body = JSON.parse(String(calls[0].init?.body))
      assert.deepEqual(body, { style: '水墨', aspect: '3:4' })
      assert.equal(snap.style, '水墨')
      assert.equal(snap.aspect, '3:4')
      assert.equal(snap.logline, '原梗概', '未提交的字段必须保持原值')
    } finally {
      restore()
    }
  })

  await check('project-meta-v1 契约只接受项目支持的画幅', () => {
    assert.equal(validateContract('project-meta-v1', { style: '水墨' }).ok, true)
    assert.equal(validateContract('project-meta-v1', { aspect: '9:16' }).ok, true)
    assert.equal(validateContract('project-meta-v1', { aspect: '21:9' }).ok, false)
    assert.equal(validateContract('project-meta-v1', { title: '' }).ok, false)
  })

  await check('改项目设定没有字段时直接报错', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'demo',
        epNo: 1,
        getSnapshot: () => project(),
        confirm: async () => true,
      })
      const r = await toolOf(tools, 'update_project_meta').invoke({})
      assert.equal(r.ok, false)
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('删分镜按镜号解析 id，只删本集，找不到的镜号回报', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, shots: [], savedAt: '' }))
    const shots = [
      { id: 'E01-S01', episode: 1, no: 'S01' },
      { id: 'E01-S02', episode: 1, no: 'S02' },
      { id: 'E02-S01', episode: 2, no: 'S01' },
    ]
    let snap = project({ shots })
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'demo',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        confirm: async (req) => {
          assert.equal(req.action, 'delete_shots')
          return true
        },
      })
      const r = await toolOf(tools, 'delete_shots').invoke({ nos: ['S01', 'S02', 'S99'] })
      assert.equal(r.ok, true)
      assert.deepEqual(r.counts, { deleted: 2, missing: 1 })
      assert.deepEqual(r.missingNos, ['S99'])
      const body = JSON.parse(String(calls[0].init?.body))
      assert.deepEqual(body.deleteShotIds, ['E01-S01', 'E01-S02'])
      assert.equal(body.shots.length, 1, '只删了本集那两镜')
      assert.equal(snap.shots.length, 1)
      assert.ok(!snap.shots.some((s) => s.id === 'E01-S02'))
      assert.ok(snap.shots.some((s) => s.id === 'E02-S01'), '别集的同号镜头必须保留')
    } finally {
      restore()
    }
  })

  await check('删分镜全找不到时报错且不发请求', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'demo',
        epNo: 1,
        getSnapshot: () => project({ shots: [{ id: 'E01-S01', episode: 1, no: 'S01' }] }),
        confirm: async () => true,
      })
      const r = await toolOf(tools, 'delete_shots').invoke({ nos: ['S08'] })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('S08'))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('删分镜没有确认通道时 fail-closed', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const tools = createBuiltinPlatformTools({
        projectName: 'demo',
        epNo: 1,
        getSnapshot: () => project({ shots: [{ id: 'E01-S01', episode: 1, no: 'S01' }] }),
      })
      const r = await toolOf(tools, 'delete_shots').invoke({ nos: ['S01'] })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('没有确认通道'))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 项目生命周期工具全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
