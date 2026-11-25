import type { ProjectShot } from './api'
import { resolveProdKind } from './shotProdKind'
import { dialogueToText, parseDialogue } from './prompts'
import { isLegacyHardCut, normalizeTransitionOut } from './transition'
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

export type ShotMergeMode = 'merge' | 'replace'

/**
 * 写回字段策略。
 *
 * - `import`：文件导入。只写文件里真给值的标量字段——文件不含媒体路径，
 *   放开会让一次导入抹掉已出图/已出片。
 * - `agent`：模型写回。业务字段全集（选角、表演、参考连线、转场、时长等），
 *   但产线产物（图/片/配音/口型/生成态/候选）一个都不许由模型凭想象写。
 */
export type ShotFieldPolicy = 'import' | 'agent'

/**
 * import：文件导入能写的字段。
 *
 * 为什么选角、表演、台词表演、参考连线、运镜参照能进白名单：
 * 它们是分镜的业务内容，导出的分镜表本来就该能原路灌回来。
 * 产线产物（图/片/配音/候选）仍然只能由生成工具写，见 SHOT_PIPELINE_FIELDS。
 */
export const SHOT_IMPORT_FIELDS = [
  'no',
  'seconds',
  'size',
  'move',
  'desc',
  'dialogue',
  'keyframe_prompt',
  'video_prompt',
  'scene_no',
  'scene_slug',
  'cast',
  'performance',
  'dialogue_delivery',
  'refIds',
  'lexicon_ref_key',
] as const satisfies readonly (keyof ProjectShot)[]

/** agent 在 import 之上额外能写的业务字段 */
export const SHOT_AGENT_EXTRA_FIELDS = [
  'cast',
  'performance',
  'dialogue_delivery',
  'refIds',
  'refExtras',
  'transition_out',
  'prod_kind',
  'motion_note',
  'video_prompt_override',
  'video_prompt_rendered',
  'handEdited',
] as const satisfies readonly (keyof ProjectShot)[]

/** Agent 写回分镜：不含提示词列（走 submit_prompts）与手改正文（走 set_shot_video_override） */
const SHOT_AGENT_PROMPT_FIELDS = new Set<string>([
  'keyframe_prompt',
  'video_prompt',
  'video_prompt_override',
  'video_prompt_rendered',
])

/**
 * 产线产物字段：只能由生成工具或画布 UI 写。
 * 导出是为了让测试能断言「两套策略都不含这些字段」，而不是靠人记。
 */
export const SHOT_PIPELINE_FIELDS = [
  'id',
  'episode',
  'keyframe',
  'clip',
  'audio_ref',
  'audio_meta',
  'voice_meta',
  'lip_sync',
  'video_meta',
  'video_prompt_render_meta',
  'candidates',
  'genState',
] as const satisfies readonly string[]

/** 参考连线并集：保持旧顺序，新项追加在末尾，重复项只留一份 */
function mergeRefIds(old: string[] | undefined, add: string[] | undefined): string[] {
  const out = [...(old ?? [])]
  for (const t of add ?? []) {
    const token = String(t ?? '').trim()
    if (token && !out.includes(token)) out.push(token)
  }
  return out
}

export const SHOT_FIELD_POLICY: Record<ShotFieldPolicy, readonly (keyof ProjectShot)[]> = {
  import: SHOT_IMPORT_FIELDS,
  agent: [
    ...SHOT_IMPORT_FIELDS.filter((k) => !SHOT_AGENT_PROMPT_FIELDS.has(k)),
    ...SHOT_AGENT_EXTRA_FIELDS.filter((k) => !SHOT_AGENT_PROMPT_FIELDS.has(k)),
  ],
}

/**
 * 导入用的镜头合并。
 *
 * 为什么不能直接用 mergeGenerated：它按 generated.map 返回，
 * 文件里没出现的镜头会被整条丢掉——20 镜的集导入 3 行会剩 3 镜。
 *
 * - replace：保持 mergeGenerated 的行为（聊天/生成用；技能被要求输出全集）
 * - merge：以镜号为准，只改文件出现的行，其余行原样保留；
 *          且只写文件给了值的字段（partial 语义），不给的列不覆盖。
 */
