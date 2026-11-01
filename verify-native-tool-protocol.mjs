/**
 * 原生工具调用的纯逻辑验收：能力表、协议选择、服务端归一化、流式工具参数聚合、消息映射。
 * 不依赖浏览器、Blender 或真实模型；ts 模块用 esbuild 现场打包后导入。
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
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

  // 能力表：8 个实测模型，判定以模型为键
  for (const model of [
    'MiniMax-M3',
    'doubao-seed-2-1-lite-260915',
    'doubao-seed-2-1-pro-260915',
    'doubao-seed-evolving',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'kimi-k3',
    'glm-5.3',
  ]) {
    assert.equal(caps.supportsNativeTools('ark-plan', model), true, `${model} 应支持原生工具`)
    assert.equal(caps.supportsNativeTools(undefined, model), true, `${model} 无渠道也应支持`)
  }
  assert.equal(caps.supportsNativeTools('minimax', 'MiniMax-Unknown'), false)
  assert.equal(caps.supportsNativeTools('deepseek', 'deepseek-chat'), false)
  assert.equal(caps.supportsNativeTools('apimart', 'gpt-5.1'), false)
  assert.equal(caps.supportsNativeTools('ark-plan', undefined), false)

  // 同一模型换渠道：判定不变，这是 model-only 键的核心保证
  assert.equal(
    caps.supportsNativeTools('minimax', 'MiniMax-M3'),
    caps.supportsNativeTools('apimart', 'MiniMax-M3'),
  )
  assert.equal(
    caps.supportsNativeTools('ark-plan', 'deepseek-v4-flash'),
    caps.supportsNativeTools('deepseek', 'deepseek-v4-flash'),
  )

  assert.ok(caps.nativeToolModels().length === 8)
  caps.requireNativeTools('apimart', 'no-such-model')

  // thinking 策略：已验证模型关闭 thinking，未知模型不设置
  for (const [provider, model] of [
    ['minimax', 'MiniMax-M3'],
    ['ark-plan', 'doubao-seed-2-1-lite-260915'],
    ['ark-plan', 'doubao-seed-2-1-pro-260915'],
    ['ark-plan', 'doubao-seed-evolving'],
    ['ark-plan', 'deepseek-v4-flash'],
    ['ark-plan', 'deepseek-v4-pro'],
    ['ark-plan', 'kimi-k3'],
    ['ark-plan', 'glm-5.3'],
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

  assert.equal(serverTools.toolRequestError({ tools: [{}], providerId: 'ark', model: 'm', supported: false }), '')
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

  // ---- 客户端工具声明与消息映射（由 pi 适配层承担） ----
  const toolMod = await bundle('src/agent/tool.ts', 'tool.mjs')
  const defineTool = toolMod.defineTool
  const adapter = await bundle('src/agent/pi/toolAdapter.ts', 'toolAdapter.mjs')
  const messagesMod = await bundle('src/agent/pi/messages.ts', 'piMessages.mjs')

  const tool = defineTool({
    name: 'get_weather',
    description: '查天气',
    schema: z.object({ city: z.string().describe('城市') }),
    run: async () => ({ ok: true }),
  })
  const params = adapter.toolParameters(tool.schema)
  assert.equal(params.type, 'object')
  assert.equal(params.$schema, undefined)
  assert.ok(params.properties.city)

  const mapped = messagesMod.toProviderMessages([
    { role: 'system', content: '系统角色', timestamp: 1 },
    { role: 'user', content: '你好', timestamp: 2 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c1', name: 'get_weather', arguments: { city: '北京' } }],
      timestamp: 3,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'get_weather',
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
      timestamp: 4,
    },
    { role: 'system', content: '[场景草稿] 摘要', timestamp: 5 },
    { role: 'assistant', content: [{ type: 'text', text: '完成' }], timestamp: 6 },
  ])
  assert.equal(mapped[0].role, 'system')
  assert.match(mapped[0].content, /系统角色/)
  assert.match(mapped[0].content, /场景草稿/)
  assert.deepEqual(mapped.slice(1).map((m) => m.role), ['user', 'assistant', 'tool', 'assistant'])
  assert.equal(mapped[2].tool_calls[0].id, 'c1')
  assert.equal(mapped[2].tool_calls[0].function.arguments, '{"city":"北京"}')
  assert.equal(mapped[3].tool_call_id, 'c1')

  const orphan = messagesMod.toProviderMessages([
    { role: 'user', content: 'hi', timestamp: 1 },
    { role: 'toolResult', toolCallId: 'missing', toolName: 'x', content: [{ type: 'text', text: 'x' }], isError: false, timestamp: 2 },
  ])
  assert.deepEqual(orphan.map((m) => m.role), ['user'])

  // 工具声明转 OpenAI function：$schema/$id 必须去掉，默认值字段不进 required
  const toolsMod = await bundle('src/agent/pi/toolAdapter.ts', 'toolFns.mjs')
  const piTools = toolsMod.toPiTools([
    defineTool({
      name: 'submit_x',
      description: '提交',
      schema: z.object({ items: z.array(z.string()).optional().default([]), title: z.string() }),
      run: async () => ({ ok: true }),
    }),
  ])
  const fn = piTools[0]
  assert.equal(fn.name, 'submit_x')
  assert.equal(fn.parameters.type, 'object')
  assert.deepEqual(fn.parameters.required, ['title'])
  assert.equal(fn.parameters.$schema, undefined)

  // 失败编码为 isError（pi 契约：不 throw）
  const failed = await piTools[0].execute("c1", {})
  assert.equal(failed.isError, true)

  console.log('OK native tool protocol: capabilities, server normalization, stream aggregation, message mapping, model calls')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
