/** server/publish-jobs.mjs 的类型声明（发布任务与状态机） */

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

export type PublishMode = 'draft' | 'publish' | 'package'

export interface PublishJob {
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
}

export interface PublishEvent {
  id: number
  state: string
  stage: string
  message: string
  createdAt: string
}

export interface PublishJobWithEvents extends PublishJob {
  events: PublishEvent[]
}

export interface CreateJobInput {
  deliverableId: string
  project: string
  episode?: number
  platform: string
  accountId?: string
  mode?: string
  deliverableUrl?: string
  payload?: Record<string, unknown>
  republish?: boolean
}

export declare const JOB_STATES: JobState[]
export declare const TRANSITIONS: Record<string, string[]>
export declare const RETRYABLE_STATES: JobState[]
export declare const ACTIVE_STATES: JobState[]
export declare function isActiveState(state: string): boolean
export declare function canTransition(from: string, to: string): boolean
export declare function assertTransition(from: string, to: string): boolean
export declare function newJobId(): string
export declare function idempotencyKey(
  deliverableId: string,
  platform: string,
  accountId: string,
): string
export declare function appendEvent(
  root: string,
  jobId: string,
  state: string,
  stage: string,
  message: string,
): void
export declare function listEvents(root: string, jobId: string): PublishEvent[]
export declare function getJob(root: string, id: string): PublishJob | null
export declare function getJobWithEvents(root: string, id: string): PublishJobWithEvents | null
export declare function findActiveJob(root: string, key: string): PublishJob | null
export declare function listJobs(
  root: string,
  opts?: {
    project?: string
    episode?: number
    deliverableId?: string
    active?: boolean
    states?: string[]
    limit?: number
  },
): PublishJob[]
export declare function createJob(
  root: string,
  input: CreateJobInput,
): { job: PublishJob | null; reused: boolean }
export declare function updateStage(
  root: string,
  id: string,
  stage: string,
  message?: string,
): PublishJob
export declare function transitionJob(
  root: string,
  id: string,
  next: JobState,
  opts?: {
    stage?: string
    errorCode?: string
    errorMessage?: string
    workUrl?: string
    message?: string
  },
): PublishJob
export declare function cancelJob(root: string, id: string): PublishJob
export declare function markPublished(root: string, id: string, workUrl?: string): PublishJob
export declare function recoverInterruptedJobs(root: string): number
export declare function jobSummary(
  root: string,
  opts?: { project?: string; episode?: number },
): { running: number; failed: number; unknown: number; total: number }
