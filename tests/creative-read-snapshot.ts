/**
 * 创意平台读工具：ownDraft 缺失时必须回退项目快照（回归 fix-read-characters-creative-adapter）。
 */
import assert from 'node:assert/strict'
import type { ProjectData } from '../src/api'
import { createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools'

let bad = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${(e as Error).message || e}`)
  }
}

function toolOf(tools: { name: string }[], name: string) {
  const t = tools.find((x) => x.name === name)
  assert.ok(t, `工具 ${name} 应存在`)
  return t as { invoke: (a: unknown) => Promise<Record<string, unknown>> }
}

function project(over: Partial<ProjectData> = {}): ProjectData {
  return {
    name: '演示项目',
    logline: '',
    style: '',
    aspect: '16:9',
    source: '',
    shots: [],
    characters: [
      { id: 'c1', name: '陈默', look_en: 'black coat' },
      { id: 'c2', name: '林小满', look_en: 'white dress' },
    ],
    designs: [{ id: 's1', kind: 'scene', name: '雨夜街口' }],
    assets: [],
    episodes: [],
    ...over,
  } as unknown as ProjectData
}

async function main() {
  await check('创意路径 read_characters 读项目快照（非空）', async () => {
    const snap = project()
    const tools = createBuiltinPlatformTools({
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => snap,
    })
    const res = await toolOf(tools, 'read_characters').invoke({})
    assert.equal(res.ok, true)
    const chars = res.characters as { name: string }[]
    assert.equal(chars.length, 2)
    assert.deepEqual(
      chars.map((c) => c.name).sort(),
      ['林小满', '陈默'].sort(),
    )
  })

  await check('项目无角色时返回空数组而非错误', async () => {
    const snap = project({ characters: [] })
    const tools = createBuiltinPlatformTools({
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => snap,
    })
    const res = await toolOf(tools, 'read_characters').invoke({})
    assert.equal(res.ok, true)
    assert.deepEqual(res.characters, [])
    assert.equal(res.total, 0)
  })

  await check('names 过滤语义不变', async () => {
    const tools = createBuiltinPlatformTools({
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => project(),
    })
    const res = await toolOf(tools, 'read_characters').invoke({ names: ['林小满'] })
    assert.equal(res.ok, true)
    const chars = res.characters as { name: string }[]
    assert.deepEqual(chars.map((c) => c.name), ['林小满'])
  })

  await check('超限截断可解析', async () => {
    const big = Array.from({ length: 12 }, (_, i) => ({
      id: `c-${i}`,
      name: `角色${i}`,
      look_en: 'x'.repeat(800),
    }))
    const snap = project({ characters: big })
    const tools = createBuiltinPlatformTools({
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => snap,
    })
    const res = await toolOf(tools, 'read_characters').invoke({})
    assert.equal(res.ok, true)
    assert.equal(res.total, 12)
    assert.equal(res.truncated, true)
    const parsed = JSON.parse(JSON.stringify(res)) as {
      characters: { look_en: string }[]
    }
    for (const c of parsed.characters) assert.equal(typeof c.look_en, 'string')
  })

  await check('创意路径 read_designs 读项目设定卡', async () => {
    const tools = createBuiltinPlatformTools({
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => project(),
    })
    const res = await toolOf(tools, 'read_designs').invoke({})
    assert.equal(res.ok, true)
    const designs = res.designs as { name: string }[]
    assert.deepEqual(designs.map((d) => d.name), ['雨夜街口'])
  })

  await check('未选项目时 read_characters 返回可读错误', async () => {
    const tools = createBuiltinPlatformTools({ projectName: '', epNo: 1 })
    const res = await toolOf(tools, 'read_characters').invoke({})
    assert.equal(res.ok, false)
    assert.ok(String(res.error).includes('项目'), res.error)
  })
}

await main()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n创意读快照回归全部通过')
if (bad) process.exitCode = 1