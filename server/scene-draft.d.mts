export type DraftState = {
  id: string
  project: string
  shotId: string
  lines: number
  chars: number
}

export type DraftRead = DraftState & {
  text: string
  totalLines: number
  startLine: number
  endLine: number
}

export type DraftCommit = DraftState & { code: string }

export class DraftError extends Error {
  code: string
  constructor(message: string, code?: string)
}

export const MAX_DRAFT_BYTES: number
export const MAX_WRITE_BYTES: number
export const MAX_READ_LINES: number
export const MAX_READ_BYTES: number

export function beginDraft(input: { project: string; shotId: string }, appRoot: string): DraftState
export function appendDraft(id: string, chunk: string): DraftState
export function readDraft(id: string, startLine?: number, endLine?: number): DraftRead
export function patchDraft(id: string, startLine: number, endLine: number, text: string): DraftState
export function commitDraft(id: string): DraftCommit
export function draftText(id: string): DraftState & { draft: string }
export function discardDraft(id: string): { id: string; discarded: boolean }
export function discardAllDrafts(): void
export function sweepStaleDrafts(appRoot: string, maxAgeMs?: number): number