export function mergeShotsDraft(
  current: ProjectShot[],
  generated: ProjectShot[],
  epNo: number,
  mode: ShotMergeMode = 'merge',
  fieldPolicy: ShotFieldPolicy = 'import',
): { shots: ProjectShot[]; added: number; updated: number; kept: number } {
  const visibleNow = current.filter((s) => (Number(s.episode) || 1) === epNo)
  const others = current.filter((s) => (Number(s.episode) || 1) !== epNo)

  if (mode === 'replace') {
    const merged = mergeGenerated(visibleNow, generated)
    const beforeIds = new Set(visibleNow.map((s) => s.id))
    const added = merged.filter((s) => !beforeIds.has(s.id)).length
    return { shots: [...others, ...merged], added, updated: merged.length - added, kept: 0 }
  }

  const byNo = new Map(visibleNow.map((s) => [String(s.no ?? '').trim(), s]))
  const byId = new Map(visibleNow.map((s) => [s.id, s]))
  const nextVisible = [...visibleNow]
  /** id → 在 nextVisible 里的下标；替换后仍指向新对象，避免重复行 push 出两份 */
  const idxOf = new Map(visibleNow.map((s, i) => [s.id, i]))
  let added = 0
  let updated = 0
  const done = new Set<string>()

  for (const g of generated) {
    const key = String(g.no ?? '').trim()
    const old = byId.get(g.id) ?? byNo.get(key)
    if (!old) {
      const dup = nextVisible.find((s) => String(s.no ?? '').trim() === key)
      if (dup) continue
      nextVisible.push(g)
      idxOf.set(g.id, nextVisible.length - 1)
      added++
      continue
    }
    // 文件里同镜号出现两次：后一条不覆盖前一条，交给预览去报重复
    if (done.has(old.id)) continue
    done.add(old.id)
    // 只写策略允许、且导入行里真正给了值的字段；镜像数据（生成时是全新对象）不覆盖
    const next: ProjectShot = { ...old }
    const writable = SHOT_FIELD_POLICY[fieldPolicy]
    const setIf = <K extends keyof ProjectShot>(k: K, v: ProjectShot[K] | undefined) => {
      if (v === undefined) return
      if (!writable.includes(k)) return
      next[k] = v
    }
    setIf('no', g.no)
    setIf('seconds', g.seconds)
    setIf('size', g.size)
    setIf('move', g.move)
    setIf('desc', g.desc)
    setIf('dialogue', g.dialogue)
    setIf('keyframe_prompt', g.keyframe_prompt)
    setIf('video_prompt', g.video_prompt)
    setIf('scene_no', g.scene_no)
    setIf('scene_slug', g.scene_slug)
    // agent 策略下的业务字段：选角、表演、参考连线、转场、时长提示、生成方式
    setIf('cast', g.cast)
    setIf('performance', g.performance)
    setIf('dialogue_delivery', g.dialogue_delivery)
    // 参考连线：导入是「增补」——文件没提到的既有连线不能被抹掉；
    // 模型写回是替换，因为它拿到了完整的镜头状态
    if (g.refIds !== undefined && writable.includes('refIds')) {
      next.refIds = fieldPolicy === 'import' ? mergeRefIds(old.refIds, g.refIds) : g.refIds
    }
    setIf('refExtras', g.refExtras)
    // 接缝写回一律归一化：外部（导入/Agent）带来的生成配置不进项目。
    // legacy `{kind:'cut'}` 是硬切，写回时清空而不是变成叠化。
    if (writable.includes('transition_out') && g.transition_out !== undefined) {
      next.transition_out =
        g.transition_out && !isLegacyHardCut(g.transition_out)
          ? normalizeTransitionOut(g.transition_out)
          : null
    }
    setIf('prod_kind', g.prod_kind)
    setIf('motion_note', g.motion_note)
    setIf('lexicon_ref_key', g.lexicon_ref_key)
    setIf('video_prompt_override', g.video_prompt_override)
    setIf('video_prompt_rendered', g.video_prompt_rendered)
    // 模型不能自行声明「这些字段是人改的」：handEdited 记录的是人的操作
    if (fieldPolicy === 'agent') {
      if (Array.isArray(g.handEdited) && g.handEdited.length) next.handEdited = g.handEdited
    }
    // 手改保护：被锁定的字段回填旧值
    for (const k of old.handEdited ?? []) {
      ;(next as Record<string, unknown>)[k] = (old as Record<string, unknown>)[k]
    }
    const idx = idxOf.get(old.id)
    if (idx !== undefined) nextVisible[idx] = next
    else nextVisible.push(next)
    updated++
  }

  return { shots: [...others, ...nextVisible], added, updated, kept: visibleNow.length - updated }
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
    video_prompt_rendered: d.videoPromptRendered ?? '',
    video_prompt_render_meta: d.videoPromptRenderMeta,
    video_prompt_override: d.videoPromptOverride,
    video_meta: d.videoMeta,
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    refExtras: d.refExtras ?? [],
    refIds: d.refIds ?? [],
    transitionOut: d.transitionOut ? normalizeTransitionOut(d.transitionOut) : null,
    sceneNo: d.sceneNo ?? null,
    sceneSlug: d.sceneSlug ?? '',
    visualBrief: d.visualBrief ?? null,
    visualBriefMeta: d.visualBriefMeta ?? null,
    motionNote: d.motionNote ?? '',
    // 绑定与解绑都要触发写回：解绑写空串，落库后读回按未绑定处理
    lexiconRefKey: d.lexiconRefKey ?? '',
    lexiconRefUrl: d.lexiconRefUrl ?? '',
    motionLexiconAsRef: Boolean(d.motionLexiconAsRef),
    useExpressionRef: d.useExpressionRef ? 1 : 0,
  })
}

/**
 * 画布节点 → 可写回 project.json 的镜头（不含画布私有态：坐标/标注/候选）
 *
 * `unlockedFields` 是一次性解锁信号：服务端据此从 handEdited 里移除这些字段
 * （正常保存是并集、只增不减）。它只出现在提交载荷里，不落库、不进画布状态。
 */
