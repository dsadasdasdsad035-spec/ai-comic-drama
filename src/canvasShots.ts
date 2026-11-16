/**
 * 画布水合的纯函数层：项目镜头 → 分镜节点 / 顺序连线。
 *
 * 为什么单独一层：加载项目、导入分镜、Agent 写回、增删镜头必须走同一条路径，
 * 否则会出现「加载后」与「导入后」两种栅格和两套连线，布局反复漂移。
 */
import type { ProjectAsset, ProjectShot } from './api'
import {
  SHOT_COLS,
  SHOT_GAP,
  SHOT_ROW_H,
  assetSlotPosition,
  compareShotNo,
  measureNode,
  shotEpisodeOrigins,
} from './canvasLayout'
import { assetNodeId } from './canvasLayoutStore'
import type { ShotEdgeType, ShotNodeType } from './data'
import { shotToData } from './shotSync'
import { uid, type ShotData } from './types'

/** 画布节点里哪些是分镜（素材卡 / 角色卡不进播放序列） */
export const isShotCanvasNode = (n: ShotNodeType) => {
  const type = (n as unknown as { type?: string }).type
  return type === 'shot' || type == null
}

const isAssetNode = (n: ShotNodeType) => (n as unknown as { type?: string }).type === 'asset'

/**
 * `project.assets` → 画布素材卡节点。
 * 唯一派生点：节点 id 必须是 `asset-<canvasId>`，`shot.refIds` 里的 token 也是它，
 * 所以缺 canvasId 的卡进不了画布（由 `ensureAssetCanvasIds` 先补齐）。
 *
 * 放在这一层而不是 `App.tsx`：工具层（无画布上下文时）也要用它重建素材卡节点，
 * 否则 `refIds` 里的 `asset-<canvasId>` 解析不到，参考会被静默少送。
 */
export function assetNodesFromAssets(assets: ProjectAsset[]): ShotNodeType[] {
  const out: ShotNodeType[] = []
  assets.forEach((a, i) => {
    if (!String(a.canvasId ?? '').trim()) return
    out.push({
      id: assetNodeId(a.canvasId),
      type: 'asset',
      // 缺存量位置的卡先按素材带落位；之后 applyLayout 用项目里的位置覆盖
      position: assetSlotPosition(i),
      data: {
        title: a.title,
        kind: a.kind,
        url: a.url,
        ...(a.designId ? { designId: a.designId } : {}),
        ...(a.characterName ? { characterName: a.characterName } : {}),
      },
    } as unknown as ShotNodeType)
  })
  return out
}

/** 示例卡（无业务 ID 的演示镜头）：出现真实镜头后退场 */
const isDemoCard = (n: ShotNodeType) => !n.data?.shotId && /^S\d+$/.test(n.id)

/** project.shots → 画布节点；保留同 shotId 节点的位置与手改数据，新镜头按集栅格排 */
export function buildShotNodes(prev: ShotNodeType[], shots: ProjectShot[]): ShotNodeType[] {
  const byShot = new Map<string, ShotNodeType>()
  for (const n of prev) if (n.data?.shotId) byShot.set(String(n.data.shotId), n)
  // 已被认领的节点 id：两个镜头共用同一个「集 + 镜号」时（历史数据里 no 重复），
  // 按 no 回找会同时命中同一个旧节点，产出两个同 id 节点 —— React 会去重成一张卡。
  const claimed = new Set<string>()

  // 落位序列按「集号升序 + 镜号数值」算，不用 shots 数组下标：
  // 写回时命中镜会被提到前面（mergeShots），用下标定槽位会让新镜头乱窜。
  const epOf = (s: ProjectShot) => Number(s.episode) || 1
  const grouped = new Map<number, ProjectShot[]>()
  for (const s of shots) {
    const ep = epOf(s)
    const list = grouped.get(ep) ?? []
    list.push(s)
    grouped.set(ep, list)
  }
  const episodes = [...grouped.keys()].sort((a, b) => a - b)
  const origins = shotEpisodeOrigins(
    episodes.map((ep) => Math.max(1, Math.ceil((grouped.get(ep)?.length ?? 0) / SHOT_COLS))),
  )
  const epOrigin = new Map<number, number>()
  episodes.forEach((ep, i) => epOrigin.set(ep, origins[i] ?? 0))

  /** shotId → 名义槽位；列 x 用已占用宽度累加，卡片随时长变宽也不会互相压住 */
  const slotPos = new Map<string, { x: number; y: number }>()
  for (const ep of episodes) {
    const list = [...(grouped.get(ep) ?? [])].sort(
      (a, b) => compareShotNo(a.no, b.no) || String(a.id).localeCompare(String(b.id)),
    )
    let x = 0
    list.forEach((sh, index) => {
      const row = Math.floor(index / SHOT_COLS)
      if (index > 0 && index % SHOT_COLS === 0) x = 0
      slotPos.set(String(sh.id), {
        x,
        y: (epOrigin.get(ep) ?? 0) + row * SHOT_ROW_H,
      })
      x += measureNode('shot', { seconds: Number(sh.seconds) || 3 }).w + SHOT_GAP
    })
  }

  return shots.map((sh, i) => {
    const ep = epOf(sh)
    const old =
      byShot.get(sh.id) ??
      [...byShot.values()].find(
        (n) =>
          !claimed.has(n.id) &&
          (Number(n.data.episode) || 1) === ep &&
          String(n.data.no ?? '').trim() === String(sh.no ?? '').trim(),
      )
    if (old) claimed.add(old.id)
    if (old?.data?.shotId && old.data.shotId !== sh.id) byShot.delete(String(old.data.shotId))
    const position = old?.position ?? slotPos.get(String(sh.id)) ?? { x: 0, y: 0 }
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
 *
 * 画布是项目镜头的投影 —— 项目里没有的镜头，画布上也就不该有。
 * 清空画布因此不再需要「别再灌回来」的开关，它是真删镜头。
 */
export function composeShotCanvasNodes(prev: ShotNodeType[], shots: ProjectShot[]): ShotNodeType[] {
  const assets = prev.filter(isAssetNode)
  const extras = prev.filter((n) => !isAssetNode(n) && !n.data?.shotId && !isDemoCard(n))
  const keepDemo = shots.length === 0 ? prev.filter(isDemoCard) : []
  const shotNodes = buildShotNodes(prev, shots)
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
