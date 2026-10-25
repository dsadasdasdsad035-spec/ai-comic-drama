/** server/publish-auto.mjs 的类型声明（导出后自动草稿） */

import type { DeliverableRecord } from './deliverables.d.mts'

export declare function autoDraftOnExport(input: {
  dbRoot: string
  appRoot: string
  deliverable: DeliverableRecord | null
}): { queued: number; skipped: { platform: string; reason: string }[] }
