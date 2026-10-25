import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import { audioRefCapabilitiesFor, nativeAudioPrompt, nativeAudioRef } from './nativeAudio'
import { parseDialogue } from './prompts'
import { motionNoteOf, shortHash } from './scheduleGeometry'
import type { ShotScheduleState } from './scheduleStatus'
import {
  collectShotReferences,
  collectVideoReferences,
  SHOT_NEXT,
  SHOT_PREV,
  type ResolvedShotReference,
  type ResolvedVideoReference,
} from './shotReferences'
import type { ShotData, VideoPromptOverride } from './types'

export type VideoRequestMode = 'first' | 'ref' | 'video' | 'native'

export type VideoAttachment = {
  slot: 'image' | 'video' | 'audio'
  /** 图片从 1 开始；视频和音频固定 1 */
  index: number
  url: string
  label: string
  purpose: string
  source?: string
  /** 仅音频：音色参考对应的角色名 */
  character?: string
}

export type VideoRequestIssue = {
  code: string
  message: string
  level: 'warn' | 'error'
}

export type ShotVideoRequest = {
  /** 没有手改时实际发送的正文 */
  prompt: string
  mode: VideoRequestMode
  refs: VideoAttachment[]
  firstFrame: { url: string; label: string; purpose: string } | null
  video: VideoAttachment | null
  audio: VideoAttachment | null
  /** 超过 4 张额度而被省略的图片 */
  omitted: { label: string; reason: string }[]
  /** 首期只使用第一条视频素材，其余在这里说明 */
  omittedVideos: { label: string; reason: string }[]
  textSource: 'video_prompt' | 'prompt_fallback' | 'fallback'
  seconds: number
  resolution: string
  warnings: VideoRequestIssue[]
  blocking: VideoRequestIssue[]
  fingerprint: string
}

export type VideoModelInput = {
  key?: string
  model?: string
  providerKind?: string
  audioOut?: boolean
  supportsVideoRef?: boolean
}

type ComposerRef = {
  url: string
  label: string
  kind: 'current' | ResolvedShotReference['source']
  purpose: string
}

function purposeOf(ref: ResolvedShotReference): string {
  if (ref.source === 'expression') return '表情参考'
  if (ref.source === 'character') return '人物外观'
  if (ref.source === 'adjacent') return '相邻镜连贯'
  if (ref.source === 'extra') return '手工参考'
  if (ref.label.startsWith('场景')) return '场景外观'
  if (ref.label.startsWith('道具')) return '道具外观'
  return '参考外观'
}

/** 当前画面优先，再按共享解析器顺序；调度关键帧不再进入图片参考。 */
function collectComposerRefs(input: {
  data: ShotData
  nodeId: string
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
}): {
  refs: ComposerRef[]
  missing: { token: string; label: string; reason: string }[]
  expressionNote?: 'no-speaker' | 'unavailable'
} {
  const collected = collectShotReferences({
    node: { id: input.nodeId, data: input.data } as unknown as ShotNodeType,
    nodes: input.nodes,
    characters: input.characters,
    missingMedia: input.missingMedia,
  })
  const refs: ComposerRef[] = []
  const seen = new Set<string>()
  const push = (ref: ComposerRef) => {
    if (!ref.url || seen.has(ref.url)) return
    seen.add(ref.url)
    refs.push(ref)
  }
  if (input.data.refImage) {
    push({ url: input.data.refImage, label: '当前画面构图', kind: 'current', purpose: '画风/构图' })
  }

  // 表情默认不参与视频；显式开启时只取说话角色一张，放在身份/场景之后。
  const speaker = (input.data.performance ?? []).find((p) => p.speaks)?.character
  const expression = input.data.useExpressionRef && speaker
    ? collected.refs.find((ref) => ref.source === 'expression' && ref.character === speaker)
    : undefined
  const expressionNote: 'no-speaker' | 'unavailable' | undefined = input.data.useExpressionRef
    ? !speaker
      ? 'no-speaker'
      : !expression
        ? 'unavailable'
        : undefined
    : undefined

  for (const ref of collected.refs) {
    if (ref.source === 'expression') continue
    push({ url: ref.url, label: ref.label, kind: ref.source, purpose: purposeOf(ref) })
  }
  if (expression) {
    push({
      url: expression.url,
      label: expression.label,
      kind: 'expression',
      purpose: '表情参考',
    })
  }
  return { refs, missing: collected.missing, ...(expressionNote ? { expressionNote } : {}) }
}

function buildRefHint(refs: ComposerRef[], hasVideo: boolean): string {
  if (refs.length === 0) return ''
  const all = refs
    .map((r, i) => `${hasVideo ? `@图像${i + 1}` : `[图${i + 1}]`}=${r.label}`)
    .join('，')
  return `\n\n参考图：${all}。主体外观、场景与道具必须与参考图一致。`
}

