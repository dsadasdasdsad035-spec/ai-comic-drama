import type { ShotEdgeType, ShotNodeType } from './data'
import type { TransitionEffect, TransitionOut } from './types'
import { defaultTransition, resolveJoin } from './transition'

export type EditJoin =
  | { kind: 'cut' }
  | { kind: 'effect'; effect: TransitionEffect; seconds: number; xfade: string; edgeId?: string }

export type EditItem = {
  /** 镜头用节点 id */
  id: string
  kind: 'shot'
  node: ShotNodeType
  duration: number
  start: number
  end: number
  joinIn: EditJoin
}

export type EditList = {
  items: EditItem[]
  total: number
  shots: number
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

/** 源镜头上与目标匹配的接缝配置；缺失时按默认叠化解释（读时兜底，不写存档） */
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
 * 效果转场重叠两镜，起点由折叠得出；时间线、预览、导出都读这里。
 */
export function buildEditList(nodes: ShotNodeType[], edges: ShotEdgeType[]): EditList {
  // 播放顺序 = 集内镜号顺序，不受 project.json 数组顺序影响
  const shots = nodes.filter(isShotNode).slice().sort(compareShotOrder)
  const indexOf = new Map<string, number>()
  shots.forEach((n, i) => indexOf.set(n.id, i))

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
      const resolved = resolveJoin(transitionFor(prev, node), prevDur, dur)
      if (resolved.mode === 'effect') {
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
    shots: items.length,
    inactive,
  }
}

/** 某个镜头在序列里的条目（含起点），没有返回 undefined */
export function shotItemOf(list: EditList, id: string): EditItem | undefined {
  return list.items.find((x) => x.id === id)
}
