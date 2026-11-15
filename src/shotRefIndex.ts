/**
 * 参考名字索引：把画布上的节点整理成「参考 id → 可读名字」的查表。
 *
 * 为什么单独成模块：`storyboardMarkdown` 是纯函数、不碰画布，素材标题又只在
 * 画布节点上（`project.assets` 不存节点 id）。让导出模块自己去找节点会毁掉
 * 它的可测性，所以由调用方查好再传进去。
 *
 * 节点用结构类型而不是 `@xyflow/react` 的 Node：这个模块只关心 id、type 与
 * data.title，绑死画布类型会让它在测试与其它入口里都编不出来。
 */
import type { RefIndex } from './storyboardMarkdown'

export type { RefIndex }

type LooseNode = { id?: unknown; type?: unknown; data?: Record<string, unknown> | null }

/**
 * 构造参考索引。
 *
 * 角色同时登记 id 与名字两个键：`refIds` 里的 token 既可能是角色 id 也可能是
 * 角色名（参考解析按 `c.id === key || c.name === key` 匹配），只登记 id 会漏掉一半。
 */
export function buildShotRefIndex(
  charactersIn: ReadonlyArray<{ id?: unknown; name?: unknown }> | undefined,
  nodes: ReadonlyArray<unknown> | undefined,
): RefIndex {
  const characterNames: Record<string, string> = {}
  const characters: { id: string; name: string }[] = []
  for (const c of charactersIn ?? []) {
    const id = String(c?.id ?? '').trim()
    const name = String(c?.name ?? '').trim()
    if (!id) continue
    characterNames[id] = name || id
    if (name) characterNames[name] = name
    characters.push({ id, name: name || id })
  }

  const assetTitles: Record<string, string> = {}
  const assetIds: Record<string, string[]> = {}
  for (const raw of nodes ?? []) {
    const n = raw as LooseNode
    if (String(n?.type ?? '') !== 'asset') continue
    const id = String(n.id ?? '').trim()
    if (!id) continue
    const title = String(n.data?.title ?? '').trim()
    assetTitles[id] = title
    if (title) (assetIds[title] ??= []).push(id)
  }

  return { characterNames, assetTitles, assetIds, characters }
}

export type RefNameResolution = {
  /** 解析出的参考 id token，可直接写进镜头的 refIds */
  refIds: string[]
  /** 解析不到的说明，逐条进预览 */
  unresolved: string[]
}

/**
 * 参考名字 → 参考 id token，导入用。
 *
 * 角色按「名字等于角色显示名」反查 id；素材按标题精确匹配。
 * 两条都不做模糊匹配：
 * 参考连线决定出图取哪张参考图，猜错一张整镜外观就错了，而且不会报错。
 */
export function resolveRefNames(
  names: { characters?: string[]; assets?: string[] } | undefined,
  index?: RefIndex,
): RefNameResolution {
  const refIds: string[] = []
  const unresolved: string[] = []
  const seen = new Set<string>()
  const push = (token: string) => {
    if (!seen.has(token)) {
      seen.add(token)
      refIds.push(token)
    }
  }

  // 反查角色：只认 characters 里的 id/name 对，不去猜 characterNames 的哪个键是 id
  const roster = index?.characters ?? []
  for (const name of names?.characters ?? []) {
    const hits = roster.filter((c) => c.name === name)
    if (hits.length === 1) push(`char-${hits[0].id}`)
    else if (hits.length > 1) unresolved.push(`角色「${name}」有多张角色卡，无法确定连哪一张`)
    else unresolved.push(`角色「${name}」在当前项目里不存在`)
  }

  for (const title of names?.assets ?? []) {
    const ids = [...new Set(index?.assetIds?.[title] ?? [])]
    if (ids.length === 1) push(ids[0])
    else if (ids.length > 1) unresolved.push(`素材「${title}」有 ${ids.length} 张同名卡，无法确定连哪一张`)
    else unresolved.push(`素材「${title}」在当前项目里不存在`)
  }

  return { refIds, unresolved }
}

/** 带参考名字的行：导入链路里 rows 的公共形状 */
export type RefNamedRow = {
  reference?: { characters?: string[]; assets?: string[] }
  refIds?: string[]
  unresolvedRefs?: string[]
}

/**
 * 把行里的参考名字解析成参考 id。
 *
 * 解析发生在调用方而不是解析器里，因为素材标题与角色卡都在画布状态上，
 * 而 `src/intake/*` 是纯解析模块，压缩包导入时也没有画布上下文。
 */
export function resolveRowRefs<T extends RefNamedRow>(rows: T[], index?: RefIndex): T[] {
  if (!index) return rows
  return rows.map((row) => {
    if (!row.reference) return row
    const r = resolveRefNames(row.reference, index)
    if (!r.refIds.length && !r.unresolved.length) return row
    return {
      ...row,
      ...(r.refIds.length ? { refIds: [...new Set([...(row.refIds ?? []), ...r.refIds])] } : {}),
      ...(r.unresolved.length ? { unresolvedRefs: [...(row.unresolvedRefs ?? []), ...r.unresolved] } : {}),
    }
  })
}
