/**
 * 画布水合的纯函数层：项目镜头 → 分镜节点 / 顺序连线。
 *
 * 为什么单独一层：加载项目、导入分镜、Agent 写回、增删镜头必须走同一条路径，
 * 否则会出现「加载后」与「导入后」两种栅格和两套连线，布局反复漂移。
 */
import type { ProjectShot } from './api'
import type { ShotEdgeType, ShotNodeType } from './data'
import { shotToData } from './shotSync'
import { cardWidth, uid, type ShotData } from './types'

/** 画布节点里哪些是分镜（素材卡 / 角色卡不进播放序列） */
export const isShotCanvasNode = (n: ShotNodeType) => {
  const type = (n as unknown as { type?: string }).type
  return type === 'shot' || type == null
}

const isAssetNode = (n: ShotNodeType) => (n as unknown as { type?: string }).type === 'asset'

/** 示例卡（无业务 ID 的演示镜头）：出现真实镜头后退场 */
const isDemoCard = (n: ShotNodeType) => !n.data?.shotId && /^S\d+$/.test(n.id)

/** project.shots → 画布节点；保留同 shotId 节点的位置与手改数据，新镜头按集栅格排 */
export function buildShotNodes(prev: ShotNodeType[], shots: ProjectShot[]): ShotNodeType[] {
  const byShot = new Map<string, ShotNodeType>()
  for (const n of prev) if (n.data?.shotId) byShot.set(String(n.data.shotId), n)
  const counters = new Map<number, { col: number; row: number }>()
  return shots.map((sh, i) => {
    const ep = Number(sh.episode) || 1
    const old =
      byShot.get(sh.id) ??
      [...byShot.values()].find(
        (n) => (Number(n.data.episode) || 1) === ep && String(n.data.no ?? '').trim() === String(sh.no ?? '').trim(),
      )
    if (old?.data?.shotId && old.data.shotId !== sh.id) byShot.delete(String(old.data.shotId))
    const c = counters.get(ep) ?? { col: 0, row: 0 }
    const position = old?.position ?? {
      x: c.col * (cardWidth(Number(sh.seconds) || 3) + 56),
      y: (ep - 1) * 380 + c.row * 340,
    }
    c.col += 1
    if (c.col >= 6) {
      c.col = 0
      c.row += 1
    }
    counters.set(ep, c)
    const base: ShotData = old?.data ?? {
      no: sh.no ?? `S${String(i + 1).padStart(2, '0')}`,
      seconds: 3,
      size: '中景',
      move: '固定',
      dialogue: '',
      prompt: '',
      marks: [],
    }
    return {
      id: old?.id ?? uid(),
      type: 'shot' as const,
      position,
      data: shotToData(sh, base),
    }
  })
}

/** 每个集内按镜头号串一条边，画布没有项目级边时用；转场按 source.transitionOut 恢复 */
export function chainEdges(shotNodes: ShotNodeType[]): ShotEdgeType[] {
  const byEp = new Map<number, ShotNodeType[]>()
  for (const n of shotNodes) {
    const ep = Number(n.data?.episode) || 1
    const list = byEp.get(ep) ?? []
    list.push(n)
    byEp.set(ep, list)
  }
  const out: ShotEdgeType[] = []
  for (const list of byEp.values()) {
    list.sort((a, b) =>
      String(a.data?.no ?? '').localeCompare(String(b.data?.no ?? ''), undefined, { numeric: true }),
    )
    for (let i = 1; i < list.length; i++) {
      const src = list[i - 1]
      const tgt = list[i]
      const to = tgt.data.shotId || tgt.id
      const isTransition = src.data.transitionOut?.to === to
      out.push({
        id: `seq-${src.id}-${tgt.id}`,
        source: src.id,
        target: tgt.id,
        type: 'shot',
        data: { relation: isTransition ? 'transition' : 'cut' },
      })
    }
  }
  return out
}

/**
 * 按源镜头的 transitionOut.to 找回转场边：
 * 节点重建、画布清空、项目重新加载后，线都还能回到正确的一对镜头上。
 */
export function repairTransitionEdges(nodes: ShotNodeType[], edges: ShotEdgeType[]): ShotEdgeType[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const byShot = new Map<string, ShotNodeType>()
  for (const n of nodes) if (n.data.shotId) byShot.set(String(n.data.shotId), n)
  const out = edges.map((e) => ({ ...e }))
  for (const src of nodes) {
    const t = src.data.transitionOut
    if (!t?.to) continue
    const tgt = byShot.get(t.to) ?? byId.get(t.to)
    if (!tgt || tgt.id === src.id) continue
    const hit = out.find((e) => e.source === src.id && e.target === tgt.id)
    if (hit) {
      if ((hit.data?.relation ?? 'cut') !== 'transition') {
        hit.data = { ...hit.data, relation: 'transition' }
      }
      continue
    }
    out.push({
      id: `tr-repair-${src.id}-${tgt.id}`,
      source: src.id,
      target: tgt.id,
      type: 'shot',
      data: { relation: 'transition' },
    })
  }
  return out
}

/**
 * 合成画布节点：保留素材卡与其他手搓卡，按 shotId 复用分镜节点，新镜头按集栅格排。
 * `emptyShots` 用于「用户主动清空过画布」的存档，避免重新灌回镜头。
 */
export function composeShotCanvasNodes(
  prev: ShotNodeType[],
  shots: ProjectShot[],
  opts: { emptyShots?: boolean } = {},
): ShotNodeType[] {
  const assets = prev.filter(isAssetNode)
  const extras = prev.filter((n) => !isAssetNode(n) && !n.data?.shotId && !isDemoCard(n))
  const keepDemo = shots.length === 0 ? prev.filter(isDemoCard) : []
  const shotNodes = opts.emptyShots ? [] : buildShotNodes(prev, shots)
  return [...assets, ...extras, ...keepDemo, ...shotNodes]
}

/** 合成画布连线：保留仍然有效的边，补齐顺序链，再按 transitionOut 修回转场 */
export function composeShotCanvasEdges(
  prev: ShotEdgeType[],
  shotNodes: ShotNodeType[],
): ShotEdgeType[] {
  const ids = new Set(shotNodes.map((n) => n.id))
  const kept = prev.filter((e) => ids.has(e.source) && ids.has(e.target))
  const pairs = new Set(kept.map((e) => `${e.source}->${e.target}`))
  const out = [...kept]
  for (const e of chainEdges(shotNodes)) {
    if (pairs.has(`${e.source}->${e.target}`)) continue
    out.push(e)
  }
  return repairTransitionEdges(shotNodes, out)
}
