/**
 * APIMart 错误映射与文本响应归一化。
 * 跑法：node verify-apimart-errors.mjs
 */
import {
  ApimartError,
  apimartResponseToChatCompletion,
  buildApimartResponsesBody,
  apimartUsesResponsesForTools,
  chatMessagesToApimartResponseInput,
  errorFromResponse,
  normalizeChatPayload,
  normalizeSseChunk,
  toApimartResponseTools,
} from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const kindOf = (fn) => {
  try {
    fn()
    return 'no-error'
  } catch (e) {
    return e instanceof ApimartError ? e.kind : 'wrong-error'
  }
}

check('402 余额不足', errorFromResponse('{"error":{"code":"x","message":"insufficient balance"}}', 402).kind === 'billing')
check('401 鉴权失败', errorFromResponse('{"error":{"message":"bad key"}}', 401).kind === 'auth')
check('429 限流', errorFromResponse('{"error":{"message":"rate limit"}}', 429).kind === 'rate-limit')
check('400 参数错误', errorFromResponse('{"error":{"message":"invalid"}}', 400).kind === 'bad-request')
check('500 普通 API 错误', errorFromResponse('{"error":{"message":"boom"}}', 500).kind === 'api')

const wrapped = { code: 200, data: { choices: [{ message: { content: 'hi' } }] } }
const unwrapped = { choices: [{ message: { content: 'hi' } }] }
check('非流式解包 data', normalizeChatPayload(wrapped).choices?.[0]?.message?.content === 'hi')
check('非流式裸响应', normalizeChatPayload(unwrapped).choices?.[0]?.message?.content === 'hi')

const chunkWrapped = normalizeSseChunk({ code: 200, data: { choices: [{ delta: { content: 'a' } }] } })
check('SSE 解包 data.choices', chunkWrapped?.choices?.[0]?.delta?.content === 'a')
const chunkNested = normalizeSseChunk({ code: 200, data: { delta: { content: 'b' }, finish_reason: 'stop' } })
check('SSE 解包 data.delta', chunkNested?.choices?.[0]?.delta?.content === 'b')
const chunkRaw = normalizeSseChunk({ choices: [{ delta: { content: 'c' } }] })
check('SSE 裸 chunk', chunkRaw?.choices?.[0]?.delta?.content === 'c')
check(
  'SSE 错误块',
  kindOf(() => normalizeSseChunk({ error: { message: 'bad' } })) === 'api',
)
check(
  'SSE code 非 200',
  kindOf(() => normalizeSseChunk({ code: 402, message: 'insufficient balance' })) === 'api',
)

check('gpt-6.1-sol 走 Responses', apimartUsesResponsesForTools('gpt-6.1-sol'))
check('deepseek-v4-flash 仍走 chat/completions', !apimartUsesResponsesForTools('deepseek-v4-flash'))

const respTools = toApimartResponseTools([
  { type: 'function', function: { name: 'ping', description: 'd', parameters: { type: 'object' } } },
])
check('Responses tools 扁平 name', respTools[0]?.name === 'ping' && !respTools[0]?.function)

const respInput = chatMessagesToApimartResponseInput([
  { role: 'user', content: 'hi' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
  },
  { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
])
check(
  'Responses input 含 function_call 链',
  respInput.some((x) => x.type === 'function_call') && respInput.some((x) => x.type === 'function_call_output'),
)

const chatShape = apimartResponseToChatCompletion({
  output: [
    { type: 'function_call', call_id: 'c1', name: 'ping', arguments: '{}' },
  ],
})
check(
  'Responses 转 chat tool_calls',
  chatShape.choices?.[0]?.message?.tool_calls?.[0]?.function?.name === 'ping',
)

const respBody = buildApimartResponsesBody({
  model: 'gpt-6.1-sol',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ type: 'function', function: { name: 'ping', description: 'd', parameters: { type: 'object' } } }],
  maxTokens: 128,
})
check('Responses 请求体不含 temperature', !('temperature' in respBody))
check(
  'Responses 请求体 tools parameters 为 object',
  respBody.tools?.[0]?.parameters?.type === 'object',
)
check('Responses 请求体 tools 无顶层 anyOf', !respBody.tools?.[0]?.parameters?.anyOf)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
