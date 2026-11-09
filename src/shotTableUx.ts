import type { ProjectShot } from './api'
import type { TransitionOut } from './types'
import { normalizeGenerated, normalizeTransitionOut } from './transition'
import { transitionOutMismatch } from './shotJoins'

export type ShotTableSelection =
  | { kind: 'episode' }
  | { kind: 'shot'; shotId: string }
  | { kind: 'join'; sourceId: string; targetId: string }

export type SeamUxStatus = 'cut' | 'needs_decision' | 'needs_prompt' | 'ok' | 'mismatch'

export type EpisodeAgentProgress = {
  shotTotal: number
  shotsPromptReady: number
  seamTotal: number
  seamsNonCut: number
  seamsPromptReady: number
}

export function seamUxStatus(
  source: ProjectShot,
  target: ProjectShot,
): SeamUxStatus {
  if (transitionOutMismatch(source, target, source.transition_out)) return 'mismatch'
  const raw = source.transition_out
  if (!raw) return 'cut'
  const t = normalizeTransitionOut(raw, String(target.id || ''))
  if (t.mode === 'effect') return 'ok'
  const g = normalizeGenerated(t.generated)
  const prompt = String(g.prompt ?? '').trim()
  if (!prompt) return 'needs_prompt'
  return 'ok'
}

export function episodeAgentProgress(ordered: ProjectShot[]): EpisodeAgentProgress {
  const shotTotal = ordered.length
  const shotsPromptReady = ordered.filter(
    (s) => String(s.keyframe_prompt ?? '').trim() && String(s.video_prompt ?? '').trim(),
  ).length
  const seamTotal = Math.max(0, shotTotal - 1)
  let seamsNonCut = 0
  let seamsPromptReady = 0
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]
    const b = ordered[i + 1]
    const st = seamUxStatus(a, b)
    if (st !== 'cut') seamsNonCut++
    if (st === 'ok' || st === 'mismatch') seamsPromptReady++
    if (st === 'needs_prompt') {
      /* 已决策为生成但缺 prompt */
    }
  }
  return { shotTotal, shotsPromptReady, seamTotal, seamsNonCut, seamsPromptReady }
}

