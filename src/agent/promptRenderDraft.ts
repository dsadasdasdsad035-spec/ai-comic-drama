import type { ProjectShot } from '../api'
import type { VideoPromptRenderMeta } from '../types'
import { getPromptRenderTemplateVersion } from '../promptRender'

export type PromptRenderShotPatch = {
  no?: string
  id?: string
  video_prompt_rendered: string
  video_prompt_render_meta: VideoPromptRenderMeta
}

export type PromptRenderJoinPatch = {
  after_no: string
  to_no: string
  rendered_prompt: string
  render_meta: VideoPromptRenderMeta
}

export function mergePromptRenderDraft(
  shots: ProjectShot[],
  patches: PromptRenderShotPatch[],
  epNo: number,
): { shots: ProjectShot[]; patched: number; missing: string[] } {
  const missing: string[] = []
  let patched = 0
  const byId = new Map(shots.map((s) => [s.id, s]))
  const byNo = new Map(shots.filter((s) => s.episode === epNo).map((s) => [String(s.no), s]))
  const next = shots.map((s) => ({ ...s }))
  for (const p of patches) {
    const hit =
      (p.id ? byId.get(p.id) : undefined) ||
      (p.no ? byNo.get(String(p.no)) : undefined)
    if (!hit) {
      missing.push(p.id || p.no || '?')
      continue
    }
    const idx = next.findIndex((s) => s.id === hit.id)
    if (idx < 0) continue
    next[idx] = {
      ...next[idx],
      video_prompt_rendered: p.video_prompt_rendered,
      video_prompt_render_meta: {
        ...p.video_prompt_render_meta,
        templateVersion: p.video_prompt_render_meta.templateVersion || getPromptRenderTemplateVersion(),
      },
    }
    patched++
  }
  return { shots: next, patched, missing }
}
