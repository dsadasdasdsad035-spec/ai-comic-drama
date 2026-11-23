/**
 * 分类词表的浏览器侧视图。
 *
 * 与服务端读同一份 JSON（`public/presets/prompt-taxonomy/v1.json`），构建期内联。
 * 前端不自己维护一份标签映射：词表加一个值，UI 自动就有，不会出现「服务端能筛、
 * 界面不显示」的半套状态。
 */
import doc from '../../public/presets/prompt-taxonomy/v1.json'

export type FacetValueDef = {
  id: string
  cn: string
  en: string
  token: string
}

export type FacetAxisDef = {
  id: string
  cn: string
  en: string
  order: number
  values: FacetValueDef[]
}

type RawDoc = {
  version?: string
  axes?: Array<{
    id?: string
    cn?: string
    en?: string
    order?: number
    values?: Array<{ id?: string; cn?: string; en?: string; token?: string }>
  }>
}

const raw = doc as RawDoc

export const TAXONOMY_VERSION = String(raw.version || '')

export const FACET_AXES: FacetAxisDef[] = (raw.axes || [])
  .map((axis) => ({
    id: String(axis.id || ''),
    cn: String(axis.cn || ''),
    en: String(axis.en || ''),
    order: Number(axis.order) || 0,
    values: (axis.values || []).map((v) => ({
      id: String(v.id || ''),
      cn: String(v.cn || ''),
      en: String(v.en || ''),
      token: String(v.token || ''),
    })),
  }))
  .filter((axis) => axis.id)
  .sort((a, b) => a.order - b.order)

const AXIS_BY_ID = new Map(FACET_AXES.map((axis) => [axis.id, axis]))
const VALUE_BY_AXIS = new Map(
  FACET_AXES.map((axis) => [axis.id, new Map(axis.values.map((v) => [v.id, v]))]),
)

export function getFacetAxis(axisId: string): FacetAxisDef | null {
  return AXIS_BY_ID.get(String(axisId || '')) || null
}

export function getFacetValue(axisId: string, valueId: string): FacetValueDef | null {
  return VALUE_BY_AXIS.get(String(axisId || ''))?.get(String(valueId || '')) || null
}

/** 值的中文名；未映射的值没有词表条目，直接显示原文 */
export function facetValueLabel(axisId: string, valueId: string): string {
  return getFacetValue(axisId, valueId)?.cn || String(valueId || '')
}

export function facetChipLabel(facet: { axis: string; value: string }): string {
  const axis = getFacetAxis(facet.axis)
  const value = facetValueLabel(facet.axis, facet.value)
  return axis ? `${axis.cn} · ${value}` : value
}

export function facetKey(axis: string, value: string): string {
  return `${axis}:${value}`
}

export function parseFacetKey(key: string): { axis: string; value: string } {
  const idx = key.indexOf(':')
  if (idx <= 0) return { axis: '', value: '' }
  return { axis: key.slice(0, idx), value: key.slice(idx + 1) }
}

/** 来源标注的中文名：卡片与详情都用它，避免两处各写一套 */
export const FACET_SOURCE_LABEL: Record<string, string> = {
  derived: '自动',
  import: '导入',
  manual: '手动',
}

/**
 * 卡片只放 3 个徽标，题材优先。
 *
 * 卡片高度必须可控：18 轴全铺会把网格拉成参差的长条，浏览时的扫读节奏就没了。
 */
export function cardFacets<T extends { axis: string }>(facets: T[] | null | undefined, max = 3): T[] {
  const list = Array.isArray(facets) ? facets : []
  const weight = (axis: string) => (axis === 'genre' ? -1 : getFacetAxis(axis)?.order || 99)
  return [...list].sort((a, b) => weight(a.axis) - weight(b.axis)).slice(0, max)
}

/** 详情按轴分组，轴顺序跟词表走 */
export function groupFacetsByAxis<T extends { axis: string }>(
  facets: T[] | null | undefined,
): Array<{ axis: FacetAxisDef; facets: T[] }> {
  const list = Array.isArray(facets) ? facets : []
  const map = new Map<string, T[]>()
  for (const f of list) {
    if (!map.has(f.axis)) map.set(f.axis, [])
    map.get(f.axis)!.push(f)
  }
  return FACET_AXES.filter((axis) => map.has(axis.id)).map((axis) => ({
    axis,
    facets: map.get(axis.id)!,
  }))
}
