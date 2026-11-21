import type { ProjectEpisode, ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import { parseDialogue } from './prompts'
import { auditKeyframePromptCore, auditVideoPromptCore } from './promptAuditCore.mjs'
import { AUDIT_VOCAB } from './videoPromptVocab'

export type PromptAudit = {
  cast: string[]
  /** 硬问题：有台词的角色缺锚点 */
  missing: string[]
  /** 软提示：只在描述里被提到、没有台词的角色缺锚点 */
  maybe: string[]
  unknown: string[]
  empty: boolean
}

/**
 * 首帧提示词锚点审计：cast 权威时以 cast 为准，否则台词+描述启发式。
 *
 * 判定逻辑已抽到 `promptAuditCore.mjs`（服务端大厅健康统计复用同一份），
 * 这里只做「浏览器角色卡 → 核心入参」的字段映射，避免两边口径漂移。
 */
export function auditKeyframePrompt(s: ProjectShot, chars: CharacterSheet[]): PromptAudit {
  return auditKeyframePromptCore(
    s,
    chars.map((c) => ({ name: c.name, lookEn: c.lookEn })),
  )
}

export function promptCastLabel(s: ProjectShot): string {
  const declared = Array.isArray(s.cast) && s.cast.length > 0 ? s.cast : null
  if (declared) return declared.join('、')
  const dlg = Array.isArray(s.dialogue)
    ? s.dialogue
    : typeof s.dialogue === 'string'
      ? parseDialogue(s.dialogue)
      : []
  const spoken = dlg.map((d) => d.speaker).filter(Boolean)
  return spoken.join('、')
}

export type VideoPromptAuditInput = {
  shot: ProjectShot
  /** 同集镜头，用于取下一镜与判断末镜 */
  episodeShots: ProjectShot[]
  episodes: ProjectEpisode[]
  chars: CharacterSheet[]
  /** 已解析的参考集摘要：kind + name */
  refs?: Array<{ kind?: string; name?: string }>
  /** 已建档场景 / 道具名 */
  castSceneNames?: string[]
  propNames?: string[]
}

/**
 * 视频提示词审计的浏览器侧映射。
 *
 * 把界面模型（角色卡、镜头、集场次）换算成核心入参，判定本身全在
 * `promptAuditCore.mjs`，与 Agent 写回走同一份逻辑，口径不会漂移。
 */
export function auditVideoPrompt(input: VideoPromptAuditInput) {
  const { shot, episodeShots, episodes, chars, refs = [] } = input
  const epNo = Number(shot.episode) || 1
  const ep = episodes.find((e) => (Number(e.no) || 0) === epNo)
  const sceneSlug = String(shot.scene_slug ?? '')
  const scene = (ep?.scenes ?? []).find((s) => String(s.slug ?? '') === sceneSlug)
  const sorted = episodeShots
    .slice()
    .sort((a, b) => String(a.no ?? '').localeCompare(String(b.no ?? ''), undefined, { numeric: true }))
  const idx = sorted.findIndex((s) => s.id === shot.id)
  const nextShot = idx >= 0 ? sorted[idx + 1] : undefined

  // 定稿文本：场次正文 + 各镜描述与台词 + 角色档案，供发声引文守真比对
  const dialogueSource = [
    ...(ep?.scenes ?? []).map((s) => String(s.beats ?? '')),
    ...episodeShots.map((s) => `${String(s.desc ?? '')} ${JSON.stringify(s.dialogue ?? '')}`),
    ...chars.map((c) => `${c.name ?? ''} ${c.lookCn ?? ''} ${c.lookEn ?? ''}`),
  ].join('\n')

  return auditVideoPromptCore(shot, {
    vocab: AUDIT_VOCAB,
    sceneBeats: String(scene?.beats ?? ''),
    refs,
    chars: chars.map((c) => ({ name: c.name, lookEn: c.lookEn })),
    castSceneNames: input.castSceneNames,
    propNames: input.propNames,
    dialogueSource,
    nextShot,
    isLastShot: idx >= 0 && idx === sorted.length - 1,
  })
}
