/**
 * 画布几何的存取层（纯函数）。
 *
 * 为什么单独成模块：位置过去只活在 `localStorage` 里，而桌面端每次启动的服务端口不同，
 * `localStorage` 按 origin 隔离 → 重启后节点全按栅格重排、素材卡换新 uid，`shot.refIds`
 * 里的 `asset-<uid>` 立刻断链。这里把「节点 ↔ 布局行」的换算收敛成一组不碰 React、
 * 不碰网络的函数，让 App 只负责调用，测试只测这一层。
 *
 * 两类 key，仅两类：
 * - `shot:<shotId>`   分镜节点。节点 id 是随机 uid，所以 key 只能从 `data.shotId` 取。
 * - `asset:<canvasId>` 素材卡。节点 id 直接由 canvasId 派生（`asset-<canvasId>`），
 *   与 `shot.refIds` 的 token 同源，改名也不会变。
 */

/** 布局行：与 `canvas_layouts` 表一一对应 */
export type CanvasSpot = { key: string; x: number; y: number }

export const SHOT_KEY_PREFIX = 'shot:'
export const ASSET_KEY_PREFIX = 'asset:'
/** 素材卡节点 id 前缀；`asset-<canvasId>` */
export const ASSET_NODE_PREFIX = 'asset-'

/**
 * 节点最小结构。用 `any` 兜住 data，是为了让 React Flow 的 `Node<ShotData>` 之类
 * 都能直接传进来，不必为这层纯函数再做一次类型搬运。
 */
