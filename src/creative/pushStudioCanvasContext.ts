import type { VideoModelInput } from '../videoPrompt'
import type { CharacterSheet } from '../characters'
import type { ShotNodeType } from '../data'

export type StudioCanvasPushPayload = {
  name: string
  episode: number
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: string[]
  videoModel: VideoModelInput | null
  resolution: string
  /** 与 GET /api/project 的 revision 一致；读工具用它决定是否用 overlay */
  projectRevision: number
}

/** 创意宿主工具桥消费的画布实况（防抖后推送，避免拖慢画布） */
export async function postStudioCanvasContext(payload: StudioCanvasPushPayload): Promise<void> {
  const name = String(payload.name || '').trim()
  if (!name) {
    await fetch('/api/studio/canvas-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: '', projectRevision: 0 }),
    }).catch(() => {})
    return
  }
  await fetch('/api/studio/canvas-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name,
      episode: payload.episode,
      nodes: payload.nodes,
      characters: payload.characters,
      missingMedia: payload.missingMedia,
      videoModel: payload.videoModel,
      resolution: payload.resolution,
      projectRevision: Math.max(0, Math.floor(Number(payload.projectRevision) || 0)),
    }),
  }).catch(() => {})
}