function buildVideoHint(video: ResolvedVideoReference | undefined): string {
  if (!video) return ''
  return `\n\n参考 @视频1（${video.label}）的运动、机位与节奏；画面风格、人物外观、场景与道具以参考图和文字为准。`
}

function fingerprintOf(input: {
  data: ShotData
  candidates: ComposerRef[]
  refs: ComposerRef[]
  mode: VideoRequestMode
  motion: string
  textSource: string
  motionNote: string
  seconds: number
  dialogue: { speaker: string; text: string }[]
  audio: VideoAttachment | null
  videos: ResolvedVideoReference[]
}): string {
  return shortHash(
    JSON.stringify({
      v: 1,
      mode: input.mode,
      refs: input.candidates.map((r) => [r.kind, r.url, r.label]),
      used: input.refs.map((r) => r.url),
      current: input.data.refImage || '',
      motion: input.motion,
      textSource: input.textSource,
      motionNote: input.motionNote,
      seconds: input.seconds,
      size: input.data.size,
      move: input.data.move,
      dialogue: input.dialogue.map((line) => [line.speaker, line.text]),
      audio: input.audio ? [input.audio.label, input.audio.url] : null,
      videos: input.videos.map((r) => [r.url, r.label]),
      useExpressionRef: Boolean(input.data.useExpressionRef),
    }),
  )
}

/**
 * 画布出片请求的唯一拼装入口：预览和实际请求都用这份返回值。
 * 纯函数，不读 DOM、不发请求；遇到会阻止出片的条件只返回 blocking，不抛错。
 */
