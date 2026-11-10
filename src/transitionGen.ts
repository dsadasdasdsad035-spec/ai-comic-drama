import { extractFrames, type ModelEntry } from './api'
import { parseDialogue } from './prompts'
import {
  audioRefCapabilitiesFor,
  nativeAudioGateSeconds,
  nativeAudioPrompt,
  nativeAudioRef,
} from './nativeAudio'
import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import type { ShotData, TransitionBoundary, TransitionBridging, TransitionGenerated } from './types'
import { assetMediaType } from './mediaPick'
import {
  collectShotReferences,
  collectVideoReferences,
  SHOT_NEXT,
  SHOT_PREV,
  type MissingShotReference,
  type ResolvedShotReference,
  type ResolvedVideoReference,
} from './shotReferences'
import {
  type VideoAttachment,
  type VideoRequestIssue,
  buildReferenceImagesPromptHint,
  buildVideoReferencePromptHint,
  purposeOfShotReference,
} from './videoPrompt'
import { limitVideoReferenceImages, VIDEO_REFERENCE_IMAGE_LIMIT } from './videoRefLimits'
import { shortHash } from './scheduleGeometry'
import { localPath } from './shotSync'
import { coerceTransitionVideoPromptOverride, boundarySourceLabel, normalizeGenerated, transitionOverrideText } from './transition'

/** 画布派生「转场参考」边 id：ref-tr|{转场边 id}|{素材/角色节点 id} */
export const transitionRefEdgeId = (edgeId: string, refSourceId: string) =>
  `ref-tr|${edgeId}|${refSourceId}`

export const parseTransitionRefEdgeId = (
  id: string,
): { edgeId: string; refSourceId: string } | null => {
  if (!id.startsWith('ref-tr|')) return null
  const parts = id.split('|')
  if (parts.length !== 3) return null
  const edgeId = parts[1]
  const refSourceId = parts[2]
  if (!edgeId || !refSourceId) return null
  return { edgeId, refSourceId }
}

export type TransitionRef = {
  token: string
  label: string
  url: string
  source: 'character' | 'asset' | 'extra'
}

const frameCache = new Map<string, { start?: string; end?: string }>()

/** 尾帧用负时间表示距片尾秒数（/api/frames → ffmpeg -sseof），避免按 duration seek 落空。 */
const TAIL_FRAME_SSEOF_SEC = -0.1

/** 视频首帧/尾帧；同一 URL 只抽一次；只缓存首尾都成功的结果，避免尾帧失败后永久回退静帧。 */
async function videoFrames(url: string): Promise<{ start?: string; end?: string }> {
  const hit = frameCache.get(url)
  if (hit?.start && hit?.end) return hit
  try {
    const first = await extractFrames(url, 2, undefined, [0])
    let end: string | undefined
    try {
      const last = await extractFrames(url, 2, undefined, [TAIL_FRAME_SSEOF_SEC])
      end = last.urls[0]
    } catch {
      end = undefined
    }
    const out = { start: first.urls[0], end }
    if (out.start && out.end) frameCache.set(url, out)
    return out
  } catch {
    return {}
  }
}

/**
 * 边界帧只从成片抽取：上一镜成片尾帧、下一镜成片首帧。
 * 没有成片或抽帧失败都留空并给 warning；不回退静帧。
 */
export async function ensureTransitionBoundary(
  source: ShotNodeType,
  target: ShotNodeType,
): Promise<{ boundary: TransitionBoundary; warnings: string[] }> {
  const warnings: string[] = []
  let out: string | undefined
  let inn: string | undefined

  if (source.data.videoUrl) {
    const f = await videoFrames(String(source.data.videoUrl))
    if (f.end) out = f.end
    else warnings.push('上镜成片尾帧抽取失败，请重新抽取或检查成片')
  } else {
    warnings.push('上镜还没有成片，无法抽取首帧')
  }

  if (target.data.videoUrl) {
    const f = await videoFrames(String(target.data.videoUrl))
    if (f.start) inn = f.start
    else warnings.push('下镜成片首帧抽取失败，请重新抽取或检查成片')
  } else {
    warnings.push('下镜还没有成片，无法抽取尾帧')
  }

  return { boundary: { ...(out ? { out } : {}), ...(inn ? { in: inn } : {}) }, warnings }
}

const isRefSource = (s: string) => s === 'character' || s === 'asset' || s === 'extra'

/** 占位角色节点不可作转场 dedicated 参考 */
export const isTransitionDedicatedRefToken = (token: string) => !token.startsWith('char-miss')

/**
 * 转场关键帧的参考清单：
 * 结构参考（尾帧/首帧）由调用方放最前；这里只按「两镜继承 → 显式补充」给出人/景/道具参考。
 */
