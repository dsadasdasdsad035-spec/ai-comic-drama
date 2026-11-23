/** server/prompt-cases.mjs 的类型声明（提示词案例库：全局单表 + 外部来源导入） */

export declare const CASE_SOURCES: string[]
export declare const LICENSE_BY_SOURCE: Record<string, string>
export declare const CASE_LICENSE_VALUES: string[]
export declare const PROMPT_CASE_PAGE_SIZE: number
export declare const PROMPT_CASE_MAX_PAGE_SIZE: number
export declare const CASE_MEDIA_SUBDIR: string
export declare const PREVIEW_MAX_ITEMS: number

export type PromptCaseLicense = 'own' | 'reference-only'

export type PromptCaseFacetSource = 'derived' | 'import' | 'manual'

export interface PromptCaseFacet {
  axis: string
  value: string
  source: PromptCaseFacetSource
  unmapped: boolean
  suppressed: boolean
  taxonomyVersion: string
  updatedAt: string
}

export interface PromptCaseRecord {
  id: string
  source: string
  sourceId: string
  title: string
  prompt: string
  shots: unknown[]
  model: string
  category: string
  tags: string[]
  videoUrl: string
  posterUrl: string
  author: string
  sourceUrl: string
  license: PromptCaseLicense
  note: string
  favorite: boolean
  createdAt: string
  updatedAt: string
  taxonomyVersion: string
  facets: PromptCaseFacet[] | null
}

export interface PromptCaseFacets {
  total: number
  favorites: number
  bySource: Record<string, number>
  models: Array<{ model: string; count: number }>
  categories: Array<{ category: string; count: number }>
}

export interface PromptCaseListOptions {
  q?: string
  source?: string
  model?: string
  category?: string
  favorite?: boolean
  sort?: string
  page?: number | string
  pageSize?: number | string
  facetGroups?: Array<{ axis: string; values: string[] }>
}

export interface PromptCaseListResult {
  cases: PromptCaseRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CaseSourceInfo {
  id: string
  label: string
  enabled: boolean
  reason: string
  note: string
}

export declare function normalizeCaseSource(raw: unknown): string
export declare function licenseForSource(source: unknown): PromptCaseLicense
export declare function normalizeCaseTags(raw: unknown): string[]
export declare function promptCaseId(source: unknown, sourceId: unknown): string
export declare function newManualCaseId(): string
export declare function saveCase(appRoot: string, input?: Record<string, unknown>): PromptCaseRecord
export declare function saveCases(
  appRoot: string,
  list?: Array<Record<string, unknown>>,
): { created: number; updated: number; failed: Array<{ sourceId: string; message: string }> }
export declare function getCase(appRoot: string, id: string): PromptCaseRecord | null
export declare function findCaseBySource(appRoot: string, source: string, sourceId: string): PromptCaseRecord | null
export declare function listCases(appRoot: string, options?: PromptCaseListOptions): PromptCaseListResult
export declare function caseFacets(appRoot: string): PromptCaseFacets
export declare function caseFacetCounts(
  appRoot: string,
  options?: PromptCaseListOptions,
): Array<{ axis: string; value: string; count: number }>
export declare function getCaseFacets(
  appRoot: string,
  caseId: string,
  options?: { includeSuppressed?: boolean },
): PromptCaseFacet[]
export declare function setCaseFacets(
  appRoot: string,
  caseId: string,
  facets: Array<{ axis: string; value: string; source?: string; unmapped?: boolean }>,
  options?: { taxonomyVersion?: string },
): { written: number; facets: PromptCaseFacet[] }
export declare function applyDerivedFacets(
  appRoot: string,
  caseId: string,
  derived: Array<{ axis: string; value: string; source?: string; unmapped?: boolean }>,
  options?: { taxonomyVersion?: string },
): PromptCaseFacet[]
export declare function deleteCaseFacet(appRoot: string, caseId: string, axis: string, value: string): boolean
export declare function restoreCaseFacet(appRoot: string, caseId: string, axis: string, value: string): boolean
export declare function refreshCaseFacets(
  appRoot: string,
  caseId: string,
  options?: { taxonomy?: unknown },
): PromptCaseFacet[]
export declare function listStaleFacetCases(
  appRoot: string,
  version: string,
  options?: { limit?: number },
): { total: number; cases: Array<{ id: string; title: string; taxonomyVersion: string }> }
export declare function summarizeSourceFacets(
  taxonomy: unknown,
  source: string,
  categories: unknown,
): { facets: Array<{ axis: string; value: string }>; unmapped: string[] }
export declare function patchCase(
  appRoot: string,
  id: string,
  patch?: { note?: string; favorite?: boolean },
): PromptCaseRecord | null
export declare function deleteCase(appRoot: string, id: string): boolean
export declare function clearCaseSourceCache(): void
export declare function parseVflowIndex(raw: unknown): {
  items: Array<Record<string, unknown>>
  models: string[]
  categories: string[]
}
export declare function parseVflowItem(
  raw: unknown,
  options?: { categories?: string[] },
): Record<string, unknown>
export declare function listCaseSources(): CaseSourceInfo[]
export declare function previewCasesFromSource(
  input?: Record<string, unknown>,
  deps?: Record<string, unknown>,
): Promise<{
  source: string
  sourceLabel: string
  token: string
  total: number
  items: Array<Record<string, unknown>>
  models: string[]
  categories: string[]
  license: PromptCaseLicense
}>
export declare function importCasesFromSource(
  appRoot: string,
  input?: Record<string, unknown>,
  deps?: Record<string, unknown>,
): Promise<{
  source: string
  created: number
  updated: number
  failed: Array<{ id: string; message: string }>
  imported: number
  facetsWritten: number
}>
