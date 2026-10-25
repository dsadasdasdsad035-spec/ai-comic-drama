/** 发布台的共享类型。字段与服务端 .d.mts 保持一致，避免两边各写一套。 */

export type PublishMode = 'draft' | 'publish' | 'package'

export type AccountStatus = 'connected' | 'expired' | 'unknown' | 'disabled'

export type JobState =
  | 'draft'
  | 'queued'
  | 'uploading'
  | 'awaiting_user'
  | 'awaiting_confirmation'
  | 'submitted'
  | 'published'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'unknown'

export type CoverAspect = '9:16' | '16:9'

export type PlatformLimits = { title: number; description: number; tags: number }

export type PlatformCapability = {
  id: string
  label: string
  short: string
  backendUrl: string
  contentTypes: string[]
  modes: string[]
  manualOnly: boolean
  verified: boolean
  coverAspects: string[]
  limits: PlatformLimits
  max: { durationSec?: number; bytes?: number }
  notes: string
}

export type PlatformHealth = {
  browserAvailable: boolean
  chromePath: string
  ffmpegAvailable: boolean
  ffmpegPath: string
  adapterReady: string[]
  adapterUnverified: string[]
  profilesRoot: string
}

export type PublishAccount = {
  id: string
  platform: string
  label: string
  status: AccountStatus
  lastCheckedAt: string
  autoDraft: boolean
  createdAt: string
  updatedAt: string
}

export type CopyOverride = { title: string; description: string; tags: string[] }

export type TargetConfig = {
  selected: boolean
  accountId: string
  mode: PublishMode
  override: CopyOverride | null
}

export type DeliverableConfig = {
  master: { title: string; description: string; tags: string[]; aiGenerated: boolean }
  cover: Partial<Record<CoverAspect, string>>
  targets: Record<string, TargetConfig>
}

export type Deliverable = {
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

export type PreflightIssue = {
  level: 'block' | 'warn'
  code: string
  target: string
  field: string
  message: string
}

export type PreflightResult = {
  ok: boolean
  blocking: PreflightIssue[]
  warnings: PreflightIssue[]
  issues: PreflightIssue[]
}

export type PublishEvent = {
  id: number
  state: string
  stage: string
  message: string
  createdAt: string
}

export type PublishJob = {
  id: string
  idempotencyKey: string
  runNo: number
  deliverableId: string
  project: string
  episode: number
  platform: string
  accountId: string
  mode: PublishMode
  state: JobState
  stage: string
  errorCode: string
  errorMessage: string
  workUrl: string
  deliverableUrl: string
  payload: Record<string, unknown>
  createdAt: string
  startedAt: string
  endedAt: string
  events?: PublishEvent[]
}

export type JobSummary = { running: number; failed: number; unknown: number; total: number }

export type PublishPackageResult = {
  ok: boolean
  id: string
  dirUrl: string
  zipUrl: string
  files: string[]
  copy: Record<string, unknown>
}

export type LoginSession = {
  id: string
  platform: string
  accountId: string
  status: 'opening' | 'awaiting' | 'done' | 'timeout' | 'error' | 'cancelled'
  message: string
  startedAt: number
  endedAt?: number
}

export const JOB_STATE_LABEL: Record<JobState, string> = {
  draft: '草稿',
  queued: '排队中',
  uploading: '上传中',
  awaiting_user: '待人工验证',
  awaiting_confirmation: '待确认',
  submitted: '平台审核中',
  published: '已发布',
  rejected: '未通过',
  failed: '失败',
  cancelled: '已取消',
  expired: '登录失效',
  unknown: '状态未知',
}

/** 状态语义：只用于选语义色，文字始终同时出现 */
export function jobStateTone(state: JobState): 'run' | 'warn' | 'ok' | 'bad' | 'idle' {
  if (state === 'uploading' || state === 'queued' || state === 'awaiting_user') return 'run'
  if (state === 'awaiting_confirmation' || state === 'submitted') return 'warn'
  if (state === 'published') return 'ok'
  if (state === 'failed' || state === 'expired' || state === 'rejected') return 'bad'
  return 'idle'
}

export const RETRYABLE: JobState[] = ['failed', 'expired', 'unknown']

export function emptyConfig(): DeliverableConfig {
  return { master: { title: '', description: '', tags: [], aiGenerated: true }, cover: {}, targets: {} }
}

/** 某平台最终使用的文案：覆写优先，否则继承主文案 */
export function copyFor(config: DeliverableConfig, platformId: string): CopyOverride {
  const ov = config.targets?.[platformId]?.override
  return {
    title: ov?.title || config.master.title,
    description: ov?.description || config.master.description,
    tags: ov?.tags?.length ? ov.tags : config.master.tags,
  }
}
