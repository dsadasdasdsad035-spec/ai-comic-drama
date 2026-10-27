import { type CharacterSheet } from './characters'
import { assetMediaType } from './mediaPick'
import { selectExpressionReference } from './expressionSheet'
import { PERFORMANCE_EMOTION_LABELS, type ShotData } from './types'
import type { ShotNodeType } from './data'

export const SHOT_PREV = 'shot-prev'
export const SHOT_NEXT = 'shot-next'

export type NeighborDirection = 'prev' | 'next'

export type NeighborCandidate = {
  token: typeof SHOT_PREV | typeof SHOT_NEXT
  direction: NeighborDirection
  label: string
  no?: string
  url?: string
  hasImage: boolean
}

export type ResolvedShotReference = {
  token: string
  source: 'expression' | 'character' | 'adjacent' | 'asset' | 'extra'
  url: string
  label: string
  /** 仅表情单格：用于视频预算只选说话角色 */
  character?: string
  emotion?: string
}

/** 连线里的视频素材；独立于图片参考，不占 4 张额度。 */
export type ResolvedVideoReference = {
  token: string
  url: string
  label: string
  title?: string
}

export type VideoReferenceCollection = {
  refs: ResolvedVideoReference[]
  missing: MissingShotReference[]
}

export type MissingShotReference = {
  token: string
  label: string
  reason: string
}

export type ReferenceCollection = {
  refs: ResolvedShotReference[]
  missing: MissingShotReference[]
}

export type LimitedReferences = {
  used: ResolvedShotReference[]
  omitted: ResolvedShotReference[]
}

export function currentShotImage(data: Pick<ShotData, 'refImage' | 'candidates' | 'activeIdx'>): string | undefined {
  if (data.refImage) return data.refImage
  const candidates = Array.isArray(data.candidates) ? data.candidates.filter(Boolean) : []
  if (!candidates.length) return undefined
  const idx = Math.max(0, Math.min(candidates.length - 1, Number(data.activeIdx) || 0))
  return candidates[idx]
}

