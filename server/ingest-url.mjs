/**
 * 从分享文案中提取可摄取的 http(s) 链接（抖音 / B 站等）。
 */

const TRAIL = /[，。；、\])>"'」』\u201d\u2019]+$/g

/** @param {string} raw */
export function extractIngestUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''

  // 整段就是一个 URL
  if (/^https?:\/\/\S+$/i.test(text)) {
    return text.replace(TRAIL, '')
  }

  // 文案里嵌的 URL（常见：抖音/B 站复制口令）
  const embedded = text.match(/https?:\/\/[^\s<>"'\u4e00-\u9fff，。；、）\]]+/gi)
  if (embedded?.length) {
    return embedded[0].replace(TRAIL, '')
  }

  // 无协议但像短链
  const bare = text.match(
    /(?:^|[\s(（])(?:https?:\/\/)?((?:v\.)?douyin\.com|iesdouyin\.com|b23\.tv|(?:m\.)?bilibili\.com)\/[^\s\u4e00-\u9fff，。；、）\]]+/i,
  )
  if (bare) {
    const path = String(bare[0]).replace(/^[\s(（]+/, '').trim()
    const withScheme = path.startsWith('http') ? path : `https://${path.replace(/^\/\//, '')}`
    return withScheme.replace(TRAIL, '')
  }

  return text
}

/** 平台分享页（需要 yt-dlp / DTK，不能直链） */
export function isPlatformMediaUrl(url) {
  const u = String(url || '')
  return /(douyin\.com|iesdouyin\.com|tiktok\.com|vm\.tiktok\.com|bilibili\.com|b23\.tv)/i.test(u)
}