import type { CharacterSheet } from './characters'
import type { AssetNodeType } from './data'
import { assetMediaType } from './mediaPick'
import {
  type MissingShotReference,
  type ReferenceCollection,
  type ResolvedShotReference,
  limitReferences,
} from './shotReferences'
import type { ShotNodeType } from './data'

function addRef(
  refs: ResolvedShotReference[],
  seen: Set<string>,
  entry: ResolvedShotReference,
) {
  if (seen.has(entry.url)) return
  seen.add(entry.url)
  refs.push(entry)
}

/** 图片素材卡：解析 refIds → Seedream 参考图（无邻镜 token） */
export function collectAssetImageReferences(input: {
  node: AssetNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia?: Set<string>
}): ReferenceCollection {
  const refIds = input.node.data.refIds ?? []
  const refs: ResolvedShotReference[] = []
  const seen = new Set<string>()
  const missing: MissingShotReference[] = []

  for (const rid of refIds) {
    if (rid.startsWith('char-')) {
      const key = rid.startsWith('char-miss-') ? rid.slice(10) : rid.slice(5)
      const card = input.characters.find((c) => c.id === key || c.name === key)
      if (!card?.image) {
        missing.push({ token: rid, label: `角色「${key}」`, reason: '没有三视图' })
        continue
      }
      if (input.missingMedia?.has(card.image)) {
        missing.push({ token: rid, label: `角色「${card.name}」`, reason: '三视图文件缺失' })
        continue
      }
      addRef(refs, seen, {
        token: rid,
        source: 'character',
        url: card.image,
        label: `角色「${card.name}」外观`,
      })
      continue
    }
    if (!rid.startsWith('asset-')) continue
    const asset = input.nodes.find((n) => n.id === rid)
    const d = asset?.data as { kind?: string; url?: string; title?: string } | undefined
    if (!d?.url) {
      missing.push({ token: rid, label: '素材卡', reason: '无有效图片' })
      continue
    }
    if (assetMediaType(String(d.kind) as never, d.url) !== 'image') continue
    if (input.missingMedia?.has(d.url)) {
      missing.push({ token: rid, label: d.title || '素材', reason: '文件缺失' })
      continue
    }
    addRef(refs, seen, {
      token: rid,
      source: 'asset',
      url: d.url,
      label: d.title || '参考图',
    })
  }

  return { refs, missing }
}

export function buildAssetImageRefs(
  input: Parameters<typeof collectAssetImageReferences>[0],
  budget = 10,
) {
  const collected = collectAssetImageReferences(input)
  const limited = limitReferences(collected.refs, budget)
  return { ...collected, limited }
}