/** server/prompt-taxonomy.mjs 的类型声明（18 轴分类词表与分面推导） */

export type FacetSource = 'derived' | 'import' | 'manual'

export declare const TAXONOMY_REL_PATH: string
export declare const MODULE_ROOT: string
export declare const FACET_SOURCES: FacetSource[]
export declare const FACET_SOURCE_RANK: Record<FacetSource, number>

export interface TaxonomyValue {
  id: string
  cn: string
  en: string
  token: string
  aliases: string[]
  mapsToSize: string
  mapsToMove: string
}

export interface TaxonomyAxis {
  id: string
  cn: string
  en: string
  order: number
  values: TaxonomyValue[]
  valueById: Map<string, TaxonomyValue>
  terms: Array<{ term: string; value: string; ascii: boolean }>
}

export interface Taxonomy {
  version: string
  limits: Record<string, unknown>
  axes: TaxonomyAxis[]
  axisById: Map<string, TaxonomyAxis>
  sizeToValue: Map<string, string>
  moveToValue: Map<string, string>
  sourceMappings: Record<string, Record<string, string[]>>
  kindMappings: Record<string, string>
}

export interface FacetPair {
  axis: string
  value: string
}

export interface DerivedFacet extends FacetPair {
  source: FacetSource
  unmapped?: boolean
  raw?: string
}

export declare function validateTaxonomy(doc: unknown): true
export declare function loadTaxonomy(appRoot?: string): Taxonomy
export declare function loadDefaultTaxonomy(): Taxonomy
export declare function clearTaxonomyCache(): void
export declare function buildTaxonomyFromDoc(doc: unknown): Taxonomy
export declare function taxonomyVersion(taxonomy: Taxonomy): string
export declare function listTaxonomy(taxonomy: Taxonomy): {
  version: string
  axes: Array<{
    id: string
    cn: string
    en: string
    order: number
    values: Array<{ id: string; cn: string; en: string; token: string }>
  }>
}
export declare function normalizeFacetValue(taxonomy: Taxonomy, axisId: string, raw: unknown): string
export declare function getFacetValue(
  taxonomy: Taxonomy,
  axisId: string,
  valueId: string,
): TaxonomyValue | null
export declare function validateFacetPairs(
  taxonomy: Taxonomy,
  pairs: unknown,
): {
  valid: Array<FacetPair & { raw: string }>
  invalid: Array<{ raw: string; reason: string }>
}
export declare function groupFacetPairs(
  pairs: Array<FacetPair & { raw?: string }>,
): Array<{ axis: string; values: string[] }>
export declare function mapSourceCategories(
  taxonomy: Taxonomy,
  sourceId: string,
  categories: unknown,
): { mapped: Array<FacetPair & { raw: string }>; unmapped: string[] }
export declare function mapReverseKind(taxonomy: Taxonomy, kind: unknown): (FacetPair & { raw: string }) | null
export declare function deriveFacets(
  taxonomy: Taxonomy,
  caseRow?: Record<string, unknown>,
  options?: { reservedAxes?: Set<string> },
): DerivedFacet[]
export declare function groupFacetsByAxis(
  taxonomy: Taxonomy,
  facets: Array<{ axis: string }>,
): Array<{ axis: string; cn: string; values: unknown[] }>
