import { useMemo } from 'react'
import PlatformBadge from './PlatformBadge'
import type { PlatformBadgeInfo } from './types'
import {
  JOB_STATE_LABEL,
  jobStateTone,
  type JobState,
  type PlatformCapability,
  type PublishJob,
} from './types'

/** 按成片分组展示逐平台状态；一条成片三个平台就是三行 chip */
export default function PublishRecords({
  jobs,
  platforms,
  onOpen,
}: {
  jobs: PublishJob[]
  platforms: PlatformCapability[]
  onOpen: (job: PublishJob) => void
}) {
  const labelOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of platforms) m.set(p.id, p.label)
    return (id: string) => m.get(id) || id
  }, [platforms])

  const groups = useMemo(() => {
    const m = new Map<string, PublishJob[]>()
    for (const j of jobs) {
      const list = m.get(j.deliverableId) || []
      list.push(j)
      m.set(j.deliverableId, list)
    }
    return [...m.entries()].map(([deliverableId, list]) => ({
      deliverableId,
      list: list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    }))
  }, [jobs])

  if (!jobs.length) {
    return (
      <div className="pb-empty">
        <b>还没有发布记录</b>
        在「待发布」里选一条成片，提交到平台后会在这里留下每个平台的状态。
      </div>
    )
  }

  return (
    <div className="pb-records">
      {groups.map((g) => (
        <div className="pb-rec" key={g.deliverableId}>
          <div className="pb-rec-head">
            <span>成片</span>
            <b>{g.list[0].deliverableId}</b>
            <span className="pb-rec-time">{g.list[0].createdAt.slice(0, 16).replace('T', ' ')}</span>
          </div>
          <div className="pb-chips">
            {g.list.map((j) => (
              <button
                key={j.id}
                type="button"
                className={`pb-chip ${jobStateTone(j.state as JobState)}`}
                onClick={() => onOpen(j)}
                title={j.errorMessage || undefined}
              >
                <span className="dot" />
                {labelOf(j.platform)} · {JOB_STATE_LABEL[j.state as JobState] || j.state}
                {j.payload?.source === 'assistant' ? <span className="pb-chip-tag">助手提交</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PublishJobDrawer({
  job,
  platformLabel,
  platformBadge,
  onClose,
  onRetry,
  onCancel,
  onMarkPublished,
}: {
  job: PublishJob | null
  platformLabel: string
  platformBadge?: PlatformBadgeInfo
  onClose: () => void
  onRetry: (job: PublishJob) => void
  onCancel: (job: PublishJob) => void
  onMarkPublished: (job: PublishJob, workUrl: string) => void
}) {
  if (!job) return null
  const state = job.state as JobState
  const retryable = ['failed', 'expired', 'unknown'].includes(state)
  const running = ['queued', 'uploading', 'awaiting_user'].includes(state)
  const canMark = ['awaiting_confirmation', 'submitted'].includes(state)

  return (
    <div className="pb-drawer-mask" role="dialog" aria-modal="true" aria-label="发布回执" onClick={onClose}>
      <div className="pb-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="pb-drawer-head">
          <PlatformBadge platform={job.platform} badge={platformBadge} />
          <span>{platformLabel}</span>
          <span className="pb-status" style={{ marginLeft: 'auto' }}>
            {JOB_STATE_LABEL[state] || state}
          </span>
          <button type="button" className="btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="pb-drawer-body">
          {job.payload?.source === 'assistant' ? (
            <div className="pb-hint" data-job-source="assistant">
              由助手提交（经你确认后创建）
            </div>
          ) : null}
          {job.errorMessage ? <div className="pb-hint warn">{job.errorMessage}</div> : null}

          <div className="pb-timeline">
            {(job.events ?? []).map((e) => (
              <div className="pb-timeline-row" key={e.id}>
                <time>{e.createdAt.slice(11, 19)}</time>
                <span>
                  {JOB_STATE_LABEL[e.state as JobState] || e.state}
                  {e.message ? ` · ${e.message}` : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="pb-hint">
            阶段：{job.stage || '—'} · 第 {job.runNo} 次执行
          </div>

          <div className="pb-cover-acts">
            {job.workUrl ? (
              <a className="btn-mini" href={job.workUrl} target="_blank" rel="noreferrer">
                打开作品页
              </a>
            ) : (
              <span className="pb-hint">还没有作品地址，可到平台后台确认。</span>
            )}
            {running ? (
              <button type="button" className="btn-mini" onClick={() => onCancel(job)}>
                取消
              </button>
            ) : null}
            {retryable ? (
              <button type="button" className="btn-mini" onClick={() => onRetry(job)}>
                重试该平台
              </button>
            ) : null}
            {canMark ? (
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  const url = window.prompt('作品地址（可留空，只标记状态）', job.workUrl || '')
                  if (url === null) return
                  onMarkPublished(job, url.trim())
                }}
              >
                标记已发布
              </button>
            ) : null}
          </div>

          <div className="pb-hint">
            平台「审核中」不等于已发布。请到平台后台确认后再标记，避免把未通过的内容当成成功。
          </div>
        </div>
      </div>
    </div>
  )
}
