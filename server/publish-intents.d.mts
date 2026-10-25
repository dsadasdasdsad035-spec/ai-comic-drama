/** server/publish-intents.mjs 的类型声明（两阶段提交意图） */

export type IntentState = 'staged' | 'confirmed' | 'cancelled' | 'expired'

export type IntentSource = 'assistant' | 'manual'

export interface IntentTarget {
  platform: string
  accountId: string
  mode: 'draft' | 'publish' | 'package'
}

export interface PreflightIssue {
  level: 'block' | 'warn'
  code: string
  target: string
  field: string
  message: string
}

export interface IntentPreflight {
  ok: boolean
  blocking: PreflightIssue[]
  warnings: PreflightIssue[]
  issues: PreflightIssue[]
}

export interface PublishIntent {
  id: string
  deliverableId: string
  project: string
  episode: number
  source: IntentSource
  hash: string
  config: Record<string, unknown>
  targets: IntentTarget[]
  preflight: IntentPreflight | Record<string, never>
  state: IntentState
  jobIds: string[]
  reason: string
  createdAt: string
  expiresAt: string
  confirmedAt: string
}

export const INTENT_STATES: IntentState[]
export const INTENT_TTL_MS: number
export const INTENT_GARBAGE_MS: number

export function configHash(config: unknown): string
export function newIntentId(): string
export function normalizeTargets(raw: unknown): IntentTarget[]
export function intentSourceError(input: {
  source: string
  targets: IntentTarget[]
}): { code: string; message: string } | null

export function getIntent(root: string, id: string): PublishIntent | null
export function stageIntent(root: string, input: Record<string, unknown>): PublishIntent
export function confirmIntent(
  root: string,
  id: string,
  opts?: { config?: unknown; appRoot?: string },
): { intent: PublishIntent; jobs: Record<string, unknown>[]; reused: boolean }
export function cancelIntent(root: string, id: string): PublishIntent | null
export function expireStaleIntents(root: string): { expired: number }
export function sweepIntents(root: string, opts?: { keepMs?: number }): { removed: number }
export function resetIntentsForTest(): void
