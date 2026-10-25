import type { ProjectShot } from '../api'
import type { CharacterSheet } from '../characters'
import { expandAnchors, hasUnresolvedAnchor } from '../prompts'

export type PromptDraftItem = {
  no: string | number
  keyframe_prompt?: string
  video_prompt?: string
}

/**
 * 提示词草稿：只在当前集内按 no 找到 shot.id，再按 id 写回。
 * 修掉按 no 全局匹配会串到别的集的问题；锚点占位符先展开。
 */
export function mergePromptDraft(
  current: ProjectShot[],
  returned: PromptDraftItem[],
  epNo: number,
  chars: Pick<CharacterSheet, 'name' | 'lookEn'>[],
): { shots: ProjectShot[]; patched: number; missing: number; unresolved: number } {
  const visible = current.filter((s) => (Number(s.episode) || 1) === epNo)
  const byNo = new Map(visible.map((s) => [String(s.no || ''), s]))
  const patch = new Map<string, { kf: string; vp: string }>()
  let missing = 0
  let unresolved = 0
  for (const x of returned) {
    const target = byNo.get(String(x.no))
    if (!target) {
      missing++
      continue
    }
    const kf = expandAnchors(String(x.keyframe_prompt || '').trim(), chars.map((c) => ({ name: c.name, lookEn: c.lookEn })))
    if (hasUnresolvedAnchor(kf)) unresolved++
    patch.set(target.id, { kf, vp: String(x.video_prompt || '').trim() })
  }
  const shots = current.map((s) => {
    const hit = patch.get(s.id)
    return hit ? { ...s, keyframe_prompt: hit.kf, video_prompt: hit.vp } : s
  })
  return { shots, patched: patch.size, missing, unresolved }
}
