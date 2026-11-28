import type { ShotData } from './types'
import { dialogueToText } from './prompts'

export type ShotPromptField = 'dialogue' | 'video_prompt'

export type ShotPromptSlice = {
  id: string
  no?: string
  dialogue?: string
  video_prompt?: string
  seconds?: number
}

/** 根据画布上的 sourceShotIds 解析分镜字段（仅 shot 节点） */
export function resolveShotsFromSourceIds(
  nodes: { id: string; type?: string; data?: Partial<ShotData> }[],
  sourceShotIds: string[],
): ShotPromptSlice[] {
  const byId = new Map<string, ShotPromptSlice>()
  const byShotId = new Map<string, ShotPromptSlice>()
  for (const n of nodes) {
    if (n.type !== 'shot' && n.type != null) continue
    const d = n.data || {}
    const slice: ShotPromptSlice = {
      id: n.id,
      no: String(d.no || ''),
      dialogue: dialogueToText(d.dialogue),
      video_prompt: String(d.videoPrompt || (d as { video_prompt?: string }).video_prompt || ''),
      seconds: Number(d.seconds) || 0,
    }
    byId.set(n.id, slice)
    const biz = String((d as { shotId?: string }).shotId || '').trim()
    if (biz) byShotId.set(biz, slice)
  }
  const out: ShotPromptSlice[] = []
  for (const id of sourceShotIds) {
    const slice = byId.get(id) ?? byShotId.get(id)
    if (slice) out.push(slice)
  }
  return out
}

/** 音频卡生成：用户 prompt + 引用分镜字段（不含媒体） */
export function buildAssetAudioPrompt(opts: {
  prompt: string
  field: ShotPromptField
  shots: Pick<ShotPromptSlice, 'dialogue' | 'video_prompt'>[]
}): string {
  const parts: string[] = []
  const user = String(opts.prompt || '').trim()
  if (user) parts.push(user)
  for (const s of opts.shots) {
    const text =
      opts.field === 'video_prompt'
        ? String(s.video_prompt || '').trim()
        : String(s.dialogue || '').trim()
    if (text) parts.push(text)
  }
  const merged = parts.join('\n\n').trim()
  return merged
}

export function shotPromptRefEdgeId(shotNodeId: string, assetNodeId: string): string {
  return `ref-shot-${shotNodeId}--${assetNodeId}`
}

export function parseShotPromptRefEdgeId(edgeId: string): { shotId: string; assetId: string } | null {
  if (!edgeId.startsWith('ref-shot-')) return null
  const rest = edgeId.slice('ref-shot-'.length)
  const idx = rest.indexOf('--')
  if (idx >= 0) return { shotId: rest.slice(0, idx), assetId: rest.slice(idx + 2) }
  // 旧格式：ref-shot-<shot>-<asset-...>，从首个 asset- 前缀切开
  const legacy = rest.indexOf('-asset-')
  if (legacy < 0) return null
  return { shotId: rest.slice(0, legacy), assetId: rest.slice(legacy + 1) }
}

export function assetAcceptsShotPromptRef(kind: string | undefined): boolean {
  return kind === 'audio' || kind === 'subtitle'
}