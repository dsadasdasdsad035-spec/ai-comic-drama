/**
 * APIMart 目录映射与拉取。
 * 跑法：node verify-apimart-catalog.mjs
 */
import { fetchCatalog, mapCatalogEntry } from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const chat = mapCatalogEntry({ id: 'gpt-4o', category: 'chat', capability_tags: ['Text', 'Vision'] })
check('chat 带视觉', ['text', 'textPro', 'vision'].every((c) => chat.suggestedCaps.includes(c)), JSON.stringify(chat))
check('chat 可运行', chat.runtime === 'ready')
check('chat 视觉 feature', chat.features?.vision === true)

const image = mapCatalogEntry({ id: 'seedream-5-0-pro', category: 'image', capability_tags: ['Image Edit'] })
check('image 图像+三视图', ['image', 'view'].every((c) => image.suggestedCaps.includes(c)))
check('image 参考图', image.features?.imageRef === 'multi')
check('image 可运行', image.runtime === 'ready')

const textOnlyImage = mapCatalogEntry({ id: 'dall-e-3', category: 'image', capability_tags: ['Text to Image'] })
check('纯文生图标记不支持参考图', textOnlyImage.features?.imageRef === 'none')

const embedding = mapCatalogEntry({ id: 'text-embedding-3-large', category: 'chat', capability_tags: ['Embedding'] })
check('嵌入模型不进入文本', embedding.runtime === 'catalog-only' && embedding.suggestedCaps.length === 0)

const moderation = mapCatalogEntry({ id: 'omni-moderation-latest', category: 'chat', capability_tags: ['Text', 'Omni'] })
check('审核模型不进入文本', moderation.runtime === 'catalog-only' && moderation.suggestedCaps.length === 0)

const seedance = mapCatalogEntry({ id: 'seedance-2.5', category: 'video' })
check('seedance 可运行', seedance.runtime === 'ready')
check('seedance 视频参考', seedance.features?.videoRef === true)
check('seedance 首尾帧', seedance.features?.firstFrame && seedance.features?.lastFrame)

const kling = mapCatalogEntry({ id: 'kling-v3', category: 'video' })
check('kling 可运行', kling.runtime === 'ready')
check('kling 不支持参考视频', !kling.features?.videoRef)

const otherVideo = mapCatalogEntry({ id: 'veo3', category: 'video' })
check('视频模型统一走通用适配', otherVideo.runtime === 'ready')
check('通用视频仍登记 video', otherVideo.suggestedCaps.includes('video'))

const tts = mapCatalogEntry({ id: 'gpt-4o-mini-tts', category: 'audio' })
check('TTS 可运行', tts.runtime === 'ready')
check('TTS 配音能力', tts.suggestedCaps.includes('audio'))

const otherTts = mapCatalogEntry({ id: 'tts-1', category: 'audio' })
check('未验证 TTS 标记 catalog-only', otherTts.runtime === 'catalog-only', otherTts.reason)

const whisper = mapCatalogEntry({ id: 'whisper-1', category: 'audio' })
check('Whisper 标记未接入', whisper.runtime === 'catalog-only', whisper.reason)

const suno = mapCatalogEntry({ id: 'suno-v6', category: 'audio' })
check('音乐标记未接入', suno.runtime === 'catalog-only', suno.reason)

const unknown = mapCatalogEntry({ id: 'mystery-model' })
check('未知分类 catalog-only', unknown.runtime === 'catalog-only')
check('未知分类无建议能力', unknown.suggestedCaps.length === 0)

let seen = null
const mockFetch = async (url, init) => {
  seen = { url: String(url), auth: init?.headers?.Authorization }
  return new Response(
    JSON.stringify({
      data: [
        { id: 'gpt-5.1', category: 'chat', capability_tags: ['Text'] },
        { id: 'seedance-2.5', category: 'video' },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
const list = await fetchCatalog({ baseUrl: 'https://api.apimart.ai/v1/', apiKey: 'k', fetchImpl: mockFetch })
check('目录 URL 与鉴权', seen?.url === 'https://api.apimart.ai/v1/models?expand=category' && seen?.auth === 'Bearer k', JSON.stringify(seen))
check('目录条目数量', list.length === 2, String(list.length))

let err = ''
try {
  await fetchCatalog({
    baseUrl: 'https://api.apimart.ai/v1',
    apiKey: 'k',
    fetchImpl: async () => new Response('{"error":{"message":"insufficient balance"}}', { status: 402 }),
  })
} catch (e) {
  err = e.kind
}
check('目录 402 → billing', err === 'billing', err)

let formatErr = ''
try {
  await fetchCatalog({
    baseUrl: 'https://api.apimart.ai/v1',
    apiKey: 'k',
    fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
  })
} catch (e) {
  formatErr = e.message
}
check('目录缺 data → 可读错误', /data/.test(formatErr), formatErr)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
