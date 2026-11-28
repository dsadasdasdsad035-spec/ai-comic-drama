import type { ProjectAsset } from './api'

/**
 * 素材卡合并。
 *
 * 为什么单独成模块：素材卡有两处落点（`project.assets` 与画布节点），
 * 而「同一个设定卡 / 同一个角色的表情总图只能有一张」这条规则被写回、发布、
 * agent 建卡三条路径共用。规则散在三处时，只要有一处漏判就会出现两张同名卡，
 * 之后再按标题寻址就连不上了。
 */

/** 画布与项目共用的六种素材类型；与 `AssetNode` 的徽标、Inspector 的下拉一致 */
export const ASSET_KINDS = ['scene', 'prop', 'image', 'video', 'audio', 'music', 'subtitle', 'expression-sheet'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v)
}

/**
 * 同一张卡的判定键。
 *
 * 优先用设定卡标识（来源稳定），其次是「角色 + 表情总图」，
 * 最后才退回「类型 + 标题」——标题是用户可见文案，改名就会换一张卡，
 * 所以它只在没有更稳定标识时兜底。
 */
export function assetCardKey(
  a: Pick<ProjectAsset, 'kind' | 'title'> & { designId?: string; characterName?: string },
): string {
  const designId = String(a.designId ?? '').trim()
  if (designId) return `design:${designId}`
  const characterName = String(a.characterName ?? '').trim()
  if (a.kind === 'expression-sheet' && characterName) return `sheet:${characterName}`
  return `title:${a.kind}:${String(a.title ?? '').trim()}`
}

export type AssetMergeResult = {
  next: ProjectAsset[]
  /** 本次新增的卡（按合并后的顺序） */
  added: ProjectAsset[]
  /** 本次被改写的既有卡 */
  updated: ProjectAsset[]
}

/**
 * 按判定键合并写回。
 *
 * 未出现在本次载荷里的既有卡原样保留：删素材卡是人在界面上的动作，
 * agent 一次只提交一张不该把其余卡清空。
 * 更新时只覆盖载荷里真给了值的字段，`note`/`tags` 这类没提到的保持原样。
 */
export function mergeAssetCards(
  existing: ProjectAsset[] | undefined,
  incoming: ProjectAsset[] | undefined,
): AssetMergeResult {
  const next: ProjectAsset[] = (existing ?? []).map((a) => ({ ...a }))
  const added: ProjectAsset[] = []
  const updated: ProjectAsset[] = []
  for (const raw of incoming ?? []) {
    const title = String(raw?.title ?? '').trim()
    const url = String(raw?.url ?? '').trim()
    const kind = String(raw?.kind ?? '').trim()
    if (!title || !url || !kind) continue
    const card: ProjectAsset = {
      ...raw,
      title,
      url,
      kind,
      ...(raw.designId ? { designId: String(raw.designId).trim() } : {}),
      ...(raw.characterName ? { characterName: String(raw.characterName).trim() } : {}),
      ...(String(raw.canvasId ?? '').trim() ? { canvasId: String(raw.canvasId).trim() } : { canvasId: undefined }),
    }
    const key = assetCardKey(card)
    const at = next.findIndex((a) => assetCardKey(a) === key)
    if (at >= 0) {
      const merged: ProjectAsset = { ...next[at], ...card }
      // 画布身份只增不减：更新载荷没带 canvasId 时不能覆盖掉已有值。
      // 覆盖掉就等于把这张卡从画布上「换了一张」，shot.refIds 里的 asset-<canvasId> 会立刻断链。
      const canvasId = String(card.canvasId ?? '').trim() || String(next[at].canvasId ?? '').trim()
      if (canvasId) merged.canvasId = canvasId
      else delete merged.canvasId
      next[at] = merged
      updated.push(next[at])
    } else {
      const created: ProjectAsset = { ...card }
      if (!String(created.canvasId ?? '').trim()) delete created.canvasId
      next.push(created)
      added.push(created)
    }
  }
  return { next, added, updated }
}

/** 项目内媒体地址判定：地址必须在清单里，避免写进打不开的路径 */
export function isProjectMediaUrl(url: string, urls: Iterable<string>): boolean {
  const want = String(url ?? '').trim()
  if (!want) return false
  for (const u of urls) if (u === want) return true
  return false
}
