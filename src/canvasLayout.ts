/**
 * 画布节点落位的唯一实现：分区、栅格、避让、整理。
 *
 * 为什么集中在一处：分镜、角色、素材卡过去各自内联坐标（有的在 buildShotNodes，
 * 有的在 App 的四个回调里），每加一个创建入口就复制一次栅格常量，于是出现
 * 「连点三张素材卡完全重合」「宽镜后接窄镜压进前一列」「首次恢复的素材卡落进分镜带」。
 * 这里只依赖卡片尺寸与节点数据，不依赖 React / React Flow，便于单测。
 */
import { cardWidth } from './types'

export type LayoutKind = 'shot' | 'char' | 'asset'

export interface Size {
  w: number
  h: number
}

export interface PlacedRect {
  x: number
  y: number
  w: number
  h: number
}

/** 整理时除位置外还要知道的业务信息（镜号与时长决定分镜槽位） */
export interface ArrangeItem extends PlacedRect {
  id: string
  kind: LayoutKind
  episode?: number
  no?: string
  seconds?: number
}

/* ---------------------------------------------------------------- 分镜带 */

/** 一行最多几张分镜 */
export const SHOT_COLS = 6
/** 同行卡片之间的水平间距 */
export const SHOT_GAP = 56
/** 行高：按最宽的卡（时长拉满时 305px 高）留出余量 */
export const SHOT_ROW_H = 340
/** 相邻两集之间的间隔 */
export const EP_GAP = 80

/* ---------------------------------------------------------------- 素材带 */

export const ASSET_CELL_W = 200
export const ASSET_CELL_H = 150
export const ASSET_GAP_X = 28
export const ASSET_GAP_Y = 26
/** 一个块里横排几张 */
export const ASSET_COLS = 5
/** 一个块里纵排几行，超过就右移开新块，避免一路向上撞到角色带 */
export const ASSET_ROWS = 6
/** 第 0 行贴着分镜带上沿，再往上（负 y）生长 */
export const ASSET_BASE_Y = -240
export const ASSET_ORIGIN_X = 60

const ASSET_PITCH_X = ASSET_CELL_W + ASSET_GAP_X
const ASSET_PITCH_Y = ASSET_CELL_H + ASSET_GAP_Y
const ASSET_BLOCK_COLS = ASSET_COLS * ASSET_PITCH_X + 40

/* ---------------------------------------------------------------- 角色带 */

export const CHAR_CELL_W = 120
export const CHAR_CELL_H = 150
export const CHAR_GAP_X = 50
export const CHAR_ORIGIN_X = 80
/** 固定在素材带最高一块之上，素材再多也不会撞到角色 */
export const CHAR_BAND_Y = ASSET_BASE_Y - ASSET_ROWS * ASSET_PITCH_Y - 60

/** 节点尺寸：新节点落位时还没有实测尺寸，用保守估算（宁可略大，不要压边） */
export function measureNode(kind: LayoutKind, opts?: { seconds?: number }): Size {
  if (kind === 'shot') {
    const w = cardWidth(Number(opts?.seconds) || 3)
    // 头 + 16:9 画面 + 脚注，实测约 253（288 宽）到 305（380 宽）
    return { w, h: Math.round(((w - 16) * 9) / 16) + 100 }
  }
  if (kind === 'char') return { w: CHAR_CELL_W, h: CHAR_CELL_H }
  return { w: ASSET_CELL_W, h: ASSET_CELL_H }
}

export function nodeRect(
  kind: LayoutKind,
  position: { x: number; y: number },
  opts?: { seconds?: number },
): PlacedRect {
  const size = measureNode(kind, opts)
  return { x: position.x, y: position.y, w: size.w, h: size.h }
}

/** 按序号取素材卡槽位：先向上生长，一块满了右移开新块 */
export function assetSlotPosition(slot: number): { x: number; y: number } {
  const perBlock = ASSET_COLS * ASSET_ROWS
  const safe = Math.max(0, Math.floor(slot))
  const block = Math.floor(safe / perBlock)
  const within = safe % perBlock
  const row = Math.floor(within / ASSET_COLS)
  const col = within % ASSET_COLS
  return {
    x: ASSET_ORIGIN_X + block * ASSET_BLOCK_COLS + col * ASSET_PITCH_X,
    y: ASSET_BASE_Y - row * ASSET_PITCH_Y,
  }
}

