/**
 * pi 适配层单元验收：消息转换 + streamFn 事件/错误/取消编码。
 * 跑法：node verify-pi-engine.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-pi-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/messages.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/streamFn.ts'))}`,
    '',
  ].join('\n'),
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

async function collect(stream) {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

const MODEL = { id: 'fake-model', api: 'fake-api', provider: 'fake-provider' }

// ---------------------------------------------------------------- 3.1 消息转换
{
  const messages = [
    { role: 'system', content: '系统一', timestamp: 1 },
    { role: 'user', content: [{ type: 'text', text: '用户问题' }], timestamp: 2 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '隐藏推理' },
        { type: 'text', text: '我先读上下文' },
        { type: 'toolCall', id: 'c1', name: 'get_shot_context', arguments: {} },
      ],
      timestamp: 3,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'get_shot_context',
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
      timestamp: 4,
    },
    { role: 'system', content: '系统二（中间）', timestamp: 5 },
    { role: 'assistant', content: [{ type: 'text', text: '完成' }], timestamp: 6 },
    { role: 'toolResult', toolCallId: 'orphan', toolName: 'x', content: [{ type: 'text', text: '孤立' }], isError: false, timestamp: 7 },
  ]
  const out = lib.toProviderMessages(messages)
  const roles = out.map((m) => m.role)
  check('消息转换角色序列', JSON.stringify(roles) === JSON.stringify(['system', 'user', 'assistant', 'tool', 'assistant']), JSON.stringify(roles))
  check('中间 system 合并进首条', out[0].content === '系统一\n\n系统二（中间）', out[0].content)
  check('assistant 工具调用还原', Array.isArray(out[2].tool_calls) && out[2].tool_calls[0].function.name === 'get_shot_context', JSON.stringify(out[2].tool_calls))
  check('assistant 保留面向用户文本', out[2].content === '我先读上下文', out[2].content)
  check('thinking 不进入模型历史', !JSON.stringify(out).includes('隐藏推理'))
  check('toolResult 带 tool_call_id', out[3].tool_call_id === 'c1' && out[3].name === 'get_shot_context', JSON.stringify(out[3]))
  check('孤立 toolResult 被丢弃', !JSON.stringify(out).includes('孤立'), JSON.stringify(out.map((m) => m.role)))
}

// ---------------------------------------------------------------- 3.2 文本流事件
{
  const stream = lib.createPiStreamFn({ ask: async () => ({ text: 'hello', finishReason: 'stop' }) })(MODEL, { messages: [] })
  const events = await collect(stream)
  const types = events.map((e) => e.type).join(',')
  check('文本流事件顺序', types === 'start,text_start,text_delta,text_end,done', types)
  const done = events.find((e) => e.type === 'done')
  const message = done.message
  check(
    '最终消息字段完整',
    message.role === 'assistant' &&
      message.api === 'fake-api' &&
      message.provider === 'fake-provider' &&
      message.model === 'fake-model' &&
      typeof message.timestamp === 'number' &&
      message.stopReason === 'stop' &&
      message.usage.totalTokens === 0,
    JSON.stringify({ api: message.api, stopReason: message.stopReason }),
  )
  check('文本内容完整落地', message.content[0].text === 'hello', JSON.stringify(message.content))
}

// ---------------------------------------------------------------- 3.3 工具调用映射
{
  const deltas = []
  const stream = lib.createPiStreamFn({
    ask: async () => ({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'c1', name: 'ping', arguments: '{"x":7}' }],
    }),
    onToolCallDelta: (d) => deltas.push(d),
  })(MODEL, { messages: [] })
  const events = await collect(stream)
  const types = events.map((e) => e.type).join(',')
  check('工具流事件顺序', types === 'start,toolcall_start,toolcall_delta,toolcall_end,done', types)
  const done = events.find((e) => e.type === 'done')
  check('工具调用进入最终消息', done.message.content.some((c) => c.type === 'toolCall' && c.name === 'ping' && c.arguments.x === 7), JSON.stringify(done.message.content))
  check('done 标记 toolUse', done.reason === 'toolUse' && done.message.stopReason === 'toolUse', String(done.reason))
  const delta = events.find((e) => e.type === 'toolcall_delta')
  check('参数分片只作为事件', delta.delta === '{"x":7}', delta.delta)
  check('工具未在流内执行', !types.includes('tool_execution'), types)
}

// ---------------------------------------------------------------- 3.4 错误与取消编码
{
  const stream = lib.createPiStreamFn({ ask: async () => { throw new Error('boom') } })(MODEL, { messages: [] })
  const events = await collect(stream)
  const error = events.find((e) => e.type === 'error')
  check('普通错误编码为 error', error?.reason === 'error' && error.error.stopReason === 'error' && error.error.errorMessage.includes('boom'), JSON.stringify(error?.error?.errorMessage))
}
{
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  const stream = lib.createPiStreamFn({ ask: async () => { throw abort } })(MODEL, { messages: [] })
  const events = await collect(stream)
  const error = events.find((e) => e.type === 'error')
  check('AbortError 编码为 aborted', error?.reason === 'aborted' && error.error.stopReason === 'aborted', JSON.stringify(error?.reason))
}
{
  let called = 0
  const controller = new AbortController()
  controller.abort()
  const stream = lib.createPiStreamFn({ ask: async () => { called++; return { text: 'x' } } })(MODEL, { messages: [] }, { signal: controller.signal })
  const events = await collect(stream)
  check('已取消时不调用渠道', called === 0, String(called))
  check('已取消时直接返回 aborted', events[0]?.type === 'error' && events[0].reason === 'aborted', JSON.stringify(events[0]?.type))
}
{
  const stream = lib.createPiStreamFn({
    ask: async () => ({ text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'c1', name: 'ping', arguments: '{"x":' }] }),
  })(MODEL, { messages: [] })
  const events = await collect(stream)
  const error = events.find((e) => e.type === 'error')
  check('非法工具参数编码为 error', Boolean(error) && error.error.errorMessage.includes('合法 JSON'), error?.error?.errorMessage)
  check('非法参数不产生 toolcall_end', !events.some((e) => e.type === 'toolcall_end'), events.map((e) => e.type).join(','))
}

// ---------------------------------------------------------------- 3.5 截断
{
  const stream = lib.createPiStreamFn({
    ask: async () => ({ text: 'abc', finishReason: 'length', toolCalls: [{ id: 'c1', name: 'ping', arguments: '{"x":1}' }] }),
  })(MODEL, { messages: [] })
  const events = await collect(stream)
  const error = events.find((e) => e.type === 'error')
  check('length 编码为 error', Boolean(error) && error.error.errorMessage.includes('长度上限'), error?.error?.errorMessage)
  check('截断时不产出工具调用', !events.some((e) => e.type === 'toolcall_end'), events.map((e) => e.type).join(','))
}
{
  const stream = lib.createPiStreamFn({ ask: async () => ({ text: 'abc', finishReason: 'length' }) })(MODEL, { messages: [] })
  const events = await collect(stream)
  const error = events.find((e) => e.type === 'error')
  check('纯文本截断也报错', Boolean(error) && error.error.errorMessage.includes('截断'), error?.error?.errorMessage)
}

// ---------------------------------------------------------------- 工具声明转换
{
  const fns = lib.toOpenAIFunctions([
    { name: 'ping', description: 'ping it', parameters: { $schema: 'x', $id: 'y', type: 'object', properties: { x: { type: 'number' } } } },
  ])
  check('工具声明转 OpenAI function', fns[0].type === 'function' && fns[0].function.name === 'ping' && fns[0].function.parameters.properties.x.type === 'number', JSON.stringify(fns[0]))
  check('工具声明去掉 $schema/$id', !('$schema' in fns[0].function.parameters) && !('$id' in fns[0].function.parameters), JSON.stringify(fns[0].function.parameters))
}


// ---------------------------------------------------------------- 依赖边界
{
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const allowed = [
    path.join(root, 'src/agent/pi') + path.sep,
    path.join(root, 'src/agent') + path.sep + 'sceneAgentGraph.ts',
  ]
  const offenders = walk(path.join(root, 'src'))
    .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)))
    .filter((file) => /@earendil-works\//.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  check('上游依赖只出现在 src/agent/pi 与门面选择器', offenders.length === 0, JSON.stringify(offenders))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\npi 适配层验收通过')
process.exitCode = bad ? 1 : 0
