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
 *
 * partial=true（导入用）：只写文件里给了值的列，空值不覆盖已有内容。
 * 默认 false 保持聊天与生成的行为——两列一起写，因为模型输出本就该是一对。
 */
export function mergePromptDraft(
  current: ProjectShot[],
  returned: PromptDraftItem[],
  epNo: number,
  chars: Pick<CharacterSheet, 'name' | 'lookEn'>[],
  opts: { partial?: boolean } = {},
): { shots: ProjectShot[]; patched: number; missing: number; unresolved: number } {
  const visible = current.filter((s) => (Number(s.episode) || 1) === epNo)
  const byNo = new Map(visible.map((s) => [String(s.no || ''), s]))
  const patch = new Map<string, { kf?: string; vp?: string }>()
  let missing = 0
  let unresolved = 0
  const anchors = chars.map((c) => ({ name: c.name, lookEn: c.lookEn }))
  for (const x of returned) {
    const target = byNo.get(String(x.no))
    if (!target) {
      missing++
      continue
    }
    const rawKf = String(x.keyframe_prompt ?? '').trim()
    const rawVp = String(x.video_prompt ?? '').trim()
    const entry: { kf?: string; vp?: string } = {}
    if (opts.partial) {
      if (rawKf) {
        const kf = expandAnchors(rawKf, anchors)
        if (hasUnresolvedAnchor(kf)) unresolved++
        entry.kf = kf
      }
      if (rawVp) entry.vp = rawVp
      if (entry.kf === undefined && entry.vp === undefined) continue
    } else {
      const kf = expandAnchors(rawKf, anchors)
      if (hasUnresolvedAnchor(kf)) unresolved++
      entry.kf = kf
      entry.vp = rawVp
    }
    patch.set(target.id, entry)
  }
  const shots = current.map((s) => {
    const hit = patch.get(s.id)
    if (!hit) return s
    return {
      ...s,
      ...(hit.kf !== undefined ? { keyframe_prompt: hit.kf } : {}),
      ...(hit.vp !== undefined ? { video_prompt: hit.vp } : {}),
    }
  })
  return { shots, patched: patch.size, missing, unresolved }
}