export function buildShotVideoRequest(input: {
  data: ShotData
  nodeId: string
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia?: Set<string>
  schedule: ShotScheduleState
  model?: VideoModelInput | null
  resolution?: string
}): ShotVideoRequest {
  const d = input.data
  const seconds = Math.round(Number(d.seconds) || 0)
  const resolution = String(input.resolution || '')
  const dialogue = parseDialogue(d.dialogue)
  const nativeMode = d.audioMode === 'native'
  const audioCaps = audioRefCapabilitiesFor({
    providerKind: input.model?.providerKind,
    model: input.model?.model,
    audioOut: input.model?.audioOut,
  })
  const nativeRef = nativeMode
    ? nativeAudioRef({
        dialogue,
        performance: d.performance,
        characters: input.characters,
        caps: audioCaps,
        seconds: Number(d.seconds) || 0,
      })
    : null

  const { refs: candidates, missing, expressionNote } = collectComposerRefs({
    data: d,
    nodeId: input.nodeId,
    nodes: input.nodes,
    characters: input.characters,
    missingMedia: input.missingMedia ?? new Set(),
  })
  const videoCollection = collectVideoReferences({
    node: { id: input.nodeId, data: d } as unknown as ShotNodeType,
    nodes: input.nodes,
    missingMedia: input.missingMedia ?? new Set(),
  })
  const videos = videoCollection.refs
  const primaryVideo = videos[0]
  const omittedVideos = videos.slice(1).map((r) => ({
    label: r.label,
    reason: '首期只使用第一条视频素材',
  }))
  const limited = candidates.slice(0, 4)
  const omitted = candidates.slice(4).map((r) => ({
    label: r.label,
    reason: r.kind === 'expression' ? '表情参考因参考图 4 张上限省略' : '超过参考图 4 张上限',
  }))

  const motion = (d.videoPrompt || d.prompt).trim()
  const textSource: ShotVideoRequest['textSource'] = d.videoPrompt?.trim()
    ? 'video_prompt'
    : d.prompt?.trim()
      ? 'prompt_fallback'
      : 'fallback'
  const fallback = `${d.size}，${
    d.move === '固定' ? '机位固定不动，仅人物与环境的细微动态' : `镜头${d.move}`
  }，24fps，雨丝与光尘缓慢飘动，画面无过曝无噪点`
  const liveMotionNote =
    motionNoteOf(input.schedule.scene, input.schedule.blocking, input.schedule.duration, d.move) ||
    d.motionNote ||
    ''
  const nativeSound =
    nativeMode && nativeRef?.ok ? nativeAudioPrompt(nativeRef.character, dialogue, true) : ''
  const refHint = buildRefHint(limited, Boolean(primaryVideo))
  const videoHint = buildVideoHint(primaryVideo)
  const prompt =
    (motion || fallback) +
    (liveMotionNote ? `\n【运镜与走位】${liveMotionNote}` : '') +
    (nativeSound ? `\n\n${nativeSound}` : '') +
    refHint +
    videoHint

  const mode: VideoRequestMode = nativeMode
    ? 'native'
    : primaryVideo
      ? 'video'
      : limited.length > 0
        ? 'ref'
        : 'first'

  // 原生音频没有参考图时，原逻辑会用当前画面兜底成一个 reference_image。
  const effective = nativeMode && limited.length === 0 && d.refImage
    ? [{ url: d.refImage, label: '当前画面构图', kind: 'current' as const, purpose: '画风/构图' }]
    : limited
  const refs: VideoAttachment[] = effective.map((r, i) => ({
    slot: 'image',
    index: i + 1,
    url: r.url,
    label: r.label,
    purpose: r.purpose,
    source: r.kind,
  }))
  const firstFrame =
    !nativeMode && !primaryVideo && refs.length === 0 && d.refImage
      ? { url: d.refImage, label: '当前画面构图', purpose: '画风/构图' }
      : null
  const video: VideoAttachment | null = primaryVideo
    ? {
        slot: 'video',
        index: 1,
        url: primaryVideo.url,
        label: primaryVideo.label,
        purpose: '运动/机位',
        source: 'asset',
      }
    : null
  const audio: VideoAttachment | null =
    nativeMode && nativeRef?.ok
      ? {
          slot: 'audio',
          index: 1,
          url: nativeRef.url,
          label: `${nativeRef.character} 音色`,
          purpose: '音色',
          character: nativeRef.character,
        }
      : null

  const warnings: VideoRequestIssue[] = []
  const blocking: VideoRequestIssue[] = []
  for (const m of videoCollection.missing) {
    blocking.push({
      code: 'video-asset-missing',
      level: 'error',
      message: `${m.label}：${m.reason}`,
    })
  }
  if (primaryVideo && input.model && !input.model.supportsVideoRef) {
    warnings.push({
      code: 'video-ref-unsupported',
      level: 'warn',
      message: '当前出片模型不支持视频参考，提交后会失败',
    })
  }
  if (expressionNote === 'no-speaker') {
    warnings.push({
      code: 'expression-no-speaker',
      level: 'warn',
      message: '已开启表情参考，但本镜没有说话角色；本次不加入表情图',
    })
  }
  if (expressionNote === 'unavailable') {
    warnings.push({
      code: 'expression-unavailable',
      level: 'warn',
      message: '已开启表情参考，但说话角色没有有效的总图单格；本次回退文字表演',
    })
  }

  const identityCount = candidates.filter((r) => r.kind === 'character').length
  const currentCount = candidates.filter((r) => r.kind === 'current').length
  if (identityCount + currentCount > 4) {
    blocking.push({
      code: 'reference-overflow-identity',
      level: 'error',
      message: `当前画面 + ${identityCount} 张角色身份图超过 4 张参考上限，请减少入画角色或拆镜`,
    })
  }

  const invalidNeighbor = missing.find((m) => m.token === SHOT_PREV || m.token === SHOT_NEXT)
  if (invalidNeighbor) {
    blocking.push({
      code: 'neighbor-missing',
      level: 'error',
      message: `${invalidNeighbor.label}：${invalidNeighbor.reason}`,
    })
  }
  if (nativeMode && nativeRef && !nativeRef.ok) {
    blocking.push({ code: 'native-unavailable', level: 'error', message: nativeRef.reason })
  }
  if (nativeMode && primaryVideo) {
    blocking.push({
      code: 'native-video-conflict',
      level: 'error',
      message: '原生音频只能用参考图模式，请取消视频素材参考',
    })
  }
  if (refs.length === 0 && !firstFrame && !primaryVideo) {
    blocking.push({
      code: 'no-image',
      level: 'error',
      message: '先出画面，或在画布上连线一张参考图/视频素材',
    })
  }
  if (nativeMode && refs.length === 0) {
    blocking.push({
      code: 'native-no-image',
      level: 'error',
      message: '原生音频需要一张关键帧/参考图',
    })
  }

  const fingerprint = fingerprintOf({
    data: d,
    candidates,
    refs: limited,
    mode,
    motion: motion || fallback,
    textSource,
    motionNote: liveMotionNote,
    seconds,
    dialogue,
    audio,
    videos,
  })

  return {
    prompt,
    mode,
    refs,
    firstFrame,
    video,
    audio,
    omitted,
    omittedVideos,
    textSource,
    seconds,
    resolution,
    warnings,
    blocking,
    fingerprint,
  }
}

export type EffectiveVideoPrompt = {
  text: string
  source: 'auto' | 'override'
  stale: boolean
}

/** 手改快照优先；过期只提示，不阻止出片。 */
export function effectiveVideoPrompt(
  request: Pick<ShotVideoRequest, 'prompt' | 'fingerprint'>,
  override?: VideoPromptOverride | null,
): EffectiveVideoPrompt {
  if (!override?.text) return { text: request.prompt, source: 'auto', stale: false }
  return {
    text: override.text,
    source: 'override',
    stale: Boolean(override.fingerprint && override.fingerprint !== request.fingerprint),
  }
}
