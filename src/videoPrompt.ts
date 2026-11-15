import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import {
  audioRefCapabilitiesFor,
  nativeAudioRef,
} from './nativeAudio'
import { parseDialogue } from './prompts'
import { performanceDirectionText, performanceFingerprintPayload } from './performance'
import { nativeAudioPrompt } from './nativeAudio'
import { shortHash } from './hash'
import { resolveShotLexiconRef, lexiconMoveLine } from './cameraLexicon'
import {
  collectShotReferences,
  collectVideoReferences,
  SHOT_NEXT,
  SHOT_PREV,
  type ResolvedShotReference,
  type ResolvedVideoReference,
} from './shotReferences'
import { shotAutoScriptPrompt } from './promptRender'
import type { DialogueDelivery, PerformanceEntry, ShotData, VideoPromptOverride } from './types'
import { limitVideoReferenceImages, VIDEO_REFERENCE_IMAGE_LIMIT, videoRefLimitLabel } from './videoRefLimits'
import { secondsFloorReason, shotRequestSeconds, videoMaxSeconds, type SecondsFloor } from './videoSeconds'

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
  /** 超过客户端上限而被省略的图片（默认不限） */
  omitted: { label: string; reason: string }[]
  /** 首期只使用第一条视频素材，其余在这里说明 */
  omittedVideos: { label: string; reason: string }[]
  textSource: 'video_prompt' | 'prompt_fallback' | 'fallback' | 'script_assembled' | 'template_render'
  /** 实际提交给视频接口的秒数；界面与成本只看这个值 */
  seconds: number
  /** 镜头时长原值，用于展示「镜头 Xs → 请求 Ys」 */
  shotSeconds: number
  /** 请求秒数相对镜头时长的抬升原因；null 表示只有取整或范围夹取 */
  secondsFloor: SecondsFloor | null
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

export function purposeOfShotReference(ref: ResolvedShotReference): string {
  if (ref.source === 'expression') return '表情参考'
  if (ref.source === 'character') return '人物外观'
  if (ref.source === 'adjacent') return '相邻镜连贯'
  if (ref.source === 'extra') return '手工参考'
  if (ref.label.startsWith('场景')) return '场景外观'
  if (ref.label.startsWith('道具')) return '道具外观'
  return '参考外观'
}

