/**
 * 原生工具调用的纯逻辑验收：能力表、协议选择、服务端归一化、流式工具参数聚合、消息映射。
 * 不依赖浏览器、Blender 或真实模型；ts 模块用 esbuild 现场打包后导入。
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

const tmp = path.join(process.cwd(), '.verify-native-tool-protocol')
mkdirSync(tmp, { recursive: true })

async function bundle(entry, name, external = []) {
  const outfile = path.join(tmp, name)
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    external,
  })
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`)
}

try {
  const caps = await bundle('src/agent/toolCapabilities.ts', 'toolCapabilities.mjs')

  // 能力表：只声明实测过的四个模型
  assert.equal(caps.supportsNativeTools('minimax', 'MiniMax-M3'), true)
  assert.equal(caps.supportsNativeTools('ark-plan', 'doubao-seed-2-1-lite-260915'), true)
  assert.equal(caps.supportsNativeTools('ark-plan', 'deepseek-v4-flash'), true)
  assert.equal(caps.supportsNativeTools('ark-plan', 'kimi-k3'), true)
  assert.equal(caps.supportsNativeTools('minimax', 'MiniMax-Unknown'), false)
  assert.equal(caps.supportsNativeTools('ark-plan', 'doubao-seed-2-1-pro-260915'), false)
  assert.equal(caps.supportsNativeTools(undefined, 'MiniMax-M3'), false)

  // thinking 策略：已验证模型关闭 thinking，未知模型不设置
  for (const [provider, model] of [
    ['minimax', 'MiniMax-M3'],
    ['ark-plan', 'doubao-seed-2-1-lite-260915'],
    ['ark-plan', 'deepseek-v4-flash'],
    ['ark-plan', 'kimi-k3'],
  ]) {
    assert.equal(caps.toolThinkingMode(provider, model), 'disable')
  }
  assert.equal(caps.toolThinkingMode('minimax', 'unknown-model'), 'omit')

  // 协议选择
  assert.deepEqual(caps.resolveToolProtocol('auto', 'minimax', 'MiniMax-M3'), {
    protocol: 'native',
    reason: 'auto-native',
  })
  assert.deepEqual(caps.resolveToolProtocol('auto', 'ark', 'unknown-model'), {
    protocol: 'json',
    reason: 'auto-json',
  })
  assert.deepEqual(caps.resolveToolProtocol('json', 'minimax', 'MiniMax-M3'), {
    protocol: 'json',
    reason: 'forced-json',
  })
  assert.deepEqual(caps.resolveToolProtocol('native', 'minimax', 'MiniMax-M3'), {
    protocol: 'native',
    reason: 'forced-native',
  })
  const forced = caps.resolveToolProtocol('native', 'ark', 'unknown-model')
  assert.equal(forced.protocol, 'json')
  assert.equal(forced.reason, 'forced-native')
  assert.match(forced.error, /未声明支持原生工具调用/)

  // 设置值归一化
  assert.equal(caps.normalizeToolProtocol('native'), 'native')
  assert.equal(caps.normalizeToolProtocol('json'), 'json')
  assert.equal(caps.normalizeToolProtocol('garbage'), 'auto')
  assert.equal(caps.normalizeToolProtocol(undefined), 'auto')

  // ---- 服务端归一化 ----
  const serverTools = await import('./server/text-tools.mjs')

  const messages = serverTools.normalizeChatMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
    },
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1', name: 'x' },
    { role: 'tool', content: 'orphan' },
    { role: 'bogus', content: 'drop' },
  ])
  assert.equal(messages.length, 4)
  assert.equal(messages[2].role, 'assistant')
  assert.equal(messages[2].tool_calls.length, 1)
  assert.equal(messages[3].tool_call_id, 'c1')

  const calls = serverTools.normalizeToolCalls(
    [
      { id: 'a', function: { name: 'x', arguments: '{"n":1}' } },
      { function: { name: 'y', arguments: { n: 2 } } },
      { function: {} },
    ],
    'call_test',
  )
  assert.deepEqual(calls, [
    { id: 'a', name: 'x', arguments: '{"n":1}' },
    { id: 'call_test_1', name: 'y', arguments: '{"n":2}' },
  ])

  const schemas = serverTools.normalizeToolSchemas([
    { type: 'function', function: { name: 'x', description: 'dx', parameters: { type: 'object' } } },
    { type: 'function', function: {} },
  ])
  assert.equal(schemas.length, 1)
  assert.equal(schemas[0].function.name, 'x')
  assert.equal(schemas[0].function.description, 'dx')

  assert.match(
    serverTools.toolRequestError({ tools: [{}], providerId: 'ark', model: 'm', supported: false }),
    /未声明支持原生工具调用/,
  )
  assert.equal(
    serverTools.toolRequestError({ tools: [{}], providerId: 'minimax', model: 'MiniMax-M3', supported: true }),
    '',
  )
  assert.equal(serverTools.toolRequestError({ tools: [], supported: false }), '')

  // ---- 流式工具参数聚合 ----
  const { ChatStreamParser } = await import('./server/text-stream.mjs')
  const parser = new ChatStreamParser()
  const sse = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"get_weather","arguments":"{\\"ci"}}]},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"北京\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"get_time","arguments":"{}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"completion_tokens":12}}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const deltas = []
  for (let i = 0; i < sse.length; i += 37) {
    const out = parser.push(sse.slice(i, i + 37))
    deltas.push(...out.toolDeltas)
  }
  const final = parser.end()
  assert.equal(final.finishReason, 'tool_calls')
  assert.equal(final.toolCalls.length, 2)
  assert.deepEqual(final.toolCalls[0], {
    id: 'call_a',
    name: 'get_weather',
    arguments: '{"city":"北京"}',
  })
  assert.equal(final.toolCalls[1].name, 'get_time')
  assert.ok(deltas.length >= 3)
  assert.equal(deltas[0].id, 'call_a')
  assert.equal(final.usage.completion_tokens, 12)

  const plain = new ChatStreamParser()
  const plainOut = plain.push('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n')
  assert.deepEqual(plainOut.toolDeltas, [])
  assert.equal(plain.end().toolCalls.length, 0)

  // ---- 客户端原生模型 ----
  const nativeMod = await bundle('src/agent/nativeToolChatModel.ts', 'nativeToolChatModel.mjs', [
    '@langchain/core',
    '@langchain/core/*',
  ])

  const tool = new DynamicStructuredTool({
    name: 'get_weather',
    description: '查天气',
    schema: z.object({ city: z.string().describe('城市') }),
    func: async () => 'ok',
  })
  const openaiTool = nativeMod.toOpenAITool(tool)
  assert.equal(openaiTool.type, 'function')
  assert.equal(openaiTool.function.name, 'get_weather')
  assert.equal(openaiTool.function.parameters.type, 'object')
  assert.equal(openaiTool.function.parameters.$schema, undefined)
  assert.ok(openaiTool.function.parameters.properties.city)

  const mapped = nativeMod.toProviderMessages([
    new SystemMessage('系统角色'),
    new HumanMessage('你好'),
    new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'get_weather', args: { city: '北京' } }],
    }),
    new ToolMessage({ content: '{"ok":true}', tool_call_id: 'c1', name: 'get_weather' }),
    new SystemMessage('[场景草稿] 摘要'),
    new AIMessage('完成'),
  ])
  assert.equal(mapped[0].role, 'system')
  assert.match(mapped[0].content, /系统角色/)
  assert.match(mapped[0].content, /场景草稿/)
  assert.deepEqual(mapped.slice(1).map((m) => m.role), ['user', 'assistant', 'tool', 'assistant'])
  assert.equal(mapped[2].tool_calls[0].id, 'c1')
  assert.equal(mapped[2].tool_calls[0].function.arguments, '{"city":"北京"}')
  assert.equal(mapped[3].tool_call_id, 'c1')

  const orphan = nativeMod.toProviderMessages([
    new HumanMessage('hi'),
    new ToolMessage({ content: 'x', tool_call_id: 'missing' }),
  ])
  assert.deepEqual(orphan.map((m) => m.role), ['user'])

  const askCalls = []
  const model = new nativeMod.NativeToolChatModel({
    ask: async (opts) => {
      askCalls.push(opts)
      return {
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'call_a', name: 'get_weather', arguments: '{"city":"北京"}' },
          { id: 'call_b', name: 'get_time', arguments: '{}' },
        ],
      }
    },
    tools: [tool],
  })
  const result = await model._generate([new HumanMessage('查天气')], {})
  assert.equal(askCalls.length, 1)
  assert.equal(askCalls[0].messages[0].role, 'user')
  assert.equal(askCalls[0].tools[0].function.name, 'get_weather')
  assert.equal(askCalls[0].toolChoice, 'auto')
  const ai = result.generations[0].message
  assert.deepEqual(ai.tool_calls.map((c) => c.name), ['get_weather', 'get_time'])
  assert.deepEqual(ai.tool_calls[0].args, { city: '北京' })

  await assert.rejects(
    () =>
      new nativeMod.NativeToolChatModel({
        ask: async () => ({
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'x', name: 'bad', arguments: '{oops' }],
        }),
        tools: [tool],
      })._generate([new HumanMessage('x')], {}),
    /不是合法 JSON/,
  )
  await assert.rejects(
    () =>
      new nativeMod.NativeToolChatModel({
        ask: async () => ({ text: '半截', finishReason: 'length' }),
        tools: [tool],
      })._generate([new HumanMessage('x')], {}),
    /长度上限/,
  )
  const plainAnswer = await new nativeMod.NativeToolChatModel({
    ask: async () => ({ text: '好的', finishReason: 'stop' }),
    tools: [tool],
  })._generate([new HumanMessage('x')], {})
  assert.equal(plainAnswer.generations[0].message.content, '好的')
  assert.equal(plainAnswer.generations[0].message.tool_calls?.length ?? 0, 0)

  // 参数增量回调原样透传；abort 原样抛出
  let seenDelta = null
  await new nativeMod.NativeToolChatModel({
    ask: async (opts) => {
      opts.onToolCallDelta?.({ index: 0, id: 'call_x', name: 'get_weather', delta: '{}' })
      return { text: 'ok', finishReason: 'stop' }
    },
    tools: [tool],
    onToolCallDelta: (delta) => { seenDelta = delta },
  })._generate([new HumanMessage('x')], {})
  assert.equal(seenDelta?.id, 'call_x')
  assert.equal(seenDelta?.name, 'get_weather')

  await assert.rejects(
    () =>
      new nativeMod.NativeToolChatModel({
        ask: async () => {
          throw new DOMException('aborted', 'AbortError')
        },
        tools: [tool],
      })._generate([new HumanMessage('x')], {}),
    (error) => error.name === 'AbortError',
  )

  console.log('OK native tool protocol: capabilities, server normalization, stream aggregation, message mapping, model calls')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
