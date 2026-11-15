import { safeFileName } from './escape'
import { inlineAsset, type InlineAssetOptions } from './inlineAssets'
import { buildPreviewHtml, formatTime } from './viewer'
import type { PreviewSnapshot } from './snapshot'

/**
 * 预览导出：把同一份 viewer 的输出写成单个自包含 HTML 文件。
 *
 * 体积闸门放在写文件之前——base64 会把图片撑大约 33%，
 * 静默吐出一个几十兆的文件比直接拒绝更糟。
 */
export const PREVIEW_EXPORT_SOFT_LIMIT = 5 * 1024 * 1024

export type PreviewExportResult = {
  html: string
  bytes: number
  fileName: string
  /** 超过软上限；是否继续由用户决定 */
  overLimit: boolean
}

export type PreviewExportOptions = {
  limit?: number
  inline?: InlineAssetOptions
}

/** 导出文件名：角色名 + 固定后缀，路径分隔符与控制字符会被替换 */
export function exportFileName(characterName: string): string {
  return `${safeFileName(characterName, 'character')}-角色卡.html`
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function buildPreviewExport(
  snapshot: PreviewSnapshot,
  options: PreviewExportOptions = {},
): Promise<PreviewExportResult> {
  const limit = options.limit ?? PREVIEW_EXPORT_SOFT_LIMIT
  const html = await buildPreviewHtml(
    snapshot,
    (url) => inlineAsset(url, options.inline),
    { footnote: `生成于 ${formatTime(snapshot.generatedAt)} · 单文件角色卡` },
  )
  const bytes = new Blob([html], { type: 'text/html;charset=utf-8' }).size
  return {
    html,
    bytes,
    fileName: exportFileName(snapshot.character.name),
    overLimit: bytes > limit,
  }
}

/** 用 Blob URL 触发下载；并发的旧地址稍后回收，避免内存常驻 */
export function downloadHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
