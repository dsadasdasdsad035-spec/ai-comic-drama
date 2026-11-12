/** 只有这几项可以作为文本附件；景别/运镜不再自动发送。 */
export type ManifestTextName =
  | 'prompt'
  | 'videoPrompt'
  | 'cast'
  | 'sizeMove'
  | 'marks'
  | 'dialogue'
  | 'scene'

export type ManifestImageAttachment = {
  kind: 'image'
  key: string
  label: string
  source: 'character' | 'design' | 'asset' | 'image'
  url: string
  includeBrief: boolean
}

export type ManifestVideoAttachment = {
  kind: 'video'
  key: string
  label: string
  url: string
  duration?: number
  frameTimes: number[]
  includeBrief: boolean
}

export type ManifestTextAttachment = {
  kind: 'text'
  key: string
  name: ManifestTextName
  label: string
  text: string
}

export type ManifestAttachment =
  | ManifestImageAttachment
  | ManifestVideoAttachment
  | ManifestTextAttachment

/** 3D / 白模场景需要的结构化条目头；其他工作台（如角色聊天）没有这个概念。 */
export type ManifestShotHead = {
  id?: string
  no: string
  duration: number
  aspect: string
}

/**
 * 清单的作用域头。title 是所有工作台都能显示的通用文案；
 * shot 只给需要结构化条目信息的消费方（3D / 白模代码生成）。
 */
export type ManifestScope = {
  title: string
  shot?: ManifestShotHead
}

export type ContextManifest = {
  version: 1
  scope: ManifestScope
  attachments: ManifestAttachment[]
}

export type ManifestCounts = { image: number; video: number; text: number }

export type ManifestSummary = {
  attachmentKeys: string[]
  counts: ManifestCounts
  metadata: ManifestScope
}

export type BuildShotOnlyManifestInput = {
  shotId?: string
  shotNo?: string
  duration: number
  aspect: string
}

/** 仅条目运行元数据（镜号/名称 + 时长 + 画幅），不含参考附件。 */
export function buildShotOnlyManifest(input: BuildShotOnlyManifestInput): ContextManifest {
  const shot: ManifestShotHead = {
    ...(input.shotId ? { id: input.shotId } : {}),
    no: String(input.shotNo || ''),
    duration: Number(input.duration) || 0,
    aspect: String(input.aspect || ''),
  }
  return { version: 1, scope: { title: shotScopeTitle(shot), shot }, attachments: [] }
}

/** 条目作用域的展示文案；白模聊天与检查器共用，保证文案只写一处。 */
export function shotScopeTitle(shot: ManifestShotHead): string {
  return `镜头 ${shot.no || '未编号'} · ${shot.duration.toFixed(1)}s · ${shot.aspect}`
}

export function manifestCounts(manifest: ContextManifest): ManifestCounts {
  const counts: ManifestCounts = { image: 0, video: 0, text: 0 }
  for (const a of manifest.attachments) {
    if (a.kind === 'image') counts.image += 1
    else if (a.kind === 'video') counts.video += 1
    else counts.text += 1
  }
  return counts
}

export function manifestSummary(manifest: ContextManifest): ManifestSummary {
  return {
    attachmentKeys: manifest.attachments.map((a) => a.key),
    counts: manifestCounts(manifest),
    metadata: manifest.scope,
  }
}

export type ManifestAssetMeta = { width?: number; height?: number }

/**
 * 代码模型看到的文本投影：条目头只有名称/时长/画幅，其余全部来自附件。
 * briefs 以附件 key 为键；includeBrief=false 的附件不拼 brief。
 * assetMeta 只补尺寸，不改变附件是否出现。
 */
export function manifestText(
  manifest: ContextManifest,
  briefs: Record<string, string> = {},
  maxChars = 12000,
  assetMeta: Record<string, ManifestAssetMeta> = {},
): string {
  const lines: string[] = []
  // 代码提示词的条目头保持原样：有结构化条目就用它，没有则退回通用标题
  const head = manifest.scope.shot
  lines.push(
    head
      ? `【镜头】${head.no || '未编号'}｜${head.duration.toFixed(1)}s｜${head.aspect}`
      : `【上下文】${manifest.scope.title}`,
  )

  const texts = manifest.attachments.filter(
    (a): a is Extract<ManifestAttachment, { kind: 'text' }> => a.kind === 'text',
  )
  if (texts.length) {
    lines.push('【文本附件】')
    for (const a of texts) lines.push(`- ${a.label}：${a.text}`)
  }

  const assets = manifest.attachments.filter((a) => a.kind !== 'text')
  if (assets.length) {
    lines.push('【素材附件】')
    for (const a of assets) {
      if (a.kind === 'image') {
        const meta = assetMeta[a.key]
        const size = meta?.width && meta?.height ? `｜${meta.width}x${meta.height}` : ''
        lines.push(`- key=${a.key}｜${a.label}｜image｜${a.source}${size}`)
      } else {
        const frames = a.frameTimes.length
          ? `｜关键帧 ${a.frameTimes.map((t) => `${t.toFixed(2)}s`).join('/')}`
          : ''
        lines.push(
          `- key=${a.key}｜${a.label}｜video${a.duration ? `｜${a.duration.toFixed(2)}s` : ''}${frames}`,
        )
      }
      const brief = a.includeBrief ? briefs[a.key] : ''
      if (brief) lines.push(`  brief：${brief}`)
    }
  }

  return lines.join('\n').slice(0, maxChars)
}