export type CanvasNodeLike = {
  id: string
  position: { x: number; y: number }
  type?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

/** 分镜 key；空 id 返回空串（调用方据此跳过） */
export function shotKey(shotId: unknown): string {
  const id = String(shotId ?? '').trim()
  return id ? `${SHOT_KEY_PREFIX}${id}` : ''
}

/** 素材卡 key；空 id 返回空串 */
export function assetKey(canvasId: unknown): string {
  const id = String(canvasId ?? '').trim()
  return id ? `${ASSET_KEY_PREFIX}${id}` : ''
}

/** 素材卡节点 id：唯一派生点，别处不要再拼 `asset-` */
export function assetNodeId(canvasId: unknown): string {
  const id = String(canvasId ?? '').trim()
  return id ? `${ASSET_NODE_PREFIX}${id}` : ''
}

/** 从节点 id 反解 canvasId；不是素材卡节点返回空串 */
export function canvasIdFromNodeId(nodeId: unknown): string {
  const id = String(nodeId ?? '')
  if (!id.startsWith(ASSET_NODE_PREFIX)) return ''
  return id.slice(ASSET_NODE_PREFIX.length).trim()
}

/**
 * 节点 → 布局 key。分镜优先看 `data.shotId`（节点 id 是随机 uid，不可用），
 * 其次看 `asset-` 前缀；角色卡等不落库的节点返回空串。
 */
export function nodeKeyOf(node: CanvasNodeLike | null | undefined): string {
  if (!node) return ''
  const shotId = node.data?.shotId
  if (shotId) return shotKey(shotId)
  const canvasId = canvasIdFromNodeId(node.id)
  return canvasId ? assetKey(canvasId) : ''
}

/**
 * 用存量布局覆盖节点位置。
 * - 没有对应布局行的节点原样返回（保留落位规则算出的位置，而不是归零）；
 * - 坐标没变的节点保持同一对象引用，避免 React Flow 无谓重渲染；
 * - 非法坐标跳过：库里的脏数据不该把卡片甩到画布外。
 */
export function applyLayout<T extends CanvasNodeLike>(
  nodes: readonly T[],
  canvas: readonly CanvasSpot[] | null | undefined,
): T[] {
  if (!canvas?.length) return [...nodes]
  const byKey = new Map<string, { x: number; y: number }>()
  for (const spot of canvas) {
    const key = String(spot?.key ?? '').trim()
    if (!key) continue
    const x = Number(spot.x)
    const y = Number(spot.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    byKey.set(key, { x, y })
  }
  if (!byKey.size) return [...nodes]
  return nodes.map((node) => {
    const key = nodeKeyOf(node)
    const pos = key ? byKey.get(key) : undefined
    if (!pos) return node
    if (node.position?.x === pos.x && node.position?.y === pos.y) return node
    return { ...node, position: { ...node.position, x: pos.x, y: pos.y } }
  })
}

/** 当前位置快照：拖动结束时的比对基线 */
export function layoutSnapshot(nodes: readonly CanvasNodeLike[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const key = nodeKeyOf(node)
    if (!key) continue
    const x = Number(node.position?.x)
    const y = Number(node.position?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.set(key, { x, y })
  }
  return out
}

/**
 * 与快照比对，只返回坐标真正变化的行。
 *
 * 快照里没有的 key（新加的卡）也会返回：新增即视为位置变更，由调用方落库。
 * 反向不成立——快照里有、节点里没有的 key 不在这里删除，
 * 删卡是显式动作（`canvasDelete`），不能因为某次局部渲染里节点暂时缺席就清掉布局。
 */
export function diffLayout(
  nodes: readonly CanvasNodeLike[],
  snapshot: ReadonlyMap<string, { x: number; y: number }> | null | undefined,
): CanvasSpot[] {
  const out: CanvasSpot[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const key = nodeKeyOf(node)
    if (!key || seen.has(key)) continue
    const x = Number(node.position?.x)
    const y = Number(node.position?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = snapshot?.get(key)
    if (prev && prev.x === x && prev.y === y) continue
    seen.add(key)
    out.push({ key, x, y })
  }
  return out
}

/** 迁移报告里要用到的素材卡最小结构（与 `ProjectAsset` 兼容） */
export type LegacyAssetLike = { kind?: string; title?: string; designId?: string }

export type LegacyCanvasMigration = {
  /** 命中的素材卡：`index` 是它在 assets 数组里的下标 */
  canvasIds: { index: number; canvasId: string }[]
  /** 可以直接写入 `canvas_layouts` 的位置行 */
  canvas: CanvasSpot[]
  /** 命中的素材卡张数 */
  matchedCards: number
  /** 旧画布里有卡、素材库里找不到对应项（通常是被删过） */
  unmatchedCards: string[]
  /** 既不是分镜、也不是素材卡的遗留节点（示例卡 / 手搓实验卡） */
  droppedNodes: string[]
}

/**
 * 存量 v1 本地画布 → 迁移计划（纯函数，不读写存储）。
 *
 * 匹配顺序与服务端沿用身份的规则一致：`designId` 优先，其次 `kind + title`。
 * 只有能落到具体素材卡上的节点才转成布局行——落不到就进报告，
 * 不静默丢弃，否则用户只会看到「我的卡没了」而不知道为什么。
 */
export function planLegacyCanvasMigration(
  nodes: readonly CanvasNodeLike[],
  assets: readonly LegacyAssetLike[],
): LegacyCanvasMigration {
  const byDesign = new Map<string, number>()
  const byTitle = new Map<string, number>()
  assets.forEach((a, i) => {
    const designId = String(a?.designId ?? '').trim()
    if (designId && !byDesign.has(designId)) byDesign.set(designId, i)
    const titleKey = `${a?.kind || 'image'}:${String(a?.title ?? '').trim()}`
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, i)
  })

  const canvas: CanvasSpot[] = []
  const canvasIds: { index: number; canvasId: string }[] = []
  const unmatchedCards: string[] = []
  const droppedNodes: string[] = []
  const claimed = new Set<number>()

  for (const node of nodes) {
    const x = Number(node?.position?.x)
    const y = Number(node?.position?.y)
    const movable = Number.isFinite(x) && Number.isFinite(y)

    // 分镜：节点 id 是随机 uid，身份只能从 data.shotId 取
    const shotId = String(node?.data?.shotId ?? '').trim()
    if (shotId) {
      if (movable) canvas.push({ key: shotKey(shotId), x, y })
      continue
    }

    const canvasId = canvasIdFromNodeId(node?.id)
    if (!canvasId) {
      droppedNodes.push(String(node?.id ?? ''))
      continue
    }
    const designId = String(node?.data?.designId ?? '').trim()
    const kind = String(node?.data?.kind || 'image')
    const title = String(node?.data?.title ?? '').trim()
    const at = (designId ? byDesign.get(designId) : undefined) ?? byTitle.get(`${kind}:${title}`)
    if (at === undefined || claimed.has(at)) {
      unmatchedCards.push(title || String(node?.id ?? ''))
      continue
    }
    claimed.add(at)
    canvasIds.push({ index: at, canvasId })
    if (movable) canvas.push({ key: assetKey(canvasId), x, y })
  }

  return { canvasIds, canvas, matchedCards: canvasIds.length, unmatchedCards, droppedNodes }
}
