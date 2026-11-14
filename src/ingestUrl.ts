/** 与 server/ingest-url.mjs 保持一致：从分享口令中提取链接 */

const TRAIL = /[，。；、\])>"'」』\u201d\u2019]+$/g

export function extractIngestUrl(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''

  if (/^https?:\/\/\S+$/i.test(text)) {
    return text.replace(TRAIL, '')
  }

  const embedded = text.match(/https?:\/\/[^\s<>"'\u4e00-\u9fff，。；、）\]]+/gi)
  if (embedded?.length) {
    return embedded[0].replace(TRAIL, '')
  }

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

export function isPlatformMediaUrl(url: string): boolean {
  return /(douyin\.com|iesdouyin\.com|tiktok\.com|vm\.tiktok\.com|bilibili\.com|b23\.tv)/i.test(url)
}