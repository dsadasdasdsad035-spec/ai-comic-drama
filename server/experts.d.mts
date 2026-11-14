import type { ServerResponse } from 'node:http'

export type ExpertRow = {
  id: string
  name: string
  description: string
  iconUrl?: string
  imageDescription?: string
  soul: string
  skillIds: string[]
  toolIds: string[]
  source: 'builtin' | 'custom'
}

export function safeExpertId(id: unknown): string
export function listBuiltinExperts(): ExpertRow[]
export function getBuiltinExpert(id: string): ExpertRow
export function listAllExperts(): ExpertRow[]
export function getExpert(id: string): ExpertRow
export function mergeCustomExperts(incoming: unknown[], options?: { replace?: boolean }): ExpertRow[]
export function saveCustomExperts(experts: unknown[]): ExpertRow[]
export function serveBuiltinExpertIcon(id: string, res: ServerResponse): void