/** 仅解析画布连线（角色/素材/相邻/手工）；镜上静帧预览不参与视频参考。 */
export function collectShotComposerRefs(input: {
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
    push({ url: ref.url, label: ref.label, kind: ref.source, purpose: purposeOfShotReference(ref) })
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

/** 参考图槽位注记：@图像N=标签，供模型对齐 reference_image 槽位 */
export function buildReferenceImagesPromptHint(
  refs: { label: string; purpose?: string }[],
  hasVideo: boolean,
): string {
  if (refs.length === 0) return ''
  const all = refs
    .map((r, i) => {
      const tag = `${hasVideo ? `@图像${i + 1}` : `[图${i + 1}]`}`
      const label = r.purpose === '表情参考' ? `${r.label}（表情参考）` : r.label
      return `${tag}=${label}`
    })
    .join('，')
  const tail = refs.some((r) => r.purpose === '表情参考')
    ? '主体外观、场景与道具必须与参考图一致；表情参考只对齐该角色的表情，不改变身份与服装。'
    : '主体外观、场景与道具必须与参考图一致。'
  return `参考图：${all}。${tail}`
}

/** 参考视频只继承运动关系；白模/几何体材质不得照搬 */
export function buildVideoReferencePromptHint(video: { label: string } | undefined): string {
  if (!video) return ''
  return `参考 @视频1（${video.label}）的机位运动、人物走位与相对位置；只参考这些运动关系，不要照搬视频里的白模、网格、视锥、几何体材质与文字标签。`
}

/** 出片正文的统一指令块：同一段文字只出现一次 */
export type ShotDirective = {
  key: 'move' | 'dialogue' | 'performance' | 'sound' | 'reference' | 'video' | 'constraints'
  text: string
}

const DIRECTIVE_PRESENT: Record<ShotDirective['key'], (base: string) => boolean> = {
  move: (b) => b.includes('【运镜】'),
  dialogue: (b) => b.includes('【台词】') || b.includes('声音：'),
  performance: (b) => b.includes('【表演方向】') || b.includes('【表演】'),
  sound: (b) => b.includes('声音：'),
  reference: (b) => b.includes('参考图：') || /@图像\d+/.test(b) || /\[图\d+\]/.test(b),
  video: (b) => b.includes('@视频1'),
  constraints: (b) => b.includes('无字幕'),
}

/**
 * 把方向性指令块追加到正文末尾；正文里已经有的块跳过。
 * 顺序固定为：运镜 → 台词 → 表演 → 声音 → 参考图 → 参考视频 → 约束。
 */
export function appendShotDirectives(base: string, directives: (ShotDirective | null | undefined)[]): string {
  const head = String(base || '').trim()
  const blocks = [head]
  for (const d of directives) {
    if (!d?.text?.trim()) continue
    if (DIRECTIVE_PRESENT[d.key](head)) continue
    if (blocks.some((b) => b.includes(d.text))) continue
    blocks.push(d.text.trim())
  }
  return blocks.filter(Boolean).join('\n\n')
}

/** 景别、运镜与镜头语言条目：让右侧「运镜与语义」的字面值一定进入正文 */
export function shotMoveDirective(
  data: Pick<ShotData, 'size' | 'move' | 'motionNote' | 'lexiconRefKey'>,
): ShotDirective | null {
  const bits: string[] = []
  if (data.size) bits.push(`景别：${data.size}`)
  if (data.move) bits.push(`运镜：${data.move}`)
  const ref = resolveShotLexiconRef(data)
  if (ref?.en) bits.push(`镜头语言：${ref.en}`)
  if (data.motionNote?.trim()) bits.push(data.motionNote.trim())
  return bits.length ? { key: 'move', text: `【运镜】\n${bits.join('；')}` } : null
}

/** 台词本体：只在没有声音段时补，避免和原生音频重复 */
export function shotDialogueDirective(
  dialogue: { speaker: string; text: string }[],
): ShotDirective | null {
  const lines = dialogue
    .filter((l) => String(l.text || '').trim())
    .map((l) => `${l.speaker ? `${l.speaker}：` : ''}“${String(l.text).trim()}”`)
  return lines.length ? { key: 'dialogue', text: `【台词】\n${lines.join('\n')}` } : null
}

/** 角色表演与台词表演：强度、动作、视线、说话标记、语速/音量/重音全部进正文 */
export function shotPerformanceDirective(
  data: Pick<ShotData, 'performance' | 'dialogueDelivery'>,
  dialogue: { speaker: string; text: string }[],
): ShotDirective | null {
  const body = performanceDirectionText(data.performance as PerformanceEntry[] | undefined, dialogue, data.dialogueDelivery as DialogueDelivery[] | undefined)
  return body ? { key: 'performance', text: `【表演方向】\n${body}` } : null
}

/** 原生音频：台词与音色参考说明 */
export function shotSoundDirective(
  character: string,
  dialogue: { speaker: string; text: string }[],
  hasReference: boolean,
): ShotDirective | null {
  if (!character) return null
  const text = nativeAudioPrompt(character, dialogue, hasReference)
  return text ? { key: 'sound', text } : null
}

export function shotReferenceDirectives(
  refs: { label: string; purpose?: string }[],
  video: { label: string } | null | undefined,
): ShotDirective[] {
  const out: ShotDirective[] = []
  const imageHint = buildReferenceImagesPromptHint(refs, Boolean(video))
  if (imageHint) out.push({ key: 'reference', text: imageHint })
  const videoHint = buildVideoReferencePromptHint(video ?? undefined)
  if (videoHint) out.push({ key: 'video', text: videoHint })
  return out
}

/** 全局约束：Seedance 出片固定带上的负向约束 */
export const SHOT_CONSTRAINTS_DIRECTIVE: ShotDirective = {
  key: 'constraints',
  text: '【约束】\n无字幕、无水印、无文字 UI；保持角色身份与服装连续，禁止身份漂移。',
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
      ...performanceFingerprintPayload(input.data.performance, input.data.dialogueDelivery),
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
  model?: VideoModelInput | null
  resolution?: string
}): ShotVideoRequest {
  const d = input.data
  const resolution = String(input.resolution || '')
  const dialogue = parseDialogue(d.dialogue)
  const nativeMode = d.audioMode === 'native'
  const audioCaps = audioRefCapabilitiesFor({
    providerKind: input.model?.providerKind,
    model: input.model?.model,
    audioOut: input.model?.audioOut,
  })
  /** 唯一时长来源：取整、模型下限与原生音频门槛都在这里解出，后续一律读 seconds */
  const shotSeconds = Number(d.seconds) || 0
  const { seconds, floor: secondsFloor } = shotRequestSeconds({
    seconds: shotSeconds,
    modelId: input.model?.model,
    nativeAudio: nativeMode,
    nativeAudioMinVideoSeconds: nativeMode ? audioCaps?.minVideoSeconds : undefined,
  })
  const nativeRef = nativeMode
    ? nativeAudioRef({
        dialogue,
        performance: d.performance,
        characters: input.characters,
        caps: audioCaps,
        seconds,
      })
    : null

  const { refs: candidates, missing, expressionNote } = collectShotComposerRefs({
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
  const cap = VIDEO_REFERENCE_IMAGE_LIMIT
  const { used: limited, omitted: omittedRaw } = limitVideoReferenceImages(candidates, cap)
  const omitted = omittedRaw.map((r) => ({
    label: r.label,
    reason:
      r.kind === 'expression'
        ? `表情参考因参考图已达上限（${videoRefLimitLabel(cap)}）省略`
        : `超过参考图上限（${videoRefLimitLabel(cap)}）`,
  }))

  const vpTrim = (d.videoPrompt || '').trim()
  const pTrim = (d.prompt || '').trim()
  const motionForFingerprint = vpTrim || pTrim
  const textSource: ShotVideoRequest['textSource'] = vpTrim
    ? 'video_prompt'
    : pTrim
      ? 'prompt_fallback'
      : 'script_assembled'
  const fallback = `${d.size}，${lexiconMoveLine(d)}，24fps，雨丝与光尘缓慢飘动，画面无过曝无噪点`
  /** 运镜文案只来自条目自身的 motion_note，不再从几何数据推导 */
  const liveMotionNote = d.motionNote || ''

  const mode: VideoRequestMode = nativeMode
    ? 'native'
    : primaryVideo
      ? 'video'
      : limited.length > 0
        ? 'ref'
        : 'first'

  const refs: VideoAttachment[] = limited.map((r, i) => ({
    slot: 'image',
    index: i + 1,
    url: r.url,
    label: r.label,
    purpose: r.purpose,
    source: r.kind,
  }))
  const firstFrame = null
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

  const fingerprint = fingerprintOf({
    data: d,
    candidates,
    refs: limited,
    mode,
    motion: motionForFingerprint || fallback,
    textSource,
    motionNote: liveMotionNote,
    seconds,
    dialogue,
    audio,
    videos,
  })

  const warnings: VideoRequestIssue[] = []
  if (secondsFloor) {
    warnings.push({
      code: 'seconds-raised',
      level: 'warn',
      message: `镜头 ${shotSeconds.toFixed(1)}s → 请求 ${seconds}s（${secondsFloorReason(secondsFloor)}）`,
    })
  }
  const modelMax = videoMaxSeconds(input.model?.model)
  if (seconds > modelMax) {
    warnings.push({
      code: 'seconds-over-model-max',
      level: 'warn',
      message: `当前模型上限 ${modelMax} 秒，请求 ${seconds}s 会被服务端拒绝`,
    })
  }
  const orphanAssets = (d.refIds ?? []).filter(
    (rid) => rid.startsWith('asset-') && !input.nodes.some((n) => n.id === rid),
  )
  if (orphanAssets.length) {
    warnings.push({
      code: 'ref-orphan-asset',
      level: 'warn',
      message: `有 ${orphanAssets.length} 条素材连线指向已删除的素材卡，已忽略；选中镜头后删参考连线或保存项目前清理 refIds`,
    })
  }
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
      message: '在画布上为分镜连线角色或图片素材，或勾选运镜库视频参考 / 连线视频素材后再出片',
    })
  }
  if (nativeMode && refs.length === 0) {
    blocking.push({
      code: 'native-no-image',
      level: 'error',
      message: '原生音频需要至少一张连线参考图（角色、素材或相邻镜）',
    })
  }

  /** 自动正文底座：语义层（运动/画面提示词）优先，双空才脚本拼装 */
  let basePrompt: string
  if (vpTrim) {
    basePrompt = vpTrim
  } else if (pTrim) {
    basePrompt = pTrim
  } else {
    basePrompt = shotAutoScriptPrompt({
      data: d,
      nodeId: input.nodeId,
      nodes: input.nodes,
      characters: input.characters,
      missingMedia: input.missingMedia,
      model: input.model,
      resolution: input.resolution,
      style: '',
      aspect: '16:9',
      request: {
        prompt: '',
        mode,
        refs,
        firstFrame,
        video,
        audio,
        omitted,
        omittedVideos,
        textSource: 'script_assembled',
        seconds,
        shotSeconds,
        secondsFloor,
        resolution,
        warnings,
        blocking,
        fingerprint,
      },
    }).trim()
    if (!basePrompt) basePrompt = fallback
  }

  /**
   * 右侧能编辑、但以前不进正文的字段统一在这里补进正文：
   * 景别/运镜、台词、表演（强度/动作/视线/说话）、台词表演、原生音频、参考图槽位、约束。
   * 手改正文不经过这里，仍然逐字发送。
   */
  const dialogueLines = dialogue
  const prompt = appendShotDirectives(basePrompt, [
    shotMoveDirective(d),
    nativeMode ? null : shotDialogueDirective(dialogueLines),
    shotPerformanceDirective(d, dialogueLines),
    nativeMode && nativeRef?.ok ? shotSoundDirective(nativeRef.character, dialogueLines, true) : null,
    ...shotReferenceDirectives(refs, primaryVideo),
    SHOT_CONSTRAINTS_DIRECTIVE,
  ])

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
    shotSeconds,
    secondsFloor,
    resolution,
    warnings,
    blocking,
    fingerprint,
  }
}

