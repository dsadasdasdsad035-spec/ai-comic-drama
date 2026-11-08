/**
 * 视频出片 reference_image 张数上限。
 * null = 客户端不截断，全部随画布连线提交；上游若拒收再提示用户减量。
 */
export const VIDEO_REFERENCE_IMAGE_LIMIT: number | null = null

export function limitVideoReferenceImages<T>(
  items: T[],
  max: number | null = VIDEO_REFERENCE_IMAGE_LIMIT,
): { used: T[]; omitted: T[] } {
  if (max == null || max <= 0 || items.length <= max) {
    return { used: items, omitted: [] }
  }
  return { used: items.slice(0, max), omitted: items.slice(max) }
}

export function videoRefLimitLabel(max: number | null = VIDEO_REFERENCE_IMAGE_LIMIT): string {
  return max == null || max <= 0 ? '不限' : String(max)
}