/** 转场手动补充参考候选：角色表 + 画布素材 + 两镜手工 URL（不自动选中，仅解析 refIds） */
export function transitionRefCandidates(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  _missingMedia: Set<string>,
): TransitionRef[] {
  const out = new Map<string, TransitionRef>()
  for (const node of [source, target]) {
    for (const url of node.data.refExtras ?? []) {
      if (!url || out.has(url)) continue
      out.set(url, { token: `extra:${url}`, label: '手工参考图', url, source: 'extra' })
    }
  }
  for (const c of characters) {
    if (!c.image) continue
    const token = `char-${c.id}`
    if (out.has(c.image)) continue
    if ([...out.values()].some((r) => r.token === token)) continue
    out.set(c.image, { token, label: `角色「${c.name}」外观`, url: c.image, source: 'character' })
  }
  for (const n of nodes) {
    const type = (n as unknown as { type?: string }).type
    if (type !== 'asset') continue
    const d = n.data as unknown as { kind?: string; title?: string; url?: string }
    if (!d.url) continue
    if (assetMediaType((d.kind || 'image') as never, d.url) !== 'image') continue
    if (out.has(d.url)) continue
    const tag = { scene: '场景', prop: '道具', image: '图片' }[d.kind as string] ?? '参考'
    out.set(d.url, { token: n.id, label: `${tag}「${d.title || '未命名'}」`, url: d.url, source: 'asset' })
  }
  return [...out.values()]
}

/** 实际参与关键帧的参考：默认继承两镜的参考，可排除；再加显式补充 */
export function effectiveTransitionRefs(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
  generated: TransitionGenerated | undefined,
): TransitionRef[] {
  const g = normalizeGenerated(generated)
  const candidates = transitionRefCandidates(source, target, nodes, characters, missingMedia)
  const byToken = new Map(candidates.map((r) => [r.token, r]))
  const inherited = collectInherited(source, target, nodes, characters, missingMedia)
  const excluded = new Set(g.excludeRefIds ?? [])
  const chosen: TransitionRef[] = []
  const seen = new Set<string>()

  if (g.inheritRefs) {
    for (const r of inherited) {
      if (excluded.has(r.token)) continue
      if (seen.has(r.url)) continue
      seen.add(r.url)
      chosen.push(r)
    }
  }
  for (const token of g.refIds ?? []) {
    if (!isTransitionDedicatedRefToken(token)) continue
    const hit = byToken.get(token)
    if (!hit || seen.has(hit.url)) continue
    seen.add(hit.url)
    chosen.push(hit)
  }
  return chosen
}

function collectInherited(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
): TransitionRef[] {
  const out: TransitionRef[] = []
  const seen = new Set<string>()
  for (const node of [source, target]) {
    const collected = collectShotReferences({ node, nodes, characters, missingMedia })
    for (const r of collected.refs) {
      if (r.source !== 'asset' && r.source !== 'extra') continue
      if (seen.has(r.url)) continue
      seen.add(r.url)
      out.push({
        token: r.token,
        label: r.label,
        url: r.url,
        source: r.source === 'asset' ? 'asset' : 'extra',
      })
    }
  }
  return out
}

/** 本次提交的输入模式；按优先级命中即停 */
export type TransitionInputMode =
  | 'boundary'
  | 'first-frame'
  | 'reference'
  | 'video-reference'
  | 'text'
  | 'none'

/**
 * 输入模式降级链：首尾帧 → 单首帧 → 参考图 → 参考视频 → 纯文本。
 * 纯文本只在模型声明 textToVideo 时成立，否则视为 none。
 */
export function resolveTransitionInputMode(input: {
  boundary?: TransitionBoundary
  refCount: number
  hasVideoRef: boolean
  features?: { textToVideo?: boolean }
}): TransitionInputMode {
  const out = Boolean(input.boundary?.out)
  const inn = Boolean(input.boundary?.in)
  if (out && inn) return 'boundary'
  if (out) return 'first-frame'
  if (input.refCount > 0) return 'reference'
  if (input.hasVideoRef) return 'video-reference'
  if (input.features?.textToVideo) return 'text'
  return 'none'
}

/** 该模式是否真的提交尾帧（决定裁剪与参考图互斥） */
export const inputModeSubmitsLastFrame = (mode: TransitionInputMode): boolean => mode === 'boundary'

/** 首尾直变 + 尾帧：reference_image 与尾帧互斥；按本次是否真的送尾帧判断 */
export function transitionRefSubmitAllowed(submitsLastFrame: boolean): boolean {
  return !submitsLastFrame
}

/** 转场若开启 inherit（已废弃，normalize 恒 false）：只继承素材/手工 URL，不用 cast 与表情 */
function composeShotRefsForVideoMerge(
  node: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
): {
  refs: ResolvedShotReference[]
  missing: MissingShotReference[]
  expressionWarnings: string[]
} {
  const collected = collectShotReferences({ node, nodes, characters, missingMedia })
  const refs: ResolvedShotReference[] = []
  const seen = new Set<string>()
  const push = (ref: ResolvedShotReference) => {
    if (!ref.url || seen.has(ref.url)) return
    seen.add(ref.url)
    refs.push(ref)
  }
  for (const ref of collected.refs) {
    if (ref.source === 'asset' || ref.source === 'extra') push(ref)
  }
  return { refs: refs, missing: collected.missing, expressionWarnings: [] }
}

