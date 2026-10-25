import type { AppSettings } from './api'
import { askVision } from './api'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import { stageModelKey, type StagePick } from './ModelSelect'
import { shortHash } from './scheduleGeometry'

export type MediaBriefItem = {
  key: string
  label: string
  kind: 'image' | 'video-frame'
  description: string
  subjects?: string[]
  composition?: string
  style?: string
  camera?: string
}

export type MediaBrief = {
  version: 1
  usedVision: boolean
  modelKey?: string
  items: MediaBriefItem[]
  summary?: string
  fingerprint: string
}

const cache = new Map<string, MediaBrief>()

export const MEDIA_BRIEF_SYSTEM = `你是分镜 3D 代码的视觉场记。你会看到一张带标签的参考板，标签可能包含角色、场景、道具、分镜图和视频关键帧。
请只描述图里真实看到的内容，不要编造看不到的物体或人物。
只输出 JSON，不要解释：
{"summary":"整体空间/风格/光线的一句话总结",
 "items":[{"key":"参考板上的稳定键","description":"这个素材里有什么、空间关系、主体位置、材质/风格/光线线索","subjects":["主体"],"composition":"构图","style":"风格/材质","camera":"机位或镜头线索"}]}
key 必须逐字使用参考板标签中的 key；没有把握的字段可以省略。`

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] || c)
}

async function bitmapOf(asset: PreparedSceneAsset): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(asset.payload.url, { credentials: 'same-origin' })
    if (!res.ok) return null
    return await createImageBitmap(await res.blob())
  } catch {
    return null
  }
}

async function buildSheet(assets: PreparedSceneAsset[]): Promise<{ dataUrl: string; count: number }> {
  const W = 1600
  const H = 1200
  const cols = 4
  const rows = 4
  const pad = 14
  const header = 74
  const cellW = (W - pad * 2 - pad * (cols - 1)) / cols
  const cellH = (H - pad * 2 - header - pad * (rows - 1)) / rows
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl: '', count: 0 }
  ctx.fillStyle = '#f1f4f7'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111820'
  ctx.font = 'bold 26px system-ui, sans-serif'
  ctx.fillText('3D CODE REFERENCE BOARD', pad, 34)
  ctx.fillStyle = '#5f6d7a'
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillText('Labels and keys are authoritative. Images/video keyframes only.', pad, 58)
  const limited = assets.slice(0, cols * rows)
  let count = 0
  await Promise.all(
    limited.map(async (asset, i) => {
      const x = pad + (i % cols) * (cellW + pad)
      const y = header + Math.floor(i / cols) * (cellH + pad)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x, y, cellW, cellH)
      ctx.strokeStyle = '#b9c3cc'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, cellW, cellH)
      ctx.fillStyle = asset.payload.kind === 'video-frame' ? '#b45309' : '#0f766e'
      ctx.fillRect(x, y, 7, cellH)
      ctx.fillStyle = '#17212b'
      ctx.font = 'bold 16px system-ui, sans-serif'
      const label = `${asset.ref.key} — ${asset.ref.label}`
      ctx.fillText(label.slice(0, 58), x + 16, y + 24)
      const bmp = await bitmapOf(asset)
      if (bmp) {
        const maxW = cellW - 32
        const maxH = cellH - 48
        const scale = Math.min(maxW / bmp.width, maxH / bmp.height)
        const dw = bmp.width * scale
        const dh = bmp.height * scale
        ctx.drawImage(bmp, x + 16 + (maxW - dw) / 2, y + 36 + (maxH - dh) / 2, dw, dh)
        bmp.close?.()
        count++
      } else {
        ctx.fillStyle = '#eef1f4'
        ctx.fillRect(x + 16, y + 36, cellW - 32, cellH - 52)
        ctx.fillStyle = '#8b96a1'
        ctx.font = '14px system-ui, sans-serif'
        ctx.fillText('IMAGE MISSING', x + 26, y + 64)
      }
    }),
  )
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.84), count }
}

