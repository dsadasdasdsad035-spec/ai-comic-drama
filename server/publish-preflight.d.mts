/** server/publish-preflight.mjs 的类型声明（发布预检：阻断 / 警告） */

import type { DeliverableConfig } from './deliverables.d.mts'
import type { PublishAccount } from './publish-accounts.d.mts'

export type IssueLevel = 'block' | 'warn'

export interface PreflightIssue {
  level: IssueLevel
  code: string
  target: string
  field: string
  message: string
}

export interface PreflightResult {
  ok: boolean
  blocking: PreflightIssue[]
  warnings: PreflightIssue[]
  issues: PreflightIssue[]
}

export interface PreflightInput {
  appRoot: string
  /** 项目数据根（SB_PROJECTS_DIR 时与 appRoot 不同）；只用于 /project-assets/ */
  projectsRoot?: string
  deliverable: {
    url: string
    width: number | null
    height: number | null
    duration: number | null
    bytes: number | null
  } | null
  targets: { platform: string; accountId?: string; mode?: string }[]
  config: DeliverableConfig
  accounts: Map<string, PublishAccount>
}

export declare const ISSUE_CODES: Record<string, string>
export declare function runPreflight(input: PreflightInput): PreflightResult