export function mergedTransitionShotReferences(input: {
  source: ShotNodeType
  target: ShotNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
  generated: TransitionGenerated | undefined
}): {
  used: ResolvedShotReference[]
  omitted: ResolvedShotReference[]
  missing: MissingShotReference[]
  warnings: string[]
  videos: ResolvedVideoReference[]
  omittedVideos: { label: string; reason: string }[]
  supplementalTokens: string[]
} {
  const g = normalizeGenerated(input.generated)
  const excluded = new Set(g.excludeRefIds ?? [])
  const merged: ResolvedShotReference[] = []
  const missing: MissingShotReference[] = []
  const warnings: string[] = []
  const urlSeen = new Set<string>()

  const pushMerged = (ref: ResolvedShotReference) => {
    if (excluded.has(ref.token)) return
    if (!ref.url || urlSeen.has(ref.url)) return
    urlSeen.add(ref.url)
    merged.push(ref)
  }

  if (g.inheritRefs === true) {
    for (const node of [input.source, input.target]) {
      const pack = composeShotRefsForVideoMerge(
        node,
        input.nodes,
        input.characters,
        input.missingMedia,
      )
      warnings.push(...pack.expressionWarnings)
      missing.push(...pack.missing)
      for (const ref of pack.refs) pushMerged(ref)
    }
  }

  const candidates = transitionRefCandidates(
    input.source,
    input.target,
    input.nodes,
    input.characters,
    input.missingMedia,
  )
  const byToken = new Map(candidates.map((r) => [r.token, r]))
  const supplementalTokens: string[] = []
  for (const token of g.refIds ?? []) {
    if (!isTransitionDedicatedRefToken(token)) continue
    const hit = byToken.get(token)
    if (!hit) continue
    supplementalTokens.push(token)
    pushMerged({
      token: hit.token,
      source: hit.source === 'character' ? 'character' : hit.source === 'asset' ? 'asset' : 'extra',
      url: hit.url,
      label: hit.label,
    })
  }

  const { used, omitted } = limitVideoReferenceImages(merged, VIDEO_REFERENCE_IMAGE_LIMIT)

  const videoMerged: ResolvedVideoReference[] = []
  const videoSeen = new Set<string>()
  for (const node of [input.source, input.target]) {
    const vc = collectVideoReferences({
      node,
      nodes: input.nodes,
      missingMedia: input.missingMedia,
    })
    missing.push(...vc.missing)
    for (const v of vc.refs) {
      if (videoSeen.has(v.url)) continue
      videoSeen.add(v.url)
      videoMerged.push(v)
    }
  }
  const videos = videoMerged.slice(0, 1)
  const omittedVideos = videoMerged.slice(1).map((r) => ({
    label: r.label,
    reason: '首期只使用第一条视频素材',
  }))

  const neighborMissing = missing.filter((m) => m.token === SHOT_PREV || m.token === SHOT_NEXT)
  for (const m of neighborMissing) {
    warnings.push(`${m.label}：${m.reason}`)
  }

  return { used, omitted, missing, warnings, videos, omittedVideos, supplementalTokens }
}

export function transitionStyleRefTokens(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
  generated: TransitionGenerated | undefined,
): string[] {
  return mergedTransitionShotReferences({
    source,
    target,
    nodes,
    characters,
    missingMedia,
    generated,
  }).used
    .map((r) => r.token)
    .sort()
}

export function inheritedTransitionRefs(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
): TransitionRef[] {
  return collectInherited(source, target, nodes, characters, missingMedia)
}

const cutPromptSnippet = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s)

const CAMERA_HEIGHT: Record<'low' | 'eye' | 'high', string> = {
  low: '低机位',
  eye: '眼平',
  high: '高机位',
}

/** 景别：visualBrief.shotSize 优先于镜头 size */
function shotSizeForTransition(data: ShotData): string {
  const brief = String(data.visualBrief?.shotSize || '').trim()
  if (brief) return brief
  return String(data.size || '').trim()
}

function cameraHintLine(data: ShotData): string {
  const h = data.visualBrief?.cameraHint
  if (!h) return ''
  const parts: string[] = []
  if (h.height && CAMERA_HEIGHT[h.height]) parts.push(CAMERA_HEIGHT[h.height])
  const ang = String(h.angle || '').trim()
  if (ang) parts.push(ang)
  return parts.join('、')
}

