/** 轻量稳定哈希：指纹、缓存键和内容短码共用。 */
function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 16 位十六进制短码；同一输入恒等，不依赖加密库。 */
export function shortHash(str: string): string {
  return (
    fnv1a(str, 0x811c9dc5).toString(16).padStart(8, '0') +
    fnv1a(str, 0x9e3779b9).toString(16).padStart(8, '0')
  )
}