export type EffectiveVideoPrompt = {
  text: string
  source: 'auto' | 'override'
  autoKind?: 'semantic' | 'script' | 'template'
  stale: boolean
}

/** 手改快照优先；过期只提示，不阻止出片。 */
export function effectiveVideoPrompt(
  request: Pick<ShotVideoRequest, 'prompt' | 'fingerprint' | 'textSource'>,
  override?: VideoPromptOverride | null,
): EffectiveVideoPrompt {
  if (override?.text) {
    return {
      text: override.text,
      source: 'override',
      stale: Boolean(override.fingerprint && override.fingerprint !== request.fingerprint),
    }
  }
  return {
    text: request.prompt,
    source: 'auto',
    autoKind: request.textSource === 'script_assembled' ? 'script' : 'semantic',
    stale: false,
  }
}

/** 出片前参考省略说明，分镜与转场生成共用 */
export function videoOmitToastMessages(request: {
  omitted: { label: string }[]
  omittedVideos: { label: string }[]
}): string[] {
  return [
    request.omitted.length
      ? `部分参考图未送出，已省略：${request.omitted.map((r) => r.label).join('、')}`
      : '',
    request.omittedVideos.length
      ? `首期只使用第一条视频素材，已忽略：${request.omittedVideos.map((r) => r.label).join('、')}`
      : '',
  ].filter(Boolean)
}