export function nodeToShot(
  d: ShotData,
  id: string,
  opts?: { unlockedFields?: string[] },
): ProjectShot {
  const unlocked = (opts?.unlockedFields ?? []).filter(Boolean)
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
    video_prompt_rendered: d.videoPromptRendered ?? null,
    video_prompt_render_meta: d.videoPromptRenderMeta ?? null,
    video_meta: d.videoMeta,
    keyframe: localPath(d.refImage),
    clip: localPath(d.videoUrl),
    cast: d.cast,
    refExtras: d.refExtras,
    refIds: d.refIds,
    // null 是明确清除：mergeShots 会跳过 undefined，写 undefined 会让旧转场复活
    // null 是明确清除：mergeShots 会跳过 undefined，写 undefined 会让旧转场复活。
    // 归一化兜住旧画布/外部写入：生成配置不进项目文件。
    transition_out: d.transitionOut ? normalizeTransitionOut(d.transitionOut) : null,
    scene_no: d.sceneNo,
    scene_slug: d.sceneSlug,
    visual_brief: d.visualBrief,
    visual_brief_meta: d.visualBriefMeta,
    motion_note: d.motionNote ?? '',
    // null 是明确清除：服务端字段级合并会跳过 undefined，写 undefined 会让解绑后旧参照复活
    lexicon_ref_key: d.lexiconRefKey ?? null,
    lexicon_ref_url: d.lexiconRefUrl ?? null,
    motion_lexicon_as_ref: Boolean(d.motionLexiconAsRef),
    use_expression_ref: Boolean(d.useExpressionRef),
    prod_kind: d.prodKind,
    ...(d.handEdited?.length ? { handEdited: d.handEdited } : {}),
    ...(unlocked.length ? { handEditedUnlocked: unlocked } : {}),
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
    voiceUrl: s.voice_meta?.url ?? fallback.voiceUrl,
    voiceSeconds: s.voice_meta?.seconds ?? fallback.voiceSeconds,
    prompt: s.keyframe_prompt || s.desc || fallback.prompt,
    videoPrompt: s.video_prompt ?? fallback.videoPrompt,
    videoPromptOverride:
      s.video_prompt_override === undefined ? fallback.videoPromptOverride : s.video_prompt_override ?? undefined,
    videoPromptRendered:
      s.video_prompt_rendered === undefined ? fallback.videoPromptRendered : s.video_prompt_rendered ?? undefined,
    videoPromptRenderMeta:
      s.video_prompt_render_meta === undefined ? fallback.videoPromptRenderMeta : s.video_prompt_render_meta ?? undefined,
    videoMeta: s.video_meta ?? fallback.videoMeta,
    refImage: s.keyframe ?? fallback.refImage,
    videoUrl: s.clip ?? fallback.videoUrl,
    cast: s.cast,
    refExtras: s.refExtras,
    // 字段缺失（旧项目）才沿用画布上的值；显式 null 表示已经删掉，不能复活。
    // 归一化在这里做：旧存档里的生成配置（generated）读入即剥离，画布与写回都只见效果位。
    // 升级前的 `{kind:'cut'}` 是硬切语义，必须变成 undefined（没有转场），
    // 直接归一化会把它静默变成 0.5s 叠化 —— 那等于替用户改了片子。
    transitionOut:
      s.transition_out === undefined
        ? fallback.transitionOut
        : s.transition_out
          ? isLegacyHardCut(s.transition_out)
            ? undefined
            : normalizeTransitionOut(s.transition_out)
          : undefined,
    sceneNo: s.scene_no ?? fallback.sceneNo,
    sceneSlug: s.scene_slug ?? fallback.sceneSlug,
    visualBrief: s.visual_brief ?? fallback.visualBrief,
    visualBriefMeta: s.visual_brief_meta ?? fallback.visualBriefMeta,
    motionNote: s.motion_note ?? fallback.motionNote,
    // 字段缺失（旧项目）才沿用画布上的值；显式空串表示已解绑
    lexiconRefKey: s.lexicon_ref_key === undefined ? fallback.lexiconRefKey : s.lexicon_ref_key || undefined,
    lexiconRefUrl: s.lexicon_ref_url === undefined ? fallback.lexiconRefUrl : s.lexicon_ref_url || undefined,
    motionLexiconAsRef:
      s.motion_lexicon_as_ref === undefined ? fallback.motionLexiconAsRef : Boolean(s.motion_lexicon_as_ref),
    useExpressionRef: Boolean(s.use_expression_ref ?? fallback.useExpressionRef),
    refIds: s.refIds,
    shotId: s.id,
    episode: s.episode,
    handEdited: s.handEdited ?? fallback.handEdited,
    orphan: false,
    prodKind: resolveProdKind(s, {
      refImage: fallback.refImage,
      videoUrl: fallback.videoUrl,
      vidState: fallback.vidState,
      videoMeta: fallback.videoMeta,
      candidates: fallback.candidates,
      genState: fallback.genState,
    }),
  }
}
