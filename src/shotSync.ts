import type { ProjectShot } from './api'
import { dialogueToText, parseDialogue } from './prompts'
import type { ShotData } from './types'

/**
 * LLM 重新生成之后的合并：手改过的字段保留旧值。
 * 这是 handEdited 唯一该生效的地方 —— 保存时不能拦，否则人改的东西存不进去。
 */
export function mergeGenerated(existing: ProjectShot[], generated: ProjectShot[]): ProjectShot[] {
  const byId = new Map(existing.map((s) => [s.id, s]))
  return generated.map((g) => {
    const old = byId.get(g.id)
    if (!old) return g
    const locked = old.handEdited ?? []
    if (locked.length === 0) return g
    const merged: ProjectShot = { ...g }
    for (const k of locked) {
      ;(merged as Record<string, unknown>)[k] = (old as Record<string, unknown>)[k]
    }
    merged.handEdited = [...locked]
    return merged
  })
}

/** 只认本地相对路径：dataURL / 外链（如方舟临时 TOS 地址）不能写进项目文件 */
export function localPath(u?: string): string | undefined {
  if (!u) return undefined
  const p = u.split('?')[0]
  return p.startsWith('/') && !p.startsWith('/api') ? p : undefined
}

/**
 * 画布节点的业务字段签名，用来判断有没有实质改动。
 * 必须包含 keyframe / clip —— 否则「只出了图/只出了片」不会触发写回，
 * 视频就永远进不了 project.json（实测踩到过）。
 */
export function bizSignature(d: ShotData): string {
  return JSON.stringify({
    no: d.no,
    seconds: d.seconds,
    size: d.size,
    move: d.move,
    dialogue: d.dialogue,
    keyframe_prompt: d.prompt,
    video_prompt: d.videoPrompt ?? '',
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    refExtras: d.refExtras ?? [],
    refIds: d.refIds ?? [],
  })
}

/** 画布节点 → 可写回 project.json 的镜头（不含画布私有态：坐标/标注/候选） */
export function nodeToShot(d: ShotData, id: string): ProjectShot {
  return {
    id,
    episode: d.episode,
    no: d.no,
    seconds: d.seconds,
    size: d.size,
    move: d.move,
    dialogue: parseDialogue(d.dialogue),
    keyframe_prompt: d.prompt,
    video_prompt: d.videoPrompt,
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    cast: d.cast,
    refExtras: d.refExtras,
    refIds: d.refIds,
  }
}

/** project.json 镜头 → 画布卡片数据（保留节点已有的图片/视频/配音） */
export function shotToData(s: ProjectShot, fallback: ShotData): ShotData {
  return {
    ...fallback,
    no: s.no ?? fallback.no,
    seconds: Number(s.seconds) || fallback.seconds,
    size: s.size || fallback.size,
    move: s.move || fallback.move,
    dialogue: typeof s.dialogue === 'string' ? s.dialogue : dialogueToText(s.dialogue),
    prompt: s.keyframe_prompt || s.desc || fallback.prompt,
    videoPrompt: s.video_prompt ?? fallback.videoPrompt,
    refImage: s.keyframe ?? fallback.refImage,
    videoUrl: s.clip ?? fallback.videoUrl,
    cast: s.cast,
    refExtras: s.refExtras,
    refIds: s.refIds,
    shotId: s.id,
    episode: s.episode,
    handEdited: s.handEdited ?? fallback.handEdited,
    orphan: false,
  }
}
