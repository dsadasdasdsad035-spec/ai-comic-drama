import type { ProjectShot } from './api'
import { dialogueToText, parseDialogue } from './prompts'
import { legacyLayoutToBlocking } from './scheduleGeometry'
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
    const merged: ProjectShot = { ...g }
    // 重新拆镜不会产出配音/口型产物；保留旧引用，避免一次拆镜把媒体链路清空。
    if (old.voice_meta && !g.voice_meta) merged.voice_meta = old.voice_meta
    if (old.lip_sync && !g.lip_sync) merged.lip_sync = old.lip_sync
    if (old.audio_mode && !g.audio_mode) merged.audio_mode = old.audio_mode
    if (old.audio_ref && !g.audio_ref) merged.audio_ref = old.audio_ref
    if (old.audio_meta && !g.audio_meta) merged.audio_meta = old.audio_meta
    if (old.video_meta && !g.video_meta) merged.video_meta = old.video_meta
    if (old.use_expression_ref !== undefined && g.use_expression_ref === undefined) {
      merged.use_expression_ref = old.use_expression_ref
    }
    const locked = old.handEdited ?? []
    if (locked.length === 0) return merged
    for (const k of locked) {
      ;(merged as Record<string, unknown>)[k] = (old as Record<string, unknown>)[k]
    }
    merged.handEdited = [...locked]
    return merged
  })
}