/** 按序号取角色卡槽位：单行横排 */
export function charSlotPosition(slot: number): { x: number; y: number } {
  const safe = Math.max(0, Math.floor(slot))
  return { x: CHAR_ORIGIN_X + safe * (CHAR_CELL_W + CHAR_GAP_X), y: CHAR_BAND_Y }
}

/** 每集占用的行数（按集顺序传入）→ 每集起始 y */
export function shotEpisodeOrigins(rowsByEpisode: number[]): number[] {
  const out: number[] = []
  let y = 0
  for (const rows of rowsByEpisode) {
    out.push(y)
    y += Math.max(1, Math.floor(rows)) * SHOT_ROW_H + EP_GAP
  }
  return out
}

/** 镜号比较：数值优先，其次本地化（带数字感知），最后按 id 兜底 */
export function compareShotNo(a?: string, b?: string): number {
  const num = (v?: string) => {
    const s = String(v ?? '').trim()
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
  }
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null && na !== nb) return na - nb
  if (na !== null && nb === null) return -1
  if (na === null && nb !== null) return 1
  return String(a ?? '').localeCompare(String(b ?? ''), 'zh-Hans-CN', { numeric: true })
}

/** 带间隙的矩形相交判定 */
export function rectsOverlap(a: PlacedRect, b: PlacedRect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  )
}

/**
 * 为一个新节点找不与同类节点重叠的槽位。
 * `existing` 只应包含同类型节点的矩形；批量创建时把刚算出的位置也放进去。
 */
export function placeNewNode(
  kind: LayoutKind,
  existing: PlacedRect[],
  opts?: { seconds?: number; gap?: number },
): { x: number; y: number } {
  const size = measureNode(kind, opts)
  const gap = opts?.gap ?? 12
  const peers = existing.filter((r) => r.w > 0 && r.h > 0)
  if (kind === 'shot') {
    // 分镜的槽位由集内镜号决定，不在这里找空位
    return { x: 0, y: 0 }
  }
  const slotOf = kind === 'asset' ? assetSlotPosition : charSlotPosition
  for (let slot = 0; slot < 2000; slot++) {
    const pos = slotOf(slot)
    const rect: PlacedRect = { x: pos.x, y: pos.y, w: size.w, h: size.h }
    if (!peers.some((r) => rectsOverlap(rect, r, gap))) return pos
  }
  // 理论上到不了：槽位无限延伸。兜底退回首槽，至少不抛错。
  return slotOf(0)
}

/**
 * 整理画布：按类型重新分配全部槽位。
 * 分镜按「集号升序 + 镜号」，素材与角色按传入顺序。
 */
export function arrangeAll(items: ArrangeItem[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()

  const shots = items.filter((i) => i.kind === 'shot')
  const episodes = [...new Set(shots.map((s) => Number(s.episode) || 1))].sort((a, b) => a - b)
  const byEp = new Map<number, ArrangeItem[]>()
  for (const s of shots) {
    const ep = Number(s.episode) || 1
    const list = byEp.get(ep) ?? []
    list.push(s)
    byEp.set(ep, list)
  }
  const origins = shotEpisodeOrigins(
    episodes.map((ep) => Math.max(1, Math.ceil((byEp.get(ep)?.length ?? 0) / SHOT_COLS))),
  )
  episodes.forEach((ep, i) => {
    const list = [...(byEp.get(ep) ?? [])].sort(
      (a, b) => compareShotNo(a.no, b.no) || String(a.id).localeCompare(String(b.id)),
    )
    let x = 0
    list.forEach((item, index) => {
      const row = Math.floor(index / SHOT_COLS)
      if (index > 0 && index % SHOT_COLS === 0) x = 0
      out.set(item.id, { x, y: (origins[i] ?? 0) + row * SHOT_ROW_H })
      x += measureNode('shot', { seconds: item.seconds }).w + SHOT_GAP
    })
  })

  items
    .filter((i) => i.kind === 'asset')
    .forEach((item, slot) => out.set(item.id, assetSlotPosition(slot)))

  items
    .filter((i) => i.kind === 'char')
    .forEach((item, slot) => out.set(item.id, charSlotPosition(slot)))

  return out
}
