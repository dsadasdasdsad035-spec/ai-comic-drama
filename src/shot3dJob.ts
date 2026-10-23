import type { AppSettings, DesignSheet, ProjectAsset, ProjectData, ProjectEpisode, ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import type { SceneLayout, ShotBlocking, ShotData, ShotScene, VisualBrief, VisualBriefMeta } from './types'
import { askVision } from './api'
import { stageModelKey, type StagePick } from './ModelSelect'
import { buildBlockingContext, buildSceneContext, buildShotResourcePack, linkedAssetsFor, sceneDesignFor } from './scheduleContext'
import { generateShotBundle, type Ask } from './scheduleAI'
import { buildReferenceBoard } from './referenceBoard'
import { VISION_SYSTEM, buildVisionPrompt, makeVisualBriefMeta, normalizeVisualBrief, visualBriefFingerprint } from './visualBrief'
import { resolveShotScene, previousShotFor } from './shotScene'

export type Shot3DJobInput = {
  projectName: string
  data: ShotData
  shotId: string
  project?: ProjectData | null
  sceneLayouts?: SceneLayout[]
  characters: CharacterSheet[]
  assets: ProjectAsset[]
  nodes: { id: string; data?: object }[]
  settings: AppSettings | null
  stagePick: StagePick
  aspect: string
  ask: Ask
  /** 已有的本镜视觉 brief（缓存用） */
  existingBrief?: VisualBrief
  existingBriefMeta?: VisualBriefMeta
  signal?: AbortSignal
}

export type Shot3DJobResult = {
  scene: ShotScene
  blocking: ShotBlocking
  visualBrief?: VisualBrief
  visualBriefMeta?: VisualBriefMeta
  seedScene?: ShotScene
  warnings: string[]
  usedVision: boolean
}

function episodeOf(project: ProjectData | null | undefined, no: number): ProjectEpisode | undefined {
  return (project?.episodes ?? []).find((e) => Number(e.no) === no)
}

function relatedShots(project: ProjectData | null | undefined, episodeNo: number, sceneNo: number, data: ShotData) {
  const rows = (project?.shots ?? [])
    .filter((s) => (Number(s.episode) || 1) === episodeNo && (Math.max(1, Number(s.scene_no) || 1)) === sceneNo)
    .map((s) => ({
      no: s.no,
      size: s.size,
      move: s.move,
      seconds: s.seconds,
      prompt: s.keyframe_prompt || s.desc,
      videoPrompt: s.video_prompt,
      cast: s.cast,
      dialogue: s.dialogue,
    }))
  if (!rows.some((s) => s.no === data.no)) {
    rows.push({
      no: data.no,
      size: data.size,
      move: data.move,
      seconds: data.seconds,
      prompt: data.prompt,
      videoPrompt: data.videoPrompt,
      cast: data.cast,
      dialogue: data.dialogue,
    })
  }
  return rows
}

function currentShotForSeed(project: ProjectData | null | undefined, shotId: string, data: ShotData): ProjectShot | null {
  return (
    (project?.shots ?? []).find((s) => s.id === shotId) ?? {
      id: shotId,
      episode: data.episode,
      no: data.no,
      scene_no: data.sceneNo,
      scene_slug: data.sceneSlug,
      cast: data.cast,
      keyframe_prompt: data.prompt,
    }
  )
}

/**
 * 每镜 3D 编排：参考板 -> (vision brief) -> seed scene -> 联合生成。
 * 无视觉模型/无图片/视觉失败都回退文本，不阻塞。
 */
export async function runShot3DJob(input: Shot3DJobInput): Promise<Shot3DJobResult> {
  const data = input.data
  const episodeNo = Number(data.episode) || 1
  const sceneNo = Math.max(1, Math.round(Number(data.sceneNo) || 1))
  const sceneSlug = data.sceneSlug || ''
  const resolved = resolveShotScene(data, {
    shotId: input.shotId,
    sceneLayouts: input.sceneLayouts,
    episode: episodeNo,
    sceneNo,
    sceneSlug,
  })
  const currentShot = currentShotForSeed(input.project, input.shotId, data)
  const previous = currentShot
    ? previousShotFor(input.project?.shots ?? [], input.shotId, input.sceneLayouts ?? [])
    : null
  const seedScene = previous?.scene
  const scene = episodeOf(input.project, episodeNo)
  const sc = (scene?.scenes ?? []).find((x) => Number(x.no) === sceneNo)
  const roster = [
    ...new Set([
      ...(data.cast ?? []),
      ...String(data.dialogue || '')
        .split('\n')
        .map((line) => line.match(/^([^：:]{1,12})[：:]\s*(.+)$/)?.[1] || '')
        .filter(Boolean),
    ]),
  ].filter(Boolean)
  const linkedAssets = linkedAssetsFor(input.assets, data, input.nodes)
  const designs = input.project?.designs ?? []
  const sceneDesign = sceneDesignFor({ designs, scene: sc, designId: resolved.scene.designId })
  const sceneForPack = sceneDesign ? { ...resolved.scene, designId: sceneDesign.id } : resolved.scene
  const blockingCtx = {
    episode: scene,
    scene: sceneForPack,
    shot: {
      no: data.no,
      seconds: data.seconds,
      size: data.size,
      move: data.move,
      cast: data.cast,
      dialogue: data.dialogue,
      prompt: data.prompt,
      videoPrompt: data.videoPrompt,
      refIds: data.refIds,
      refExtras: data.refExtras,
      refImage: data.refImage,
      candidates: data.candidates,
      activeIdx: data.activeIdx,
    },
    characters: input.characters,
    designs,
    linkedAssets,
    marks: data.marks,
    aspect: input.aspect,
  }
  const pack = buildShotResourcePack({
    shot: blockingCtx.shot,
    scene: sceneForPack,
    characters: input.characters,
    designs,
    linkedAssets,
    marks: data.marks,
  })

  let visualBrief: VisualBrief | undefined
  let visualBriefMeta: VisualBriefMeta | undefined
  let usedVision = false
  const warnings: string[] = []
  let board = null as Awaited<ReturnType<typeof buildReferenceBoard>> | null
  if (pack.resources.length && typeof document !== 'undefined') {
    try {
      board = await buildReferenceBoard({
        currentFrame: pack.currentFrame,
        scene: pack.scene,
        characters: pack.characters,
        props: pack.props,
        manifest: pack.manifest,
        resources: pack.resources,
      })
    } catch {
      board = null
    }
  }
  if (board?.hasImages && board.fingerprint === input.existingBriefMeta?.fingerprint && input.existingBrief) {
    visualBrief = input.existingBrief
    visualBriefMeta = input.existingBriefMeta
    usedVision = Boolean(input.existingBriefMeta.usedVision)
  } else if (board?.hasImages) {
    const visionKey = stageModelKey(input.settings, 'vision', input.stagePick)
    if (visionKey) {
      try {
        const v = await askVision({
          system: VISION_SYSTEM,
          prompt: buildVisionPrompt(board.manifest),
          image: board.dataUrl,
          modelKey: visionKey,
          json: true,
          maxTokens: 1600,
          signal: input.signal,
        })
        const brief = normalizeVisualBrief(v.json, true)
        if (brief.subjects.length || brief.visible.length || brief.composition) {
          visualBrief = brief
          usedVision = true
          visualBriefMeta = makeVisualBriefMeta({
            fingerprint: board.fingerprint,
            usedVision: true,
            modelKey: v.modelKey,
          })
        }
      } catch (e) {
        warnings.push(`视觉观察失败，已回退文本：${(e as Error).message}`)
      }
    } else {
      warnings.push('没有配置视觉模型，参考图未参与推理')
    }
  }
  if (board?.hasImages && !usedVision) {
    const fingerprint = board.fingerprint || visualBriefFingerprint({ resources: pack.resources, manifest: pack.manifest })
    visualBriefMeta = makeVisualBriefMeta({ fingerprint, usedVision: false })
  }

  const sceneCtx = {
    episode: scene,
    scene: sc,
    sceneNo,
    shots: relatedShots(input.project, episodeNo, sceneNo, data),
    designs,
    designId: sceneDesign?.id,
    layout: seedScene ?? (resolved.migrated ? undefined : sceneForPack),
  }
  const bundle = await generateShotBundle({
    sceneContext: sceneCtx,
    blockingContext: {
      ...blockingCtx,
      visualBriefText: visualBrief
        ? JSON.stringify(visualBrief)
        : warnings.some((w) => w.includes('视觉')) || !usedVision
          ? '参考图未参与推理'
          : undefined,
    },
    roster,
    seedScene,
    existingScene: resolved.migrated ? undefined : sceneForPack,
    visualBrief,
    ask: input.ask,
    signal: input.signal,
  })
  const sceneOut: ShotScene = {
    ...bundle.scene,
    id: input.shotId,
    episode: episodeNo,
    sceneNo,
    ...(sceneSlug ? { sceneSlug } : {}),
    source: 'ai',
    ...(seedScene ? { seedFrom: seedScene.id } : {}),
  }
  return {
    scene: sceneOut,
    blocking: bundle.blocking,
    ...(visualBrief ? { visualBrief } : {}),
    ...(visualBriefMeta ? { visualBriefMeta } : {}),
    ...(seedScene ? { seedScene } : {}),
    warnings: [...warnings, ...bundle.warnings],
    usedVision,
  }
}
