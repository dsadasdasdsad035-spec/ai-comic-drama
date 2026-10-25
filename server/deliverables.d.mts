/** server/deliverables.mjs 的类型声明（成片版本与发布配置） */

export type PublishMode = 'draft' | 'publish' | 'package'

export interface PublishCopyOverride {
  title: string
  description: string
  tags: string[]
}

export interface PublishTargetConfig {
  selected: boolean
  accountId: string
  mode: PublishMode
  override: PublishCopyOverride | null
}

export interface DeliverableConfig {
  master: {
    title: string
    description: string
    tags: string[]
    aiGenerated: boolean
  }
  cover: Partial<Record<'9:16' | '16:9', string>>
  targets: Record<string, PublishTargetConfig>
}

export interface DeliverableRecord {
  id: string
  project: string
  episode: number
  version: number
  title: string
  url: string
  srtUrl: string
  width: number | null
  height: number | null
  duration: number | null
  bytes: number | null
  source: 'export' | 'import'
  config: DeliverableConfig
  /** 导出后自动草稿未排队的原因；空串表示无 */
  autoDraftNote: string
  createdAt: string
  updatedAt: string
}

export interface CreateDeliverableInput {
  id?: string
  project: string
  episode?: number
  title?: string
  url: string
  srtUrl?: string
  width?: number | null
  height?: number | null
  duration?: number | null
  bytes?: number | null
  source?: 'export' | 'import'
  config?: Partial<DeliverableConfig> | Record<string, unknown>
}

export declare const COVER_ASPECTS: string[]

export declare function newDeliverableId(): string
export declare function emptyDeliverableConfig(): DeliverableConfig
export declare function normalizeDeliverableConfig(raw: unknown): DeliverableConfig
export declare function createDeliverable(root: string, input: CreateDeliverableInput): DeliverableRecord | null
export declare function getDeliverable(root: string, id: string): DeliverableRecord | null
export declare function listDeliverables(
  root: string,
  opts?: { project?: string; episode?: number; limit?: number },
): DeliverableRecord[]
export declare function patchDeliverableConfig(
  root: string,
  id: string,
  config: unknown,
): DeliverableRecord | null
export declare function patchDeliverableMeta(
  root: string,
  id: string,
  patch?: {
    title?: string
    url?: string
    srtUrl?: string
    width?: number
    height?: number
    duration?: number
    bytes?: number
  },
): DeliverableRecord | null
export declare function setAutoDraftNote(root: string, id: string, note: string): DeliverableRecord | null
export declare function deleteDeliverable(root: string, id: string): boolean