/** 由两镜已有字段拼衔接约束；缺字段则省略对应句 */
export function transitionContinuityBlock(source: ShotNodeType, target: ShotNodeType): string {
  const lines: string[] = []
  const aSize = shotSizeForTransition(source.data)
  const bSize = shotSizeForTransition(target.data)
  if (aSize || bSize) {
    const parts = [
      aSize ? `上一镜 ${aSize}` : '',
      bSize ? `下一镜 ${bSize}` : '',
    ].filter(Boolean)
    lines.push(`景别：${parts.join('，')}；过渡时景别变化需自然，避免无理由跳切。`)
  }
  const aMove = String(source.data.move || '').trim()
  const bMove = String(target.data.move || '').trim()
  if (aMove || bMove) {
    const parts = [
      aMove ? `上一镜「${aMove}」` : '',
      bMove ? `下一镜「${bMove}」` : '',
    ].filter(Boolean)
    lines.push(`运镜：${parts.join('，')}；机位与运动方向需连贯。`)
  }
  const aCam = cameraHintLine(source.data)
  const bCam = cameraHintLine(target.data)
  if (aCam || bCam) {
    const parts = [aCam ? `上一镜 ${aCam}` : '', bCam ? `下一镜 ${bCam}` : ''].filter(Boolean)
    lines.push(`机位：${parts.join('；')}。`)
  }
  const aAct = cutPromptSnippet(String(source.data.videoPrompt || source.data.prompt || '').trim())
  const bAct = cutPromptSnippet(String(target.data.videoPrompt || target.data.prompt || '').trim())
  if (aAct || bAct) {
    const lead = [
      aAct ? `上一镜结束于「${aAct}」` : '',
      bAct ? `下一镜起始于「${bAct}」` : '',
    ].filter(Boolean)
    lines.push(`动作衔接：${lead.join('，')}；动作与视线连续。`)
  }
  if (!lines.length) return ''
  return `\n\n衔接：\n${lines.join('\n')}`
}

export function defaultTransitionPrompt(source: ShotNodeType, target: ShotNodeType): string {
  const a = String(source.data.videoPrompt || source.data.prompt || '').trim()
  const b = String(target.data.videoPrompt || target.data.prompt || '').trim()
  const cut = cutPromptSnippet
  if (!a && !b) return '两个镜头之间的过渡瞬间：保持同一空间、同一人物与同一光线，画面自然衔接。'
  return (
    '两个镜头之间的过渡瞬间，保持人物外观、服装、场景与光线一致。' +
    (a ? `上一镜：${cut(a)}。` : '') +
    (b ? `下一镜：${cut(b)}。` : '')
  )
}

export function transitionSoundBlock(soundPrompt: string | undefined, nativeAudio?: boolean): string {
  const t = String(soundPrompt || '').trim()
  if (!t) return ''
  const foot = nativeAudio
    ? '（环境声可写在上述描述；对白音色由 Seedance 原生音频参考。）'
    : '（未开启原生声音时环境声仅靠上述描述，成片旁白请用「效果」叠化保留。）'
  return `\n\n声音：\n${t}\n${foot}`
}

/** 合并相邻两镜台词，供转场原生音频解析说话人 */
export function transitionDialogueText(source: ShotNodeType, target: ShotNodeType): string {
  return [source.data.dialogue, target.data.dialogue]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n')
}

export function autoTransitionVideoPrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
): string {
  const g = normalizeGenerated(generated)
  const base = g.prompt.trim() || defaultTransitionPrompt(source, target)
  const tail =
    g.bridging === 'morph'
      ? '这是两个镜头之间的过渡片段：画面从上一镜结束瞬间变形到下一镜开始瞬间。' +
        '允许环境明显变化（天气、光线、降水、雾气等），但角色外观、服装与空间逻辑需连贯；运动连续自然，不出现字幕、文字与水印。'
      : '这是两个镜头之间的过渡片段：从上镜的落点自然过渡到下镜的起点，人物外观、服装、场景与光线保持一致，运动连续，不出现字幕、文字与水印。'
  const continuity = transitionContinuityBlock(source, target)
  return `${base}${continuity}\n\n${tail}${transitionSoundBlock(g.soundPrompt, g.audioMode === 'native')}`
}

/** @deprecated 用 autoTransitionVideoPrompt / effectiveTransitionVideoPrompt */
export function transitionVideoPrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
): string {
  return autoTransitionVideoPrompt(source, target, generated)
}

export function transitionVideoPromptFingerprint(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
  styleRefTokens: string[],
): string {
  const g = normalizeGenerated(generated)
  return shortHash(
    JSON.stringify({
      boundaryOut: localPath(g.boundary?.out) ?? '',
      boundaryIn: localPath(g.boundary?.in) ?? '',
      prompt: g.prompt,
      sound: g.soundPrompt ?? '',
      bridging: g.bridging ?? 'morph',
      inheritRefs: g.inheritRefs === true,
      excludeRefIds: [...(g.excludeRefIds ?? [])].sort(),
      refIds: [...(g.refIds ?? [])].sort(),
      styleRefTokens: [...styleRefTokens].sort(),
      outMove: String(source.data.move || '').trim(),
      inMove: String(target.data.move || '').trim(),
      outDialogue: String(source.data.dialogue || '').trim(),
      inDialogue: String(target.data.dialogue || '').trim(),
      audioMode: g.audioMode ?? 'off',
      audioRef: localPath(g.audioRef?.url) ?? '',
    }),
  )
}

export type EffectiveTransitionVideoPrompt = {
  text: string
  source: 'auto' | 'override'
  stale: boolean
}

export function effectiveTransitionVideoPrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
  styleRefTokens: string[] = [],
): EffectiveTransitionVideoPrompt {
  const g = normalizeGenerated(generated)
  const auto = autoTransitionVideoPrompt(source, target, g)
  const fp = transitionVideoPromptFingerprint(source, target, g, styleRefTokens)
  const override = coerceTransitionVideoPromptOverride(g.videoPromptOverride)
  if (!override?.text) return { text: auto, source: 'auto', stale: false }
  return {
    text: override.text,
    source: 'override',
    stale: Boolean(override.fingerprint && override.fingerprint !== fp),
  }
}

export type TransitionAttachmentRole = 'first_frame' | 'last_frame' | 'keyframe'

export type TransitionVideoPreviewAttachment = {
  role: TransitionAttachmentRole
  label: string
  url?: string
  purpose: string
}

/** 首尾直变 + 尾帧模型：风格参考图不进 API（与 Seedance 2.5 上游互斥） */
export const OMIT_REASON_MORPH_REF_MUTEX = 'morph-last-frame-ref-mutex'

/** 任意转场对象请求下服务端暂不附带 reference_image */
export const OMIT_REASON_TRANSITION_NO_REFS = 'transition-mode-no-style-refs'

export const OMIT_REASON_LABELS: Record<string, string> = {
  [OMIT_REASON_MORPH_REF_MUTEX]:
    '首尾直变占用首尾帧槽位，当前模型不支持同时提交风格参考图',
  [OMIT_REASON_TRANSITION_NO_REFS]: '转场出片走首尾帧通道，风格参考图本次不提交',
  ref_limit: '超过参考图上限，未提交',
}

const transitionBlock = (code: string, message: string): VideoRequestIssue => ({
  code,
  message,
  level: 'error',
})

const transitionWarn = (code: string, message: string): VideoRequestIssue => ({
  code,
  message,
  level: 'warn',
})

/** 首尾帧 / 关键帧在正文中的槽位说明（与分镜参考图 hint 同构） */
function buildTransitionStructurePromptHint(attachments: TransitionVideoPreviewAttachment[]): string {
  const parts: string[] = []
  for (const a of attachments) {
    if (!a.url) continue
    const slot = a.role === 'first_frame' ? '首帧' : a.role === 'last_frame' ? '尾帧' : '关键帧'
    parts.push(`[${slot}]=${a.label}`)
  }
  if (!parts.length) return ''
  return `\n\n结构锚点：${parts.join('，')}。过渡片段须与首尾画面对齐。`
}

/** 自动拼装正文追加参考描述；手改正文不篡改（与分镜 effectiveVideoPrompt 一致） */
function finalizeTransitionPromptText(
  base: string,
  source: 'auto' | 'override',
  attachments: TransitionVideoPreviewAttachment[],
  refs: VideoAttachment[],
  video: VideoAttachment | null,
): string {
  if (source === 'override') return base
  return (
    base +
    buildTransitionStructurePromptHint(attachments) +
    buildReferenceImagesPromptHint(refs, Boolean(video)) +
    buildVideoReferencePromptHint(video ?? undefined)
  )
}

export type TransitionPromptPanelRefPrefix = {
  key: string
  bold: string
  label: string
  purpose: string
}

/** 转场「本次出片提示词」面板摘要与 vp-refs 前缀（结构首尾帧） */
/** 输入模式的中文标签，用于面板摘要 */
export const INPUT_MODE_LABEL: Record<TransitionInputMode, string> = {
  boundary: '首尾帧',
  'first-frame': '仅首帧',
  reference: '参考图',
  'video-reference': '参考视频',
  text: '纯文本',
  none: '无输入',
}

export function transitionPreviewToPromptPanelModel(
  preview: TransitionVideoPreview,
  vidRes: string,
): {
  summaryLine: string
  textSourceLabel: string
  refPrefix: TransitionPromptPanelRefPrefix[]
} {
  const modeLabel = INPUT_MODE_LABEL[preview.inputMode]
  const res = vidRes ? ` · ${vidRes}` : ''
  const trim = preview.trimTo ? ` · 裁到 ${preview.trimTo.toFixed(1)}s` : ''
  const summaryLine = `${modeLabel} · ${preview.seconds}s（请求 ${preview.requestSeconds}s${trim}）${res} · 正文来自${
    preview.promptSource === 'override' ? '手改正文' : '画面与过渡/声音描述'
  } · 表情参考无 · 无表演 · 无音色参考`
  const textSourceLabel = preview.promptSource === 'override' ? '手改正文' : '画面与过渡/声音描述'
  const refPrefix: TransitionPromptPanelRefPrefix[] = preview.attachments.map((a) => ({
    key: `${a.role}-${a.label}`,
    bold: a.role === 'first_frame' ? '首帧' : a.role === 'last_frame' ? '尾帧' : '关键帧',
    label: a.label,
    purpose: a.purpose,
  }))
  return { summaryLine, textSourceLabel, refPrefix }
}

export type TransitionStyleRefLine = {
  token: string
  label: string
  url: string
  kind: 'inherited' | 'added'
  submitted: boolean
  omittedReason?: string
}

export type TransitionStyleOmitted = {
  token: string
  label: string
  reason: string
}

