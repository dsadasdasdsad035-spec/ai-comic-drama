import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { defineTool } from '../src/agent/tool'
import { toolParameters, toPiTool } from '../src/agent/pi/toolAdapter'
import { toProviderMessages } from '../src/agent/pi/messages'
import { normalizeSceneCodeArg } from '../src/agent/sceneAgentTools'

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

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const readSource = defineTool({
  name: 'read_source',
  description: '读取原著',
  schema: z.object({}),
  run: async () => ({ ok: true }),
})

// ---------------------------------------------------------------- 工具声明
check('工具声明由 zod 生成', () => {
  const params = toolParameters(readSource.schema) as { type?: string; properties?: unknown }
  assert.equal(params.type, 'object')
  assert.ok(params.properties)
})

check('声明里不含 $schema / $id', () => {
  const params = toolParameters(readSource.schema)
  assert.ok(!('$schema' in params))
  assert.ok(!('$id' in params))
})

// input 语义：带 .default() 的字段不能进 required，否则模型漏传会被判非法。
const withDefault = defineTool({
  name: 'submit_designs',
  description: '提交场景与道具',
  schema: z.object({
    scenes: z.array(z.object({ name: z.string() })).optional().default([]),
    props: z.array(z.string()).optional().default([]),
    title: z.string(),
  }),
  run: async () => ({ ok: true }),
})

check('带默认值的字段不进 required', () => {
  const params = toolParameters(withDefault.schema) as { required?: string[] }
  assert.deepEqual(params.required, ['title'])
})

await checkAsync('工具参数校验生效', async () => {
  const tool = toPiTool(withDefault)
  // pi 契约要求失败编码成结果而不是抛出，因此这里断言 isError 与可读原因。
  const result = await tool.execute('c1', {} as never)
  assert.equal(result.isError, true)
  const text = (result.content[0] as { text: string }).text
  assert.ok(text.includes('title'), '错误应指出缺失的字段')
})

await checkAsync('工具成功时返回摘要与完整结果', async () => {
  const tool = toPiTool(readSource)
  const result = await tool.execute('c1', {} as never)
  assert.equal(result.isError, undefined)
  assert.ok(Array.isArray(result.content))
  assert.equal((result.details as { ok?: boolean }).ok, true)
})

await checkAsync('ok:false 映射为 isError', async () => {
  const failing = defineTool({
    name: 'read_missing',
    description: '失败工具',
    schema: z.object({}),
    run: async () => ({ ok: false, error: '没有数据' }),
  })
  const result = await toPiTool(failing).execute('c1', {} as never)
  assert.equal(result.isError, true)
})

await checkAsync('finish 成功后要求终止本轮', async () => {
  const finish = defineTool({
    name: 'finish',
    description: '结束',
    schema: z.object({ summary: z.string() }),
    run: async () => ({ ok: true, summary: '完成' }),
  })
  const result = await toPiTool(finish).execute('c1', { summary: '完成' } as never)
  assert.equal(result.terminate, true)
})

await checkAsync('抓帧结果对模型只保留时间点', async () => {
  const capture = defineTool({
    name: 'capture_frames',
    description: '抓帧',
    schema: z.object({}),
    run: async () => ({
      ok: true,
      frames: [
        { t: 0, url: 'data:image/jpeg;base64,AAAA' },
        { t: 1, url: 'data:image/jpeg;base64,BBBB' },
      ],
    }),
  })
  const result = await toPiTool(capture).execute('c1', {} as never)
  const text = (result.content[0] as { text: string }).text
  assert.ok(!text.includes('data:image'), '模型可见内容不应包含帧数据地址')
  assert.ok(text.includes('"t":0'), '时间点应保留给模型')
  // 界面仍拿完整结果
  assert.equal((result.details as { frames: unknown[] }).frames.length, 2)
})

// ---------------------------------------------------------------- 消息转换
check('pi 消息转 provider 消息', () => {
  const out = toProviderMessages([
    { role: 'system', content: '系统', timestamp: 1 },
    { role: 'user', content: '你好', timestamp: 2 },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '我先读上下文' },
        { type: 'toolCall', id: 'c1', name: 'read_source', arguments: {} },
      ],
      timestamp: 3,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'read_source',
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
      timestamp: 4,
    },
  ] as never)
  assert.deepEqual(
    out.map((m) => m.role),
    ['system', 'user', 'assistant', 'tool'],
  )
})

// ---------------------------------------------------------------- 依赖边界
check('上游依赖只出现在 src/agent/pi', () => {
  const root = process.cwd()
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const offenders = walk(path.join(root, 'src'))
    .filter((file) => !file.startsWith(path.join(root, 'src/agent/pi') + path.sep))
    .filter((file) => /@earendil-works\//.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  assert.deepEqual(offenders, [])
})

check('没有 LangChain 残留', () => {
  const root = process.cwd()
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const offenders = walk(path.join(root, 'src'))
    .filter((file) => /@langchain\/|langgraph|StateGraph/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  assert.deepEqual(offenders, [])
})

check('用户消息保留图片块，工具结果丢掉图片', () => {
  const out = toProviderMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '看这两张' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
      ],
      timestamp: 1,
    },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c1', name: 'capture_frames', arguments: {} }],
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'capture_frames',
      content: [
        { type: 'text', text: '{"ok":true,"frames":[{"t":0}]}' },
        { type: 'image', data: 'FRAME', mimeType: 'image/jpeg' },
      ],
      isError: false,
      timestamp: 3,
    },
  ] as never)
  const user = out.find((m) => m.role === 'user')
  assert.ok(Array.isArray(user?.content))
  const parts = user?.content as { type: string; data?: string }[]
  assert.equal(parts.filter((part) => part.type === 'image').length, 2)
  const tool = out.find((m) => m.role === 'tool')
  assert.equal(typeof tool?.content, 'string')
  assert.equal(String(tool?.content).includes('FRAME'), false)
  assert.equal(String(tool?.content).includes('data:image'), false)
})

check('set_scene_code 的字面 \\n 在工具侧还原', () => {
  const literal = 'import bpy\\n\\ndef build(ctx):\\n    pass'
  const normalized = normalizeSceneCodeArg(literal)
  assert.ok(normalized.includes('\n'))
  assert.ok(!normalized.includes('\\n'))
})

check('已有真实换行的代码不被二次处理', () => {
  const code = 'import bpy\n\n# 保留字面 \\n 说明\ndef build(ctx):\n    pass'
  assert.equal(normalizeSceneCodeArg(code), code)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
