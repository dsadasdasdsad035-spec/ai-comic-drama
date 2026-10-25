/** server/publish-package.mjs 的类型声明（离线发布包） */

import type { DeliverableConfig, DeliverableRecord } from './deliverables.d.mts'

export interface PublishPackageResult {
  ok: boolean
  id: string
  dirUrl: string
  zipUrl: string
  files: string[]
  copy: Record<string, unknown>
}

export interface PublishPackageSummary {
  id: string
  dirUrl: string
  zipUrl: string
  title: string
  createdAt: string
}

export declare function buildPublishPackage(
  appRoot: string,
  input?: {
    deliverable?: DeliverableRecord | null
    config?: DeliverableConfig
    platforms?: string[]
    projectsRoot?: string
  },
): Promise<PublishPackageResult>
export declare function listPackages(appRoot: string, limit?: number): PublishPackageSummary[]
export declare function describePackageError(e: unknown): string