export type TransitionVideoPreview = {
  bridging: TransitionBridging
  /** 本次提交的输入模式（首尾帧 → 单首帧 → 参考图 → 参考视频 → 纯文本） */
  inputMode: TransitionInputMode
  /** 本次是否真的提交尾帧；决定裁剪与参考图互斥 */
  submitsLastFrame: boolean
  seconds: number
  requestSeconds: number
  trimTo?: number
  supportsLastFrame: boolean
  modelLabel?: string
  attachments: TransitionVideoPreviewAttachment[]
  /** 与分镜 VideoPromptPanel 同构的参考图槽位 */
  refs: VideoAttachment[]
  video: VideoAttachment | null
  omitted: { label: string; reason: string }[]
  omittedVideos: { label: string; reason: string }[]
  styleRefs: TransitionStyleRefLine[]
  styleOmitted: TransitionStyleOmitted[]
  submittedStyleCount: number
  audio: {
    mode: 'none' | 'native'
    label: string
    detail: string
    url?: string
    character?: string
  }
  visualPrompt: string
  soundPrompt: string
  continuityPreview: string
  prompt: string
  promptSource: 'auto' | 'override'
  promptStale: boolean
  promptFingerprint: string
  blocking: VideoRequestIssue[]
  warnings: VideoRequestIssue[]
}

export type TransitionVideoRequest = TransitionVideoPreview & {
  /** 与 /api/seedance 一致的 reference_image 列表 */
  refImages: string[]
  refVideos: string[]
  styleRefOmitReason: string | undefined
}

export function styleRefOmitReason(submitsLastFrame: boolean): string {
  if (submitsLastFrame) return OMIT_REASON_MORPH_REF_MUTEX
  return OMIT_REASON_TRANSITION_NO_REFS
}

export function buildTransitionVideoRequest(input: {
  source: ShotNodeType
  target: ShotNodeType
  generated: TransitionGenerated | undefined
  model?: {
    label?: string
    model?: string
    providerKind?: string
    features?: { lastFrame?: boolean; textToVideo?: boolean; audioOut?: boolean }
  } | null
  nodes?: ShotNodeType[]
  characters?: CharacterSheet[]
  missingMedia?: Set<string>
}): TransitionVideoRequest {
  const preview = buildTransitionVideoPreview(input)
  const submitStyle = transitionRefSubmitAllowed(preview.submitsLastFrame)
  const omitCode = styleRefOmitReason(preview.submitsLastFrame)
  const refImages = submitStyle ? preview.refs.map((r) => r.url) : []
  const refVideos = submitStyle && preview.video ? [preview.video.url] : []
  return {
    ...preview,
    refImages,
    refVideos,
    styleRefOmitReason:
      !submitStyle && (preview.refs.length > 0 || preview.styleRefs.length > 0) ? omitCode : undefined,
  }
}

