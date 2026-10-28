/** server/project-lifecycle.mjs 的类型声明（项目删除预览 / 快照 / 级联清理） */

export interface CascadeEntry {
  table: string
  column: string
  key: 'id' | 'name' | 'job_subquery'
  where?: string
}

export interface ProjectDeleteJobSummary {
  id: string
  platform: string
  state: string
  deliverableId: string
  createdAt: string
}

export interface ProjectDeletePreview {
  ok: true
  name: string
  exists: boolean
  counts: Record<string, number>
  mediaBytes: number
  activeJobs: ProjectDeleteJobSummary[]
}

/** 批量预览的逐项结果；非法名字返回 ok:false 且带 message */
export interface ProjectDeletePreviewItem extends Omit<ProjectDeletePreview, 'ok'> {
  ok: boolean
  message?: string
}

export interface ProjectDeleteResult {
  name: string
  ok: boolean
  code?: 'not_found' | 'active_jobs' | 'snapshot_failed' | 'delete_failed' | 'error'
  message?: string
  jobs?: ProjectDeleteJobSummary[]
  snapshot?: string
  filesRemoved?: boolean
  sharedFilesKept?: boolean
  warnings?: string[]
}

export interface ProjectDeleteBatchResult {
  ok: true
  results: ProjectDeleteResult[]
  deleted: string[]
  sharedFilesKept: true
}

export declare const DELETED_DIR: string
export declare const PROJECT_CASCADE: CascadeEntry[]

export declare function previewProjectDelete(root: string, name: string): ProjectDeletePreview

export declare function previewProjectDeletes(
  root: string,
  names: string | string[],
): { ok: true; items: ProjectDeletePreviewItem[] }

export declare function deleteProject(
  root: string,
  name: string,
  opts?: { appRoot?: string },
): ProjectDeleteResult

export declare function deleteProjects(
  root: string,
  names: string | string[],
  opts?: { appRoot?: string },
): ProjectDeleteBatchResult
