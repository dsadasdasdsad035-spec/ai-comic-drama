/**
 * 火山 Seed TTS 客户端验证（不调用真实语音服务）：
 * 1) 请求体与默认音色
 * 2) 行式 JSON 多块音频合并、结束标记
 * 3) 空音频、非 JSON、扣减未开启、鉴权、业务错误
 * 跑法：node verify-volc-tts.mjs
 */
import http from 'node:http'
import {
  DEFAULT_VOLC_TTS_VOICE,
  VOLC_TTS_VOICES,
  VolcTtsError,
  buildTtsBody,
  synthesizeVolcTts,
} from './server/volc-tts.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const capture = async (fn) => {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

let mode = 'success'
let lastHeaders = null
let lastBody = null

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/v3/plan/tts/unidirectional') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  lastHeaders = req.headers
  try {
    lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    lastBody = null
  }
  res.setHeader('Content-Type', 'application/json')

  if (mode === 'auth') {
    res.statusCode = 401
    res.end(JSON.stringify({ header: { code: 45000010, message: 'Invalid X-Api-Key' } }))
    return
  }
  if (mode === 'deduction') {
    res.end(
      JSON.stringify({
        code: 45000030,
        message: 'acquire failed err:AgentPlanDeductNotEnabled message:enable the deduction setting',
      }) + '\n',
    )
    return
  }
  if (mode === 'business') {
    res.end(JSON.stringify({ code: 12345, message: 'synthesis failed' }) + '\n')
    return
  }
  if (mode === 'empty') {
    res.end(JSON.stringify({ code: 20000000 }) + '\n')
    return
  }
  if (mode === 'badjson') {
    res.end('not-json\n')
    return
  }

  const a = Buffer.from('hello-').toString('base64')
  const b = Buffer.from('world').toString('base64')
  const ignored = Buffer.from('ignored').toString('base64')
  res.end(
    [
      JSON.stringify({ code: 0, data: a }),
      JSON.stringify({ code: 0, data: b }),
      JSON.stringify({ code: 20000000 }),
      JSON.stringify({ code: 0, data: ignored }),
    ].join('\n') + '\n',
  )
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/v3/plan`

// ---- 请求体 ----
const body = buildTtsBody({ text: '你好', speaker: 'not-a-volc-voice' })
check('非法音色回落默认音色', body.req_params.speaker === DEFAULT_VOLC_TTS_VOICE, body.req_params.speaker)
check(
  '请求体音频参数',
  body.req_params.audio_params.format === 'mp3' && body.req_params.audio_params.sample_rate === 24000,
  JSON.stringify(body.req_params.audio_params),
)
const eEmptyText = await capture(async () => buildTtsBody({ text: '  ' }))
check('空台词报错', eEmptyText instanceof VolcTtsError && eEmptyText.kind === 'config', eEmptyText?.message)

// ---- 成功 ----
const speaker = VOLC_TTS_VOICES[1].id
const done = await synthesizeVolcTts({ baseUrl: base, apiKey: 'test-key', text: '你好', speaker })
check('多块音频合并', done.audio.toString() === 'hello-world', done.audio.toString())
check('结束标记后的音频被忽略', !done.audio.toString().includes('ignored'))
check('引擎标识', done.engine === `volc-tts:${speaker}`, done.engine)
check(
  '请求头正确',
  lastHeaders?.['x-api-key'] === 'test-key' &&
    lastHeaders?.['x-api-resource-id'] === 'seed-tts-2.0' &&
    Boolean(lastHeaders?.['x-api-connect-id']),
  JSON.stringify(lastHeaders),
)
check(
  '请求体正确',
  lastBody?.req_params?.text === '你好' && lastBody?.req_params?.speaker === speaker,
  JSON.stringify(lastBody),
)

// ---- 错误 ----
mode = 'empty'
const eEmpty = await capture(async () => synthesizeVolcTts({ baseUrl: base, apiKey: 'k', text: '你好' }))
check('没有音频数据报协议错误', eEmpty instanceof VolcTtsError && eEmpty.kind === 'protocol', eEmpty?.message)

mode = 'badjson'
const eBadJson = await capture(async () => synthesizeVolcTts({ baseUrl: base, apiKey: 'k', text: '你好' }))
check('非 JSON 行报协议错误', eBadJson instanceof VolcTtsError && eBadJson.kind === 'protocol', eBadJson?.message)

mode = 'deduction'
const eDeduct = await capture(async () => synthesizeVolcTts({ baseUrl: base, apiKey: 'k', text: '你好' }))
check(
  '扣减未开启给出可操作提示',
  eDeduct instanceof VolcTtsError && eDeduct.kind === 'plan' && /开启扣减/.test(eDeduct.message),
  `${eDeduct?.kind} | ${eDeduct?.message}`,
)

mode = 'auth'
const eAuth = await capture(async () => synthesizeVolcTts({ baseUrl: base, apiKey: 'k', text: '你好' }))
check('401 映射鉴权错误', eAuth instanceof VolcTtsError && eAuth.kind === 'auth', `${eAuth?.kind} | ${eAuth?.message}`)

mode = 'business'
const eBusiness = await capture(async () => synthesizeVolcTts({ baseUrl: base, apiKey: 'k', text: '你好' }))
check(
  '业务码保留 code 与消息',
  eBusiness instanceof VolcTtsError && eBusiness.kind === 'api' && /12345/.test(eBusiness.message),
  `${eBusiness?.kind} | ${eBusiness?.message}`,
)

await new Promise((resolve) => server.close(resolve))
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
