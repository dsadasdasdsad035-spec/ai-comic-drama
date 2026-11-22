import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import {
  audioRefCapabilitiesFor,
  nativeAudioRef,
} from './nativeAudio'
import { parseDialogue } from './prompts'
import { performanceFingerprintPayload } from './performance'
import { shortHash } from './hash'
import {
  collectShotReferences,
  collectVideoReferences,
  SHOT_NEXT,
  SHOT_PREV,
  type ResolvedShotReference,
  type ResolvedVideoReference,
} from './shotReferences'
import type { ShotData, VideoPromptOverride } from './types'
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
  /**
   * 参考 token（`char-*` / `asset-*` / `extra:*`）。
   * 面板据此标出「本轮由 Agent 写入」的条目；不参与出片请求。
   */
  token?: string
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
  textSource: 'video_prompt'
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
  /** 模型可读名；出片预览与请求记录用 */
  label?: string
  model?: string
  providerKind?: string
  audioOut?: boolean
  supportsVideoRef?: boolean
  /**
   * 能力细节。转场出片预览要据此判断尾帧、纯文本与音频输出，
   * 缺这段会让 Agent 读到的提交模式与实际出片不一致。
   */
  features?: {
    lastFrame?: boolean
    textToVideo?: boolean
    audioOut?: boolean
  }
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
  /** 先按原生音频门槛算一次：音色参考解析要用到它（原生下限含边界，4 秒合法） */
  const nativeSeconds = nativeMode
    ? shotRequestSeconds({
        seconds: shotSeconds,
        modelId: input.model?.model,
        nativeAudio: true,
        nativeAudioMinVideoSeconds: audioCaps?.minVideoSeconds,
      })
    : null
  const nativeRef = nativeMode
    ? nativeAudioRef({
        dialogue,
        performance: d.performance,
        characters: input.characters,
        caps: audioCaps,
        seconds: nativeSeconds?.seconds ?? shotSeconds,
        // 无声镜没有说话人可推断，沿用镜上已保存的音色角色
        preferredCharacter: d.audioRef?.character,
      })
    : null
  /** 只在「模型没有原生音频能力」或「音色样本不合规」时降级；无样本仍走 native */
  const nativeBlocked = Boolean(nativeRef && !nativeRef.ok)
  /**
   * 被拦下时按**普通出片**重算时长：原生音频的门槛只在真的要带音轨时才成立，
   * 降级后还按 4 秒请求等于白等一段没有声音的时长。无参考**不算**降级——
   * 它照常发 `generate_audio`，所以时长仍按原生门槛算。
   */
  const { seconds, floor: secondsFloor } = nativeBlocked
    ? shotRequestSeconds({ seconds: shotSeconds, modelId: input.model?.model })
    : nativeMode
      ? (nativeSeconds ?? shotRequestSeconds({ seconds: shotSeconds, modelId: input.model?.model }))
      : shotRequestSeconds({ seconds: shotSeconds, modelId: input.model?.model })

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

  /** 正文只由人/Agent 写入：逐字取该镜 video_prompt，运行时不再拼装任何段落 */
  const vpTrim = (d.videoPrompt || '').trim()
  const textSource: ShotVideoRequest['textSource'] = 'video_prompt'
  /** 运镜文案只来自条目自身的 motion_note，不再从几何数据推导 */
  const liveMotionNote = d.motionNote || ''

  /**
   * 音色参考是**可选增强**，不是原生音轨的前置条件。
   *
   * - 有可用样本 → 带上 `audio_url`（`audio` 附件），音色跨镜一致。
   * - 没有样本（`no-reference`）→ 照常 native，只发 `generate_audio`，声音由
   *   模型决定。2026-11-22 实测这条组合能出片且会念出台词
   *   （`task_01M81KX9X0DN2JBVXS9KCGY1` 同类任务），不是非法请求。
   * - `blocked`（模型没能力 / 样本不合规）→ 才降级成普通静音出片并在 warnings
   *   里说明原因，避免让用户以为拿到的是带音轨的成片。
   */
  const nativeDegraded = Boolean(nativeMode && nativeBlocked)
  const nativeNoReference =
    nativeMode && nativeRef?.ok === true && nativeRef.kind === 'no-reference' ? nativeRef : null
  const audio: VideoAttachment | null =
    nativeMode && nativeRef?.ok === true && nativeRef.kind === 'reference'
      ? {
          slot: 'audio',
          index: 1,
          url: nativeRef.url,
          label: `${nativeRef.character} 音色`,
          purpose: '音色',
          character: nativeRef.character,
        }
      : null

  const mode: VideoRequestMode = nativeMode && !nativeDegraded
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

  const fingerprint = fingerprintOf({
    data: d,
    candidates,
    refs: limited,
    mode,
    motion: vpTrim,
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
  // 无参考不是问题：它照样带原生音轨出片，只在提示里说清声音由模型决定
  if (nativeNoReference) {
    warnings.push({
      code: 'native-no-reference',
      level: 'warn',
      message: `无音色参考，声音由模型决定：${nativeNoReference.reason}`,
    })
  }
  // 模型没有原生音频能力 / 样本不合规才降级，这时明确说本次没有原生音轨
  if (nativeDegraded && nativeRef && !nativeRef.ok) {
    warnings.push({
      code: 'native-degraded',
      level: 'warn',
      message: `本次不带原生音轨出片：${nativeRef.reason}`,
    })
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
  // 降级出片按普通路径处理，不再要求「原生音频专用」的连线参考图
  if (nativeMode && !nativeDegraded && refs.length === 0) {
    blocking.push({
      code: 'native-no-image',
      level: 'error',
      message: '原生音频需要至少一张连线参考图（角色、素材或相邻镜）',
    })
  }

  // 正文只来自人/Agent：video_prompt 为空即阻断，不用脚本拼装或硬编码文案顶替
  if (!vpTrim) {
    blocking.push({
      code: 'shot-prompt-empty',
      level: 'error',
      message: '正文未填写：请在「本次出片提示词」的正文区写一段出片描述后再出片',
    })
  }
  const prompt = vpTrim

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
  source: 'video_prompt' | 'legacy-override'
  stale: boolean
}

/**
 * 正文只有一个来源：镜头自己的 `video_prompt`。
 * 升级前保存的 `video_prompt_override` 仍按「只读优先」生效，保证存量镜头出片
 * 内容逐字不变；新保存的正文一律写回 `video_prompt`，不再产生快照。
 * 单一正文模型下不存在可比较的基线，`stale` 恒为 false，保留字段只为不改消费者形状。
 */
export function effectiveVideoPrompt(
  request: Pick<ShotVideoRequest, 'prompt' | 'fingerprint' | 'textSource'>,
  override?: VideoPromptOverride | null,
): EffectiveVideoPrompt {
  if (override?.text) {
    return { text: override.text, source: 'legacy-override', stale: false }
  }
  return { text: request.prompt, source: 'video_prompt', stale: false }
}

/** 该镜正文是否由人工编辑过（`handEdited` 含 video_prompt）。 */
export function isVideoPromptHandEdited(data: ShotData): boolean {
  return (data.handEdited ?? []).includes('video_prompt')
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
