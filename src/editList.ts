import type { ShotEdgeType, ShotNodeType } from './data'
import type { TransitionEffect, TransitionOut } from './types'
import {
  defaultTransition,
  generatedFade,
  resolveJoin,
  transitionFingerprint,
} from './transition'

export type EditJoin =
  | { kind: 'cut' }
  | { kind: 'effect'; effect: TransitionEffect; seconds: number; xfade: string; edgeId?: string }

export type EditItem = {
  /** 镜头用节点 id；生成转场用 edge id 加 tr- 前缀 */
  id: string
  kind: 'shot' | 'transition'
  node?: ShotNodeType
  edgeId?: string
  duration: number
  start: number
  end: number
  joinIn: EditJoin
  /** 生成转场片段的视频地址 */
  media?: string
  /** 仅首帧模型：成片里裁到这个时长 */
  trimTo?: number
  /** 生成转场依赖的边界已变化 */
  stale?: boolean
  /** 生成还没出片，当前按效果配置兜底 */
  fallback?: boolean
}

export type EditList = {
  items: EditItem[]
  total: number
  shots: number
  transitions: number
  stale: string[]
  inactive: { edgeId: string; reason: 'not-adjacent' }[]
}

const isShotNode = (n: ShotNodeType) => {
  const type = (n as unknown as { type?: string }).type
  return type === 'shot' || type == null
}

/** 镜号是播放顺序的权威来源：同集按 no 自然排序，no 相同保持数组顺序 */
export function compareShotOrder(a: ShotNodeType, b: ShotNodeType): number {
  const ea = Number(a.data.episode) || 1
  const eb = Number(b.data.episode) || 1
  if (ea !== eb) return ea - eb
  return String(a.data.no || '').localeCompare(String(b.data.no || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

const shotKey = (n: ShotNodeType) => String(n.data.shotId || n.id)

const durationOf = (n: ShotNodeType) => Math.max(0.4, Number(n.data.seconds) || 3)

/** 源镜头上与目标匹配的转场配置；缺失时按默认叠化解释（读时兜底，不写存档） */
export function transitionFor(
  source: ShotNodeType,
  target: ShotNodeType,
): TransitionOut {
  const stored = source.data.transitionOut
  const to = shotKey(target)
  if (stored && (stored.to === to || stored.to === target.id)) return stored
  return defaultTransition(to)
}

/**
 * 由节点顺序（播放顺序）和画布连线生成唯一剪辑序列。
 * 效果转场重叠、生成转场插入，起点由折叠得出；时间线、预览、导出都读这里。
 */
export function buildEditList(nodes: ShotNodeType[], edges: ShotEdgeType[]): EditList {
  // 播放顺序 = 集内镜号顺序，不受 project.json 数组顺序影响
  const shots = nodes.filter(isShotNode).slice().sort(compareShotOrder)
  const indexOf = new Map<string, number>()
  shots.forEach((n, i) => indexOf.set(n.id, i))
  const byId = new Map(shots.map((n) => [n.id, n]))

  const edgeByPair = new Map<string, ShotEdgeType>()
  const inactive: { edgeId: string; reason: 'not-adjacent' }[] = []
  for (const edge of edges) {
    if ((edge.data?.relation ?? 'cut') !== 'transition') continue
    const from = indexOf.get(edge.source)
    const to = indexOf.get(edge.target)
    // 端点不在当前播放序列里（别的集/被删）不属于「未参与」，直接忽略
    if (from == null || to == null) continue
    if (to !== from + 1) {
      inactive.push({ edgeId: edge.id, reason: 'not-adjacent' })
      continue
    }
    const key = `${edge.source}>${edge.target}`
    if (!edgeByPair.has(key)) edgeByPair.set(key, edge)
  }

  const items: EditItem[] = []
  const stale: string[] = []
  let cursor = 0

  for (let i = 0; i < shots.length; i++) {
    const node = shots[i]
    const dur = durationOf(node)

    if (i === 0) {
      items.push({
        id: node.id,
        kind: 'shot',
        node,
        duration: dur,
        start: 0,
        end: dur,
        joinIn: { kind: 'cut' },
      })
      cursor = dur
      continue
    }

    const prev = shots[i - 1]
    const prevDur = durationOf(prev)
    const edge = edgeByPair.get(`${prev.id}>${node.id}`)

    let joinIn: EditJoin = { kind: 'cut' }
    let start = cursor

    if (edge) {
      const t = transitionFor(prev, node)
      const fingerprint = transitionFingerprint(prev.data, node.data, t.generated)
      const resolved = resolveJoin(t, prevDur, dur, fingerprint)

      if (resolved.mode === 'generated') {
        const clipDur = resolved.seconds
        const fadeIn = generatedFade(prevDur, clipDur)
        const fadeOut = generatedFade(clipDur, dur)
        const clipStart = cursor - fadeIn
        const clipEnd = clipStart + clipDur
        // 生成片段两端固定用短叠化；效果配置只作为未出片时的兜底
        const fadeInEffect: TransitionEffect = { type: 'dissolve', seconds: fadeIn }
        const fadeOutEffect: TransitionEffect = { type: 'dissolve', seconds: fadeOut }
        const clipJoin: EditJoin =
          fadeIn > 0
            ? { kind: 'effect', effect: fadeInEffect, seconds: fadeIn, xfade: 'fade', edgeId: edge.id }
            : { kind: 'cut' }
        items.push({
          id: `tr-${edge.id}`,
          kind: 'transition',
          edgeId: edge.id,
          duration: clipDur,
          start: clipStart,
          end: clipEnd,
          joinIn: clipJoin,
          media: resolved.video,
          ...(resolved.trimTo ? { trimTo: resolved.trimTo } : {}),
          ...(resolved.stale ? { stale: true } : {}),
        })
        if (resolved.stale) stale.push(edge.id)
        start = clipEnd - fadeOut
        joinIn =
          fadeOut > 0
            ? { kind: 'effect', effect: fadeOutEffect, seconds: fadeOut, xfade: 'fade', edgeId: edge.id }
            : { kind: 'cut' }
      } else if (resolved.mode === 'effect') {
        start = cursor - resolved.seconds
        joinIn = {
          kind: 'effect',
          effect: resolved.effect,
          seconds: resolved.seconds,
          xfade: resolved.xfade,
          edgeId: edge.id,
        }
      }
    }

    items.push({
      id: node.id,
      kind: 'shot',
      node,
      duration: dur,
      start,
      end: start + dur,
      joinIn,
    })
    cursor = start + dur
  }

  return {
    items,
    total: Math.round(cursor * 100) / 100,
    shots: items.filter((x) => x.kind === 'shot').length,
    transitions: items.filter((x) => x.kind === 'transition').length,
    stale,
    inactive,
  }
}

/** 某个镜头在序列里的条目（含起点），没有返回 undefined */
export function shotItemOf(list: EditList, id: string): EditItem | undefined {
  return list.items.find((x) => x.kind === 'shot' && x.id === id)
}
