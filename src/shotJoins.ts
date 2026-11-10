import type { ProjectShot } from './api'
import type { TransitionOut } from './types'
import { defaultTransition, normalizeEffect, normalizeGenerated, normalizeTransitionOut } from './transition'
export type TransitionTaxonomy = 'scene' | 'character' | 'space' | 'vfx' | 'camera' | 'ai_video'

export type JoinRelation = 'cut' | 'transition'

export type JoinGeneratedDraft = {
  prompt?: string
  sound_prompt?: string
  target_seconds?: number
  recipe_ids?: string[]
  variant_id?: string
  taxonomy?: TransitionTaxonomy
}

export type JoinDraft = {
  after_no: string
  to_no: string
  relation?: JoinRelation
  mode?: 'effect' | 'generated'
  taxonomy?: TransitionTaxonomy
  recipe_ids?: string[]
  effect?: { preset_id?: string; type?: string; seconds?: number }
  generated?: JoinGeneratedDraft
}

export type JoinApplyIssue = { after_no: string; message: string }

export type JoinApplyResult = {
  shots: ProjectShot[]
  applied: number
  cuts: number
  effects: number
  generated: number
  issues: JoinApplyIssue[]
}

const shotByNo = (shots: ProjectShot[], no: string): ProjectShot | undefined =>
  shots.find((s) => String(s.no || '').trim() === String(no || '').trim())

/** Agent joins-v1 → 源镜 transition_out；不新增 shot 行 */
export function applyJoinsToShots(shots: ProjectShot[], joins: JoinDraft[]): JoinApplyResult {
  const next = shots.map((s) => ({ ...s }))
  const issues: JoinApplyIssue[] = []
  let applied = 0
  let cuts = 0
  let effects = 0
  let generated = 0

  for (const j of joins) {
    const afterNo = String(j.after_no || '').trim()
    const toNo = String(j.to_no || '').trim()
    if (!afterNo || !toNo) {
      issues.push({ after_no: afterNo || '?', message: '缺少 after_no 或 to_no' })
      continue
    }
    const source = shotByNo(next, afterNo)
    if (!source) {
      issues.push({ after_no: afterNo, message: `找不到镜号 ${afterNo}` })
      continue
    }
    const target = shotByNo(next, toNo)
    if (!target) {
      issues.push({ after_no: afterNo, message: `找不到镜号 ${toNo}` })
      continue
    }
    const toKey = String(target.id || toNo)
    const relation: JoinRelation = j.relation === 'cut' ? 'cut' : j.relation === 'transition' ? 'transition' : 'transition'

    if (relation === 'cut') {
      const idx = next.findIndex((s) => s.id === source.id)
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          transition_out: null,
          handEdited: [...new Set([...(next[idx].handEdited ?? []), 'transition_out'])],
        }
        applied++
        cuts++
      }
      continue
    }

    const mode = j.mode === 'effect' ? 'effect' : 'generated'
    const base = normalizeTransitionOut(source.transition_out, toKey)
    let transitionOut: TransitionOut

    if (mode === 'effect') {
      const presetId = j.effect?.preset_id
      transitionOut = {
        ...base,
        to: toKey,
        mode: 'effect',
        effect: normalizeEffect({
          type: j.effect?.type as any,
          presetId,
          seconds: j.effect?.seconds,
        }),
        generated: base.generated,
      }
      effects++
    } else {
      const g = normalizeGenerated({
        ...base.generated,
        prompt: String(j.generated?.prompt ?? base.generated?.prompt ?? ''),
        soundPrompt: String(j.generated?.sound_prompt ?? base.generated?.soundPrompt ?? ''),
        targetSeconds:
          Number(j.generated?.target_seconds) || base.generated?.targetSeconds || undefined,
      })
      if (j.taxonomy || j.generated?.taxonomy) {
        g.taxonomy = j.taxonomy ?? j.generated?.taxonomy
      }
      const recipeIds = [...new Set([...(j.recipe_ids ?? []), ...(j.generated?.recipe_ids ?? [])])]
      if (recipeIds.length) g.recipeIds = recipeIds
      if (j.generated?.variant_id) g.variantId = String(j.generated.variant_id)
      transitionOut = {
        ...base,
        to: toKey,
        mode: 'generated',
        effect: base.effect,
        generated: g,
      }
      generated++
    }

    const idx = next.findIndex((s) => s.id === source.id)
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        transition_out: transitionOut,
        handEdited: [...new Set([...(next[idx].handEdited ?? []), 'transition_out'])],
      }
      applied++
    }
  }

  return { shots: next, applied, cuts, effects, generated, issues }
}

/** 播放序中下一镜；用于接缝行对齐与错位警告 */
export function nextShotInEpisodeOrder(shots: ProjectShot[], source: ProjectShot): ProjectShot | undefined {
  const ep = Number(source.episode) || 1
  const ordered = shots
    .filter((s) => (Number(s.episode) || 1) === ep)
    .sort((a, b) => String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true }))
  const i = ordered.findIndex((s) => s.id === source.id)
  if (i < 0 || i >= ordered.length - 1) return undefined
  return ordered[i + 1]
}

export function seamSummary(transitionOut: TransitionOut | null | undefined, relation: JoinRelation): string {
  if (relation === 'cut' || !transitionOut) return '硬切'
  const t = normalizeTransitionOut(transitionOut)
  if (t.mode === 'effect') {
    const sec = t.effect?.seconds ?? 0.5
    return `效果 ${t.effect?.presetId || t.effect?.type || '叠化'} ${sec}s`
  }
  const sec = t.generated?.targetSeconds ?? 1.2
  const tax = (t.generated as any)?.taxonomy
  return `生成 ${sec}s${tax ? ` · ${tax}` : ''}`
}

export function transitionOutMismatch(
  source: ProjectShot,
  target: ProjectShot | undefined,
  transitionOut: TransitionOut | null | undefined,
): boolean {
  if (!transitionOut?.to || !target) return false
  const toKey = String(target.id || '')
  return String(transitionOut.to) !== toKey
}