export function buildTransitionVideoPreview(input: {
  source: ShotNodeType
  target: ShotNodeType
  generated: TransitionGenerated | undefined
  model?: {
    label?: string
    model?: string
    providerKind?: string
    features?: { lastFrame?: boolean; textToVideo?: boolean; audioOut?: boolean }
  } | null
  nodes?: ShotNodeType[]
  characters?: CharacterSheet[]
  missingMedia?: Set<string>
}): TransitionVideoPreview {
  const g = normalizeGenerated(input.generated)
  const supportsLastFrame = Boolean(input.model?.features?.lastFrame)
  const nativeMode = g.audioMode === 'native'
  const modelFeatures = input.model?.features
  const req = transitionRequestSeconds(
    g.targetSeconds,
    input.model?.model,
    Boolean(g.boundary?.out && g.boundary?.in),
    { nativeAudio: nativeMode },
  )
  const dialogue = parseDialogue(transitionDialogueText(input.source, input.target))
  const performance = [...(input.source.data.performance ?? []), ...(input.target.data.performance ?? [])]
  const audioCaps = audioRefCapabilitiesFor({
    providerKind: input.model?.providerKind,
    model: input.model?.model,
    audioOut: input.model?.features?.audioOut,
  })
  const nativeRef = nativeMode
    ? nativeAudioRef({
        dialogue,
        performance,
        characters: input.characters ?? [],
        caps: audioCaps,
        seconds: nativeAudioGateSeconds(req.seconds, audioCaps),
      })
    : null
  const styleTokensForFp = transitionStyleRefTokens(
    input.source,
    input.target,
    input.nodes ?? [],
    input.characters ?? [],
    input.missingMedia ?? new Set<string>(),
    g,
  )
  const effectivePrompt = effectiveTransitionVideoPrompt(input.source, input.target, g, styleTokensForFp)
  const promptFingerprint = transitionVideoPromptFingerprint(
    input.source,
    input.target,
    g,
    styleTokensForFp,
  )
  const legacyKeyframe =
    g.bridging === 'keyframe' ? g.keyframe?.image || g.keyframe?.candidates?.[g.keyframe?.activeIdx ?? 0] : undefined
  const bridging = legacyKeyframe ? 'keyframe' : 'morph'
  const attachments: TransitionVideoPreviewAttachment[] = []
  const blocking: VideoRequestIssue[] = []
  const warnings: VideoRequestIssue[] = []

  if (bridging === 'morph') {
    if (g.boundary?.out) {
      attachments.push({
        role: 'first_frame',
        label: `首帧 · ${boundarySourceLabel(g.boundary.outFrom)}`,
        url: g.boundary.out,
        purpose: '锁定过渡起点',
      })
    }
    if (g.boundary?.in) {
      attachments.push({
        role: 'last_frame',
        label: `尾帧 · ${boundarySourceLabel(g.boundary.inFrom)}`,
        url: g.boundary.in,
        purpose: '锁定过渡终点',
      })
    }
    if (!supportsLastFrame && g.boundary?.out && g.boundary?.in) {
      blocking.push(
        transitionBlock(
          'transition-no-last-frame',
          '当前出片模型不支持尾帧，无法首尾直变（请选 Seedance 2.5 或 Kling v3，或只保留首帧）',
        ),
      )
    }
  } else if (legacyKeyframe) {
    attachments.push({
      role: 'keyframe',
      label: '首帧 · 旧版过渡关键帧',
      url: legacyKeyframe,
      purpose: '历史项目兼容',
    })
    warnings.push(
      transitionWarn(
        'transition-legacy-keyframe',
        '当前为旧版关键帧首帧模式，新转场建议删除关键帧并改用首尾直变',
      ),
    )
  }

  const nodes = input.nodes ?? []
  const characters = input.characters ?? []
  const missingMedia = input.missingMedia ?? new Set<string>()
  const merge = mergedTransitionShotReferences({
    source: input.source,
    target: input.target,
    nodes,
    characters,
    missingMedia,
    generated: g,
  })
  const inputMode = resolveTransitionInputMode({
    boundary: g.boundary,
    refCount: merge.used.length,
    hasVideoRef: Boolean(merge.videos[0]),
    features: modelFeatures,
  })
  const submitsLastFrame = inputModeSubmitsLastFrame(inputMode)
  const submitStyle = transitionRefSubmitAllowed(submitsLastFrame)
  const omitCode = styleRefOmitReason(submitsLastFrame)
  if (inputMode === 'none') {
    blocking.push(
      transitionBlock(
        'transition-no-input',
        '没有可用输入：抽取首尾帧、在画布连线参考图，或换一个支持文生视频的模型',
      ),
    )
  }
  const supplemental = new Set(merge.supplementalTokens)
  const usedSet = new Set(merge.used.map((r) => r.url))
  const omittedFromLimit = merge.omitted.map((r) => ({
    label: r.label,
    reason:
      r.source === 'expression'
        ? `表情参考因参考图已达上限（${VIDEO_REFERENCE_IMAGE_LIMIT ?? '不限'}）省略`
        : `超过参考图上限（${VIDEO_REFERENCE_IMAGE_LIMIT ?? '不限'}）`,
  }))
  const refs: VideoAttachment[] = merge.used.map((r, i) => ({
    slot: 'image' as const,
    index: i + 1,
    url: r.url,
    label: r.label,
    purpose: purposeOfShotReference(r),
    source: r.source,
  }))
  const primaryVideo = merge.videos[0]
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

  const styleRefs: TransitionStyleRefLine[] = []
  const styleOmitted: TransitionStyleOmitted[] = []
  const allLines = [...merge.used, ...merge.omitted]
  for (const r of allLines) {
    const kind: 'inherited' | 'added' = supplemental.has(r.token) ? 'added' : 'inherited'
    const inUsed = usedSet.has(r.url)
    let submitted = submitStyle && inUsed
    let omittedReason: string | undefined
    if (!submitStyle && r.url) {
      omittedReason = omitCode
    } else if (submitStyle && !inUsed) {
      omittedReason = 'ref_limit'
    }
    styleRefs.push({
      token: r.token,
      label: r.label,
      url: r.url,
      kind,
      submitted,
      ...(omittedReason ? { omittedReason } : {}),
    })
    if (omittedReason) {
      styleOmitted.push({
        token: r.token,
        label: r.label,
        reason: OMIT_REASON_LABELS[omittedReason] ?? omittedReason,
      })
    }
  }
  for (const o of omittedFromLimit) {
    styleOmitted.push({ token: '', label: o.label, reason: o.reason })
  }
  for (const o of merge.omittedVideos) {
    styleOmitted.push({ token: 'video-extra', label: o.label, reason: o.reason })
  }

  for (const m of merge.missing) {
    if (m.token === SHOT_PREV || m.token === SHOT_NEXT) {
      blocking.push(transitionBlock('transition-adjacent-ref', `${m.label}：${m.reason}`))
    } else if (String(m.token).startsWith('asset-') || String(m.reason).includes('视频')) {
      blocking.push(transitionBlock('transition-ref-missing', `${m.label}：${m.reason}`))
    }
  }
  for (const w of merge.warnings) {
    warnings.push(transitionWarn('transition-merge-warn', w))
  }

  const continuityPreview = transitionContinuityBlock(input.source, input.target)
  const submittedStyleCount = styleRefs.filter((r) => r.submitted).length
  let promptBody = effectivePrompt.text
  if (nativeMode && nativeRef?.ok && effectivePrompt.source === 'auto') {
    const nativeSound = nativeAudioPrompt(nativeRef.character, dialogue, true)
    if (nativeSound) promptBody = `${promptBody}\n\n${nativeSound}`
  }
  const prompt = finalizeTransitionPromptText(promptBody, effectivePrompt.source, attachments, refs, video)

  if (nativeMode) {
    if (!nativeRef?.ok) {
      blocking.push(
        transitionBlock('transition-native-audio', nativeRef?.reason ?? '原生音频未就绪'),
      )
    } else if (g.audioRef?.url && g.audioRef.url !== nativeRef.url) {
      warnings.push(transitionWarn('transition-native-audio-stale', '台词或音色样本已变化，建议重生成或重新勾选原生声音'))
    }
  }

  return {
    bridging,
    inputMode,
    submitsLastFrame,
    seconds: g.targetSeconds,
    requestSeconds: req.seconds,
    ...(req.trimTo ? { trimTo: req.trimTo } : {}),
    supportsLastFrame,
    modelLabel: input.model?.label,
    attachments,
    refs,
    video,
    omitted: omittedFromLimit,
    omittedVideos: merge.omittedVideos,
    styleRefs,
    styleOmitted,
    submittedStyleCount,
    audio:
      nativeMode && nativeRef?.ok
        ? {
            mode: 'native' as const,
            label: `${nativeRef.character} 音色`,
            detail: '出片请求将附带 audio_url 与 generate_audio',
            url: nativeRef.url,
            character: nativeRef.character,
          }
        : {
            mode: 'none' as const,
            label: '无参考音频',
            detail:
              nativeMode && nativeRef && !nativeRef.ok
                ? nativeRef.reason
                : '勾选「使用 Seedance 原生声音」可送音色参考；环境声仍可写在「声音描述」',
          },
    visualPrompt: g.prompt,
    soundPrompt: g.soundPrompt ?? '',
    continuityPreview,
    prompt,
    promptSource: effectivePrompt.source,
    promptStale: effectivePrompt.stale,
    promptFingerprint,
    blocking,
    warnings,
  }
}