/** 清除指定字段的手改标记，让下一次模型生成可以接管这些字段。 */
export function clearHandEdited(s: ProjectShot, fields: string[]): ProjectShot {
  const drop = new Set(fields)
  const next = (s.handEdited ?? []).filter((f) => !drop.has(f))
  return { ...s, handEdited: next.length ? next : undefined }
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
    performance: d.performance ?? [],
    dialogue_delivery: d.dialogueDelivery ?? [],
    audio_mode: d.audioMode ?? 'off',
    audio_ref: d.audioRef ?? null,
    audio_meta: d.audioMeta ?? null,
    lip_sync: d.lipSync ?? { mode: 'off' },
    voice_meta: d.voiceMeta ?? null,
    keyframe_prompt: d.prompt,
    video_prompt: d.videoPrompt ?? '',
    video_prompt_override: d.videoPromptOverride,
    video_meta: d.videoMeta,
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    refExtras: d.refExtras ?? [],
    refIds: d.refIds ?? [],
    transitionOut: d.transitionOut ?? null,
    layout: d.layout ?? null,
    sceneNo: d.sceneNo ?? null,
    sceneSlug: d.sceneSlug ?? '',
    shotScene: d.shotScene ?? null,
    shotSceneSeed: d.shotSceneSeed ?? '',
    visualBrief: d.visualBrief ?? null,
    visualBriefMeta: d.visualBriefMeta ?? null,
    shotBlocking: d.shotBlocking ?? null,
    sceneCode: d.sceneCode ?? null,
    sceneCodeMeta: d.sceneCodeMeta ?? null,
    shot3DContext: d.shot3DContext ?? null,
    scheduleMeta: d.scheduleMeta ?? null,
    scheduleVideo: d.scheduleVideo ?? '',
    scheduleFrames: d.scheduleFrames ?? [],
    motionNote: d.motionNote ?? '',
    useScheduleFrames: d.useScheduleFrames ? 1 : 0,
    useScheduleVideoRef: d.useScheduleVideoRef ? 1 : 0,
    useExpressionRef: d.useExpressionRef ? 1 : 0,
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
    performance: d.performance,
    dialogue_delivery: d.dialogueDelivery,
    audio_mode: d.audioMode,
    audio_ref: d.audioRef,
    audio_meta: d.audioMeta,
    lip_sync: d.lipSync,
    voice_meta: d.voiceMeta,
    keyframe_prompt: d.prompt,
    video_prompt: d.videoPrompt,
    // null 是明确清除：mergeShots 只跳过 undefined，恢复自动拼装必须写 null
    video_prompt_override: d.videoPromptOverride ?? null,
    video_meta: d.videoMeta,
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    cast: d.cast,
    refExtras: d.refExtras,
    refIds: d.refIds,
    // null 是明确清除：mergeShots 会跳过 undefined，写 undefined 会让旧转场复活
    transition_out: d.transitionOut ?? null,
    layout: d.layout,
    scene_no: d.sceneNo,
    scene_slug: d.sceneSlug,
    shot_scene: d.shotScene,
    shot_scene_seed: d.shotSceneSeed,
    visual_brief: d.visualBrief,
    visual_brief_meta: d.visualBriefMeta,
    shot_blocking: d.shotBlocking ?? legacyLayoutToBlocking(d.layout),
    scene_code: d.sceneCode,
    scene_code_meta: d.sceneCodeMeta,
    shot_3d_context: d.shot3DContext,
    schedule_meta: d.scheduleMeta,
    schedule_video: localPath(d.scheduleVideo),
    schedule_frames: (d.scheduleFrames ?? []).map((u) => localPath(u)).filter((x): x is string => Boolean(x)),
    motion_note: d.motionNote ?? '',
    use_schedule_frames: Boolean(d.useScheduleFrames),
    use_schedule_video_ref: Boolean(d.useScheduleVideoRef),
    use_expression_ref: Boolean(d.useExpressionRef),
    ...(d.handEdited?.length ? { handEdited: d.handEdited } : {}),
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
    performance: s.performance ?? fallback.performance,
    dialogueDelivery: s.dialogue_delivery ?? fallback.dialogueDelivery,
    audioMode: s.audio_mode ?? fallback.audioMode ?? 'off',
    audioRef: s.audio_ref === undefined ? fallback.audioRef : s.audio_ref ?? undefined,
    audioMeta: s.audio_meta ?? fallback.audioMeta,
    lipSync: s.lip_sync ?? fallback.lipSync,
    voiceMeta: s.voice_meta ?? fallback.voiceMeta,
    prompt: s.keyframe_prompt || s.desc || fallback.prompt,
    videoPrompt: s.video_prompt ?? fallback.videoPrompt,
    videoPromptOverride:
      s.video_prompt_override === undefined ? fallback.videoPromptOverride : s.video_prompt_override ?? undefined,
    videoMeta: s.video_meta ?? fallback.videoMeta,
    refImage: s.keyframe ?? fallback.refImage,
    videoUrl: s.clip ?? fallback.videoUrl,
    cast: s.cast,
    refExtras: s.refExtras,
    // 字段缺失（旧项目）才沿用画布上的值；显式 null 表示已经删掉，不能复活
    transitionOut:
      s.transition_out === undefined ? fallback.transitionOut : s.transition_out ?? undefined,
    layout: (s.layout as ShotData['layout']) ?? fallback.layout,
    sceneNo: s.scene_no ?? fallback.sceneNo,
    sceneSlug: s.scene_slug ?? fallback.sceneSlug,
    shotScene: (s.shot_scene as ShotData['shotScene']) ?? fallback.shotScene,
    shotSceneSeed: s.shot_scene_seed ?? fallback.shotSceneSeed,
    visualBrief: s.visual_brief ?? fallback.visualBrief,
    visualBriefMeta: s.visual_brief_meta ?? fallback.visualBriefMeta,
    shotBlocking:
      s.shot_blocking ??
      fallback.shotBlocking ??
      legacyLayoutToBlocking((s.layout as ShotData['layout']) ?? fallback.layout),
    sceneCode: s.scene_code ?? s.sceneCode ?? fallback.sceneCode,
    sceneCodeMeta: s.scene_code_meta ?? s.sceneCodeMeta ?? fallback.sceneCodeMeta,
    shot3DContext: s.shot_3d_context ?? s.shot3DContext ?? fallback.shot3DContext,
    scheduleMeta: s.schedule_meta ?? fallback.scheduleMeta,
    scheduleVideo: s.schedule_video ?? fallback.scheduleVideo,
    scheduleFrames: (s.schedule_frames as string[] | undefined) ?? fallback.scheduleFrames,
    motionNote: s.motion_note ?? fallback.motionNote,
    useScheduleFrames: Boolean(s.use_schedule_frames ?? fallback.useScheduleFrames),
    useScheduleVideoRef: Boolean(s.use_schedule_video_ref ?? fallback.useScheduleVideoRef),
    useExpressionRef: Boolean(s.use_expression_ref ?? fallback.useExpressionRef),
    refIds: s.refIds,
    shotId: s.id,
    episode: s.episode,
    handEdited: s.handEdited ?? fallback.handEdited,
    orphan: false,
  }
}
