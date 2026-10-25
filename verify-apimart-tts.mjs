/**
 * APIMart TTS：协议、音色回落、错误 JSON。
 * 跑法：node verify-apimart-tts.mjs
 */
import { synthesizeSpeech } from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

let seen = null
const bytes = Buffer.from('mp3-bytes')
const mock = async (url, init) => {
  seen = { url: String(url), body: JSON.parse(init.body) }
  return new Response(bytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
}
const out = await synthesizeSpeech({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  text: '今天天气真好',
  voice: 'nova',
  fetchImpl: mock,
})
check('TTS 端点', seen?.url === 'https://api.apimart.ai/v1/audio/speech', seen?.url)
check('TTS 请求字段', seen?.body.model === 'gpt-4o-mini-tts' && seen?.body.input === '今天天气真好')
check('TTS 音色', seen?.body.voice === 'nova')
check('TTS 格式', seen?.body.response_format === 'mp3')
check('TTS 二进制', out.audio.equals(bytes) && out.voice === 'nova')

await synthesizeSpeech({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  text: 'x',
  voice: 'Tingting',
  fetchImpl: mock,
})
check('未知音色回落 alloy', seen?.body.voice === 'alloy', seen?.body.voice)

const jsonErr = await synthesizeSpeech({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  text: 'x',
  fetchImpl: async () =>
    new Response('{"error":{"message":"invalid voice"}}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
}).catch((e) => e)
check('错误 JSON 识别', jsonErr?.kind === 'bad-request' && /invalid voice/.test(jsonErr.message), jsonErr?.message)

const empty = await synthesizeSpeech({
  baseUrl: 'https://api.apimart.ai/v1',
  apiKey: 'k',
  text: 'x',
  fetchImpl: async () => new Response('', { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
}).catch((e) => e)
check('空音频报错', empty?.kind === 'api' && /空响应/.test(empty.message), empty?.message)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