/** 多行原文写入 YAML 块，供 handoff 完整带上表内字段 */
function appendYamlText(lines: string[], key: string, raw: unknown): void {
  const t = String(raw ?? '').trim()
  if (!t) {
    lines.push(`${key}: ''`)
    return
  }
  if (!t.includes('\n') && t.length <= 240 && !/^[\s\-?:,\[\]{}#&*!|>'"%@`]/u.test(t) && !t.includes(': ')) {
    lines.push(`${key}: ${t}`)
    return
  }
  lines.push(`${key}: |`)
  for (const line of t.split('\n')) {
    lines.push(`  ${line}`)
  }
}

/** 为 cinematic-transition 从表内两镜 + transition_out 拼装 handoff，无需用户粘贴 YAML */
export function assembleJoinBrief(source: ProjectShot, target: ProjectShot): string {
  const aNo = String(source.no || source.id)
  const bNo = String(target.no || target.id)
  const lines: string[] = [
    `# 表内上下文（宿主注入，非用户 YAML）`,
    `transition_id: ${aNo}_to_${bNo}`,
    `source_shot_a: ${aNo}`,
    `target_shot_b: ${bNo}`,
  ]
  if (source.size || source.move) {
    lines.push(`shot_a_framing: ${[source.size, source.move].filter(Boolean).join(' · ')}`)
  }
  if (target.size || target.move) {
    lines.push(`shot_b_framing: ${[target.size, target.move].filter(Boolean).join(' · ')}`)
  }
  appendYamlText(lines, 'shot_a_desc', source.desc)
  appendYamlText(lines, 'shot_b_desc', target.desc)
  appendYamlText(lines, 'shot_a_keyframe', source.keyframe_prompt)
  appendYamlText(lines, 'shot_b_keyframe', target.keyframe_prompt)
  appendYamlText(lines, 'shot_a_video_prompt', source.video_prompt)
  appendYamlText(lines, 'shot_b_video_prompt', target.video_prompt)
  const raw = source.transition_out
  if (!raw) {
    lines.push(`implementation: EDIT_ONLY`)
    lines.push(`transition_type: hard-cut`)
    return lines.join('\n')
  }
  const t = normalizeTransitionOut(raw, String(target.id || ''))
  lines.push(`implementation: ${t.mode === 'generated' ? 'GENERATED_BRIDGE' : 'EDIT_ONLY'}`)
  lines.push(`transition_type: ${t.mode}`)
  if (t.mode === 'effect' && t.effect) {
    lines.push(`effect_preset: ${t.effect.presetId || t.effect.type || 'dissolve'}`)
    lines.push(`duration_seconds: ${t.effect.seconds ?? 0.5}`)
  }
  if (t.mode === 'generated' && t.generated) {
    const g = normalizeGenerated(t.generated)
    if (g.taxonomy) lines.push(`taxonomy: ${g.taxonomy}`)
    lines.push(`duration_seconds: ${g.targetSeconds ?? 1.2}`)
    if (g.prompt?.trim()) appendYamlText(lines, 'existing_prompt', g.prompt)
    if (g.soundPrompt?.trim()) appendYamlText(lines, 'existing_sound', g.soundPrompt)
  }
  return lines.join('\n')
}

export function skillForJoinStatus(
  source: ProjectShot,
  target: ProjectShot,
): 'transition-director' | 'cinematic-transition' {
  const st = seamUxStatus(source, target)
  if (st === 'cut') return 'transition-director'
  const raw = source.transition_out
  const t = raw
    ? normalizeTransitionOut(raw, String(target.id || ''))
    : null
  if (t?.mode === 'effect') return 'transition-director'
  if (st === 'needs_prompt' || st === 'mismatch') return 'cinematic-transition'
  if (st === 'ok' && t?.mode === 'generated') return 'cinematic-transition'
  return 'transition-director'
}

export type ShotsPipelineStep = 1 | 2 | 3

export function skillForPipelineStep(step: ShotsPipelineStep): 'shotlist' | 'transition-director' | 'cinematic-transition' {
  if (step === 1) return 'shotlist'
  if (step === 2) return 'transition-director'
  return 'cinematic-transition'
}

/** 定位本集第一个待办：缺提示词镜 / 缺转场决策接缝 / 缺生成 prompt 接缝 */
export function firstGapSelection(
  ordered: ProjectShot[],
  step: ShotsPipelineStep,
): ShotTableSelection {
  if (step === 1) {
    const s = ordered.find(
      (x) => !String(x.keyframe_prompt ?? '').trim() || !String(x.video_prompt ?? '').trim(),
    )
    if (s) return { kind: 'shot', shotId: s.id }
    return { kind: 'episode' }
  }
  if (step === 2) {
    for (let i = 0; i < ordered.length - 1; i++) {
      const st = seamUxStatus(ordered[i], ordered[i + 1])
      if (st === 'cut') {
        return { kind: 'join', sourceId: ordered[i].id, targetId: ordered[i + 1].id }
      }
    }
    return { kind: 'episode' }
  }
  for (let i = 0; i < ordered.length - 1; i++) {
    const st = seamUxStatus(ordered[i], ordered[i + 1])
    if (st === 'needs_prompt') {
      return { kind: 'join', sourceId: ordered[i].id, targetId: ordered[i + 1].id }
    }
  }
  return { kind: 'episode' }
}

export function selectionFocusLine(
  selection: ShotTableSelection,
  shots: ProjectShot[],
): string {
  if (selection.kind === 'episode') {
    return '【范围】本集全部镜头与接缝；局部修改请说明镜号或点击左侧行。'
  }
  if (selection.kind === 'shot') {
    const s = shots.find((x) => x.id === selection.shotId)
    return s
      ? `【当前选中镜】${s.no || s.id}（id=${s.id}）。只改这一镜，submit 时保留本集其余镜。`
      : '【当前选中镜】（未找到）'
  }
  const a = shots.find((x) => x.id === selection.sourceId)
  const b = shots.find((x) => x.id === selection.targetId)
  return a && b
    ? `【当前接缝】${a.no || a.id} → ${b.no || b.id}。写入源镜 transition_out，不要改分镜列。`
    : '【当前接缝】'
}

export function chatTitleForSelection(
  selection: ShotTableSelection,
  skill: 'shotlist' | 'transition-director' | 'cinematic-transition',
  shots: ProjectShot[],
): string {
  if (selection.kind === 'shot') {
    const s = shots.find((x) => x.id === selection.shotId)
    return s ? `${s.no || s.id} · 分镜` : '单镜 · 分镜'
  }
  if (selection.kind === 'join') {
    const a = shots.find((x) => x.id === selection.sourceId)
    const b = shots.find((x) => x.id === selection.targetId)
    const pair = a && b ? `${a.no || a.id}→${b.no || b.id}` : '接缝'
    if (skill === 'transition-director') return `${pair} · 转场决策`
    return `${pair} · 转场提示词`
  }
  if (skill === 'shotlist') return '本集 · 拆镜'
  if (skill === 'transition-director') return '本集 · 转场决策'
  return '本集 · 转场提示词'
}