function shotNumber(no: string | undefined): number | null {
  const m = String(no || '').match(/(\d+)(?!.*\d)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function compareShots(a: ShotNodeType, b: ShotNodeType): number {
  const na = shotNumber(a.data.no)
  const nb = shotNumber(b.data.no)
  if (na != null && nb != null && na !== nb) return na - nb
  if (na != null && nb == null) return -1
  if (na == null && nb != null) return 1
  return String(a.data.no || '').localeCompare(String(b.data.no || ''), 'zh')
}

/** 同集镜头按镜号数值排序；不返回其他集。 */
export function sortedEpisodeShots(node: ShotNodeType, nodes: ShotNodeType[]): ShotNodeType[] {
  const episode = Number(node.data.episode) || 1
  return nodes
    .filter((n) => (n as unknown as { type?: string }).type === 'shot')
    .filter((n) => (Number(n.data.episode) || 1) === episode)
    .slice()
    .sort((a, b) => compareShots(a, b) || a.id.localeCompare(b.id))
}

export function neighborShots(
  node: ShotNodeType,
  nodes: ShotNodeType[],
): { prev?: ShotNodeType; next?: ShotNodeType } {
  const list = sortedEpisodeShots(node, nodes)
  const idx = list.findIndex((n) => n.id === node.id)
  if (idx < 0) return {}
  return {
    ...(idx > 0 ? { prev: list[idx - 1] } : {}),
    ...(idx < list.length - 1 ? { next: list[idx + 1] } : {}),
  }
}

export function neighborCandidates(node: ShotNodeType, nodes: ShotNodeType[]): NeighborCandidate[] {
  const { prev, next } = neighborShots(node, nodes)
  const out: NeighborCandidate[] = []
  if (prev) {
    const url = currentShotImage(prev.data)
    out.push({
      token: SHOT_PREV,
      direction: 'prev',
      label: `上一镜 ${prev.data.no || '未编号'}`,
      no: prev.data.no,
      ...(url ? { url } : {}),
      hasImage: Boolean(url),
    })
  }
  if (next) {
    const url = currentShotImage(next.data)
    out.push({
      token: SHOT_NEXT,
      direction: 'next',
      label: `下一镜 ${next.data.no || '未编号'}`,
      no: next.data.no,
      ...(url ? { url } : {}),
      hasImage: Boolean(url),
    })
  }
  return out
}

export function hasNeighborReference(refIds: string[] | undefined): boolean {
  return Boolean(refIds?.some((id) => id === SHOT_PREV || id === SHOT_NEXT))
}

function addRef(
  refs: ResolvedShotReference[],
  seen: Set<string>,
  ref: ResolvedShotReference,
): void {
  if (!ref.url || seen.has(ref.url)) return
  seen.add(ref.url)
  refs.push(ref)
}

function addMissing(list: MissingShotReference[], token: string, label: string, reason: string) {
  list.push({ token, label, reason })
}

/**
 * 解析镜头 refIds：角色 → 相邻分镜 → 素材 → 手工 refExtras。
 * 当前镜 refImage 由调用方单独放在最前面；这里不返回它。
 */
export function collectShotReferences(input: {
  node: ShotNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia?: Set<string>
}): ReferenceCollection {
  const data = input.node.data
  const refIds = data.refIds ?? []
  const { prev, next } = neighborShots(input.node, input.nodes)
  const refs: ResolvedShotReference[] = []
  const seen = new Set<string>()
  const missing: MissingShotReference[] = []
  const missingMedia = input.missingMedia ?? new Set<string>()

  // 1. 表情参考：优先说话/主动作角色；失效或缺图静默回退文字表演，不阻塞出图。
  const expressionSeen = new Set<string>()
  const expressionOrder = [...(data.performance ?? [])]
    .filter((p) => p.character)
    .sort(
      (a, b) =>
        Number(Boolean(b.speaks)) - Number(Boolean(a.speaks)) ||
        Number(Boolean(b.action)) - Number(Boolean(a.action)),
    )
  for (const entry of expressionOrder) {
    if (expressionSeen.has(entry.character)) continue
    expressionSeen.add(entry.character)
    const card = input.characters.find((c) => c.name === entry.character || c.id === entry.character)
    if (!card) continue
    const selected = selectExpressionReference({ character: card, emotion: entry.emotion })
    if (selected.kind === 'none') continue
    if (missingMedia.has(selected.url)) continue
    addRef(refs, seen, {
      token: `expr:${card.name}:${entry.emotion}`,
      source: 'expression',
      url: selected.url,
      label: `角色「${card.name}」表情 · ${PERFORMANCE_EMOTION_LABELS[entry.emotion]}`,
      character: card.name,
      emotion: entry.emotion,
    })
  }

  // 2. 角色：显式 char token；没有 token 时保留旧的 cast 自动匹配。
  const charTokens = refIds.filter((id) => id.startsWith('char-'))
  const fallbackCast = refIds.length === 0 ? (data.cast ?? []) : []
  if (charTokens.length || fallbackCast.length) {
    const wanted = charTokens.length
      ? charTokens.map((id) => ({
          token: id,
          key: id.startsWith('char-miss-') ? id.slice(10) : id.slice(5),
        }))
      : fallbackCast.map((name) => ({ token: `cast:${name}`, key: name }))
    for (const item of wanted) {
      const card = input.characters.find((c) => c.id === item.key || c.name === item.key)
      if (!card?.image) continue
      if (missingMedia.has(card.image)) {
        addMissing(missing, item.token, `角色「${card.name}」`, '三视图文件缺失')
        continue
      }
      addRef(refs, seen, {
        token: item.token,
        source: 'character',
        url: card.image,
        label: `角色「${card.name}」外观`,
      })
    }
  }

  // 2. 相邻分镜：只解析显式 token；源图只取当前画面。
  for (const candidate of neighborCandidates(input.node, input.nodes)) {
    if (!refIds.includes(candidate.token)) continue
    if (!candidate.url) {
      addMissing(missing, candidate.token, candidate.label, `${candidate.label}还没有生成画面`)
      continue
    }
    if (missingMedia.has(candidate.url)) {
      addMissing(missing, candidate.token, candidate.label, `${candidate.label}画面文件缺失`)
      continue
    }
    addRef(refs, seen, {
      token: candidate.token,
      source: 'adjacent',
      url: candidate.url,
      label: `${candidate.label}画面`,
    })
  }

  // 3. 素材：asset- 节点；视频与音频不参与图片参考。
  for (const rid of refIds) {
    if (!rid.startsWith('asset-')) continue
    const asset = input.nodes.find((n) => n.id === rid)
    const d = asset?.data as unknown as { kind?: string; url?: string; title?: string } | undefined
    if (!d || d.kind === 'expression-sheet' || !d.url) continue
    if (assetMediaType((d.kind || 'image') as never, d.url) !== 'image') continue
    if (missingMedia.has(d.url)) {
      addMissing(missing, rid, `素材「${d.title || rid}」`, '素材图片文件缺失')
      continue
    }
    const tag = { scene: '场景', prop: '道具', image: '图片' }[d.kind as string] ?? '参考'
    addRef(refs, seen, {
      token: rid,
      source: 'asset',
      url: d.url,
      label: `${tag}「${d.title || '未命名'}」`,
    })
  }

  // 4. 手工附加 URL。
  for (const url of data.refExtras ?? []) {
    if (!url) continue
    if (missingMedia.has(url)) {
      addMissing(missing, `extra:${url}`, '手工参考图', '参考图文件缺失')
      continue
    }
    addRef(refs, seen, {
      token: `extra:${url}`,
      source: 'extra',
      url,
      label: '手工参考图',
    })
  }

  return { refs, missing }
}

/**
 * 解析连线里的视频素材。视频参考独立于图片 4 张额度，
 * 因此不复用 collectShotReferences 的图片去重与排序。
 */
export function collectVideoReferences(input: {
  node: ShotNodeType
  nodes: ShotNodeType[]
  missingMedia?: Set<string>
}): VideoReferenceCollection {
  const data = input.node.data
  const refIds = data.refIds ?? []
  const missingMedia = input.missingMedia ?? new Set<string>()
  const refs: ResolvedVideoReference[] = []
  const missing: MissingShotReference[] = []
  const seen = new Set<string>()

  for (const rid of refIds) {
    if (!rid.startsWith('asset-')) continue
    const asset = input.nodes.find((n) => n.id === rid)
    const d = asset?.data as unknown as { kind?: string; url?: string; title?: string } | undefined
    if (!d) {
      addMissing(missing, rid, `素材「${rid}」`, '素材节点不存在')
      continue
    }
    if (assetMediaType((d.kind || 'image') as never, String(d.url || '')) !== 'video') continue
    const title = d.title || '未命名'
    if (!d.url) {
      addMissing(missing, rid, `视频素材「${title}」`, '视频素材没有地址')
      continue
    }
    if (missingMedia.has(d.url)) {
      addMissing(missing, rid, `视频素材「${title}」`, '视频素材文件缺失')
      continue
    }
    if (seen.has(d.url)) continue
    seen.add(d.url)
    refs.push({
      token: rid,
      url: d.url,
      label: `视频素材「${title}」`,
      ...(d.title ? { title: d.title } : {}),
    })
  }

  return { refs, missing }
}

export function limitReferences(
  refs: ResolvedShotReference[],
  max: number,
): LimitedReferences {
  const used = refs.slice(0, Math.max(0, max))
  return { used, omitted: refs.slice(Math.max(0, max)) }
}

/** 供右键菜单使用的相邻候选；没有图也返回，由 UI 置灰。 */
export function neighborReferenceItems(node: ShotNodeType, nodes: ShotNodeType[]) {
  return neighborCandidates(node, nodes).map((c) => ({
    id: c.token,
    title: c.label,
    tag: c.hasImage ? '分镜' : '分镜 · 未出图',
    img: c.url,
    disabled: !c.hasImage,
  }))
}

export function resolveNeighborToken(
  node: ShotNodeType,
  nodes: ShotNodeType[],
  token: string,
): NeighborCandidate | null {
  if (token !== SHOT_PREV && token !== SHOT_NEXT) return null
  return neighborCandidates(node, nodes).find((c) => c.token === token) ?? null
}