function manifestOf(assets: PreparedSceneAsset[]): string {
  const rows = assets.map((a, i) => {
    const meta = [
      a.payload.kind,
      a.payload.width && a.payload.height ? `${a.payload.width}x${a.payload.height}` : '',
      a.payload.videoDuration != null ? `video ${a.payload.videoDuration.toFixed(2)}s` : '',
      a.payload.frameTime != null ? `frame @${a.payload.frameTime.toFixed(2)}s` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return `${i + 1}. key=${a.ref.key} | label=${a.ref.label} | ${meta}`
  })
  return rows.join('\n')
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function text(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeBrief(raw: unknown, assets: PreparedSceneAsset[], modelKey: string, fingerprint: string): MediaBrief {
  const o = asObj(raw) || {}
  const rawItems = Array.isArray(o.items) ? o.items : []
  const allowed = new Set(assets.map((a) => a.ref.key))
  const items: MediaBriefItem[] = []
  for (const item of rawItems.slice(0, 32)) {
    const x = asObj(item)
    if (!x) continue
    const key = text(x.key, 120)
    if (!allowed.has(key)) continue
    const ref = assets.find((a) => a.ref.key === key)!
    items.push({
      key,
      label: ref.ref.label,
      kind: ref.payload.kind,
      description: text(x.description, 600),
      ...(Array.isArray(x.subjects)
        ? { subjects: x.subjects.map((s) => text(s, 40)).filter(Boolean).slice(0, 8) }
        : {}),
      ...(x.composition ? { composition: text(x.composition, 240) } : {}),
      ...(x.style ? { style: text(x.style, 240) } : {}),
      ...(x.camera ? { camera: text(x.camera, 240) } : {}),
    })
  }
  return {
    version: 1,
    usedVision: true,
    modelKey,
    items,
    ...(o.summary ? { summary: text(o.summary, 500) } : {}),
    fingerprint,
  }
}

function fallbackBrief(assets: PreparedSceneAsset[], fingerprint: string, warning: string): MediaBrief {
  return {
    version: 1,
    usedVision: false,
    items: assets.map((a) => ({
      key: a.ref.key,
      label: a.ref.label,
      kind: a.payload.kind,
      description: `${a.ref.label}（${a.payload.kind === 'video-frame' ? '视频关键帧' : '图片'}；视觉模型未参与）`,
    })),
    summary: warning,
    fingerprint,
  }
}

export function mediaBriefFingerprint(assets: PreparedSceneAsset[]): string {
  return shortHash(
    JSON.stringify(
      [...assets]
        .map((a) => [a.ref.key, a.ref.kind, a.ref.contentHash, a.ref.label])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  )
}

/**
 * 选中图片/视频关键帧 → 带标签参考板 → 视觉模型 → 可缓存的媒体 brief。
 * 没有视觉模型或调用失败时返回 usedVision=false 的标签清单，不伪造理解。
 */
export async function buildMediaBrief(input: {
  assets: PreparedSceneAsset[]
  settings: AppSettings | null
  stagePick?: StagePick
  signal?: AbortSignal
}): Promise<{ brief: MediaBrief; warnings: string[] }> {
  const fingerprint = mediaBriefFingerprint(input.assets)
  if (!input.assets.length) {
    return {
      brief: { version: 1, usedVision: false, items: [], fingerprint },
      warnings: [],
    }
  }
  const cached = cache.get(fingerprint)
  if (cached?.usedVision) return { brief: cached, warnings: [] }
  const modelKey = stageModelKey(input.settings, 'vision', input.stagePick)
  if (!modelKey) {
    return {
      brief: fallbackBrief(input.assets, fingerprint, '没有配置视觉模型，素材未参与理解'),
      warnings: ['没有配置视觉模型，素材未参与理解'],
    }
  }
  const sheet = await buildSheet(input.assets)
  if (!sheet.dataUrl || !sheet.count) {
    return {
      brief: fallbackBrief(input.assets, fingerprint, '参考板没有可用图片'),
      warnings: ['参考板没有可用图片，素材未参与理解'],
    }
  }
  const manifest = manifestOf(input.assets)
  try {
    const r = await askVision({
      system: MEDIA_BRIEF_SYSTEM,
      prompt:
        `参考板资源清单（key 必须逐字使用）：\n${manifest}\n\n` +
        '请逐个描述这些素材，供后续 Blender 代码决定场景、材质、机位和运动。不要输出代码。',
      image: sheet.dataUrl,
      modelKey,
      json: true,
      maxTokens: 2400,
      signal: input.signal,
    })
    const brief = normalizeBrief(r.json, input.assets, r.modelKey || modelKey, fingerprint)
    if (!brief.items.length && !brief.summary) {
      return {
        brief: fallbackBrief(input.assets, fingerprint, '视觉模型没有返回可用描述'),
        warnings: ['视觉模型没有返回可用描述，素材未参与理解'],
      }
    }
    cache.set(fingerprint, brief)
    if (cache.size > 12) cache.delete(cache.keys().next().value as string)
    return { brief, warnings: [] }
  } catch (e) {
    return {
      brief: fallbackBrief(input.assets, fingerprint, `视觉理解失败：${(e as Error).message}`),
      warnings: [`视觉理解失败，已回退标签：${(e as Error).message}`],
    }
  }
}

export function mediaBriefText(brief: MediaBrief | undefined): string {
  if (!brief) return ''
  const rows = brief.items.map((item) => {
    const bits = [
      item.description,
      item.subjects?.length ? `主体：${item.subjects.join('、')}` : '',
      item.composition ? `构图：${item.composition}` : '',
      item.style ? `风格：${item.style}` : '',
      item.camera ? `机位：${item.camera}` : '',
    ].filter(Boolean)
    return `- ${item.key}（${item.label}）：${bits.join('；')}`
  })
  return [
    brief.summary ? `整体：${brief.summary}` : '',
    ...rows,
    brief.usedVision ? '' : '注意：视觉模型未参与，以上仅为素材标签。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function clearMediaBriefCache() {
  cache.clear()
}

export { esc as escapeBriefText }