/** 与 server/video.mjs 的 videoCapsFor 对齐的客户端下限（用于请求时长与提示） */
export function videoMinSeconds(modelId: string | undefined): number {
  const id = String(modelId || '').toLowerCase()
  if (/seedance[-_]?1[-_.]?5(?:[-_.]|$)/.test(id)) return 4
  if (/seedance[-_]?1[-_.]?0(?:[-_.]|$)/.test(id)) return 2
  if (/kling/.test(id)) return 3
  if (/seedance[-_]?2[-_.]?5(?:[-_.]|$)/.test(id)) return 4
  return 2
}

export function modelSupportsLastFrame(entry: ModelEntry | undefined): boolean {
  return Boolean(entry?.features?.lastFrame)
}

/** 生成转场的请求时长：本次真的提交尾帧才保住终点，否则多留余量再裁 */
export function transitionRequestSeconds(
  targetSeconds: number,
  modelId: string | undefined,
  submitsLastFrame: boolean,
  opts?: { nativeAudio?: boolean },
): { seconds: number; trimTo?: number } {
  const min = videoMinSeconds(modelId)
  const nativeFloor = opts?.nativeAudio ? 5 : 0
  const effectiveMin = Math.max(min, nativeFloor)
  const target = Math.max(0.8, Number(targetSeconds) || 1.2)
  if (submitsLastFrame) return { seconds: Math.max(effectiveMin, Math.round(target)) }
  return { seconds: Math.max(effectiveMin, Math.ceil(target + 0.6)), trimTo: target }
}

/** 关键帧提示词：面板留空时用上一镜/下一镜的提示词兜底；边界帧由文案描述，不拼进参考图 */
export function keyframePrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
): string {
  const g = normalizeGenerated(generated)
  const custom = g.prompt.trim()
  if (custom) return custom
  const base = defaultTransitionPrompt(source, target)
  return (
    `${base}\n单幅过渡画面，不要分屏或左右拼接；从上一镜结束态自然衔接到下一镜开始态。`
  )
}

/** 关键帧参考上限（Seedream 多图参考 10 张） */
export const TRANSITION_KEYFRAME_REF_LIMIT = 10

export function clampKeyframeRefs(urls: string[]): { urls: string[]; omitted: number } {
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    uniq.push(u)
  }
  return { urls: uniq.slice(0, TRANSITION_KEYFRAME_REF_LIMIT), omitted: Math.max(0, uniq.length - TRANSITION_KEYFRAME_REF_LIMIT) }
}

/** 判断两个镜头是否在给定播放序列里相邻（面板提示用） */
export function areAdjacent(source: ShotNodeType, target: ShotNodeType, nodes: ShotNodeType[]): boolean {
  const i = nodes.indexOf(source)
  const j = nodes.indexOf(target)
  return i >= 0 && j === i + 1
}
