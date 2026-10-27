import { extractFrames, type ModelEntry } from './api'
import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import type { TransitionBoundary, TransitionGenerated } from './types'
import { assetMediaType } from './mediaPick'
import { collectShotReferences, currentShotImage } from './shotReferences'
import { normalizeGenerated } from './transition'

export type TransitionRef = {
  token: string
  label: string
  url: string
  source: 'character' | 'asset' | 'extra'
}

const frameCache = new Map<string, { start?: string; end?: string }>()

/** 视频首帧/尾帧；同一 URL 只抽一次，失败不缓存硬错误 */
async function videoFrames(url: string): Promise<{ start?: string; end?: string }> {
  const hit = frameCache.get(url)
  if (hit) return hit
  try {
    const first = await extractFrames(url, 2, undefined, [0])
    let end: string | undefined
    try {
      const dur = Number(first.duration) || 0
      if (dur > 0.1) {
        const last = await extractFrames(url, 2, undefined, [Math.max(0, dur - 0.05)])
        end = last.urls[0]
      }
    } catch {
      end = undefined
    }
    const out = { start: first.urls[0], end }
    frameCache.set(url, out)
    return out
  } catch {
    return {}
  }
}

/**
 * 边界帧：上一镜优先取视频尾帧，下一镜优先取视频首帧；
 * 没有视频就退回当前画面。缺图和抽帧失败都返回 warning，不抛。
 */
export async function ensureTransitionBoundary(
  source: ShotNodeType,
  target: ShotNodeType,
  existing?: TransitionBoundary,
): Promise<{ boundary: TransitionBoundary; warnings: string[] }> {
  const warnings: string[] = []
  let out = existing?.out
  let outAt = existing?.outAt
  let inn = existing?.in
  let inAt = existing?.inAt

  if (source.data.videoUrl) {
    const f = await videoFrames(String(source.data.videoUrl))
    if (f.end) {
      out = f.end
      outAt = undefined
    } else {
      warnings.push('上一镜尾帧抽取失败，暂用当前画面')
    }
  }
  if (!out) out = currentShotImage(source.data)

  if (target.data.videoUrl) {
    const f = await videoFrames(String(target.data.videoUrl))
    if (f.start) inn = f.start
    else warnings.push('下一镜首帧抽取失败，暂用当前画面')
  }
  if (!inn) inn = currentShotImage(target.data)

  if (!out) warnings.push('上一镜没有可用画面')
  if (!inn) warnings.push('下一镜没有可用画面')
  return { boundary: { out, in: inn, outAt, inAt }, warnings }
}

const isRefSource = (s: string) => s === 'character' || s === 'asset' || s === 'extra'

/**
 * 转场关键帧的参考清单：
 * 结构参考（尾帧/首帧）由调用方放最前；这里只按「两镜继承 → 显式补充」给出人/景/道具参考。
 */
export function transitionRefCandidates(
  source: ShotNodeType,
  target: ShotNodeType,
  nodes: ShotNodeType[],
  characters: CharacterSheet[],
  missingMedia: Set<string>,
): TransitionRef[] {
  const out = new Map<string, TransitionRef>()
  for (const node of [source, target]) {
    const collected = collectShotReferences({ node, nodes, characters, missingMedia })
    for (const r of collected.refs) {
      if (!isRefSource(r.source)) continue
      if (out.has(r.url)) continue
      out.set(r.url, {
        token: r.token,
        label: r.label,
        url: r.url,
        source: r.source === 'character' ? 'character' : r.source === 'asset' ? 'asset' : 'extra',
      })
    }
  }
  // 所有可用角色/素材也列出来，方便面板补充；没连线的默认不选
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
      if (!isRefSource(r.source)) continue
      if (seen.has(r.url)) continue
      seen.add(r.url)
      out.push({
        token: r.token,
        label: r.label,
        url: r.url,
        source: r.source === 'character' ? 'character' : r.source === 'asset' ? 'asset' : 'extra',
      })
    }
  }
  return out
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

export function defaultTransitionPrompt(source: ShotNodeType, target: ShotNodeType): string {
  const a = String(source.data.videoPrompt || source.data.prompt || '').trim()
  const b = String(target.data.videoPrompt || target.data.prompt || '').trim()
  const cut = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s)
  if (!a && !b) return '两个镜头之间的过渡瞬间：保持同一空间、同一人物与同一光线，画面自然衔接。'
  return (
    '两个镜头之间的过渡瞬间，保持人物外观、服装、场景与光线一致。' +
    (a ? `上一镜：${cut(a)}。` : '') +
    (b ? `下一镜：${cut(b)}。` : '')
  )
}

export function transitionVideoPrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
): string {
  const g = normalizeGenerated(generated)
  const base = g.prompt.trim() || defaultTransitionPrompt(source, target)
  return (
    `${base}\n\n这是两个镜头之间的过渡片段：从上镜的落点自然过渡到下镜的起点，` +
    '人物外观、服装、场景与光线保持一致，运动连续，不出现字幕、文字与水印。'
  )
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

/** 生成转场的请求时长：首尾帧模型需要保住终点，只首帧模型多留一点余量再裁 */
export function transitionRequestSeconds(
  targetSeconds: number,
  modelId: string | undefined,
  supportsLastFrame: boolean,
): { seconds: number; trimTo?: number } {
  const min = videoMinSeconds(modelId)
  const target = Math.max(0.8, Number(targetSeconds) || 1.2)
  if (supportsLastFrame) return { seconds: Math.max(min, Math.round(target)) }
  return { seconds: Math.max(min, Math.ceil(target + 0.6)), trimTo: target }
}

/** 关键帧提示词：面板留空时用上一镜/下一镜的提示词兜底 */
export function keyframePrompt(
  source: ShotNodeType,
  target: ShotNodeType,
  generated: TransitionGenerated | undefined,
): string {
  const g = normalizeGenerated(generated)
  return g.prompt.trim() || defaultTransitionPrompt(source, target)
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
