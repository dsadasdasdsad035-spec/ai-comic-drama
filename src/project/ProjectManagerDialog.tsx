import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteProjects,
  listProjects,
  previewProjectDeletes,
  type ProjectDeletePreview,
  type ProjectDeleteResult,
  type ProjectSummary,
} from '../api'

type Props = {
  /** 常驻面板（设置页）或弹窗（全局带） */
  variant: 'dialog' | 'inline'
  onClose?: () => void
  /** 删除成功后通知父级刷新项目列表与全局上下文 */
  onDeleted: (names: string[]) => void | Promise<void>
}

const COUNT_LABELS: { key: string; label: string }[] = [
  { key: 'shots', label: '镜头' },
  { key: 'characters', label: '角色' },
  { key: 'assets', label: '素材' },
  { key: 'designs', label: '设定' },
  { key: 'episodes', label: '集' },
  { key: 'scenes', label: '场次' },
  { key: 'scene_layouts', label: '场景布局' },
  { key: 'stock_imports', label: '在线素材' },
  { key: 'chat_threads', label: '聊天线程' },
  { key: 'deliverables', label: '成片' },
  { key: 'publish_jobs', label: '发布任务' },
  { key: 'publish_intents', label: '提交意图' },
  { key: 'publish_events', label: '发布事件' },
]

function fmtBytes(n: number) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 项目管理：列表、搜索、单项/批量删除。
 * 删除前先按项目取预览，确认层显示真实影响；活动发布任务由服务端 409 拦截。
 */
export default function ProjectManagerDialog({ variant, onClose, onDeleted }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<string[]>([])
  const [previews, setPreviews] = useState<ProjectDeletePreview[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [results, setResults] = useState<ProjectDeleteResult[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { projects: ps, root: r } = await listProjects()
      setProjects(ps)
      setRoot(r || '')
      setSelected((prev) => {
        const alive = new Set(ps.map((p) => p.name))
        return new Set([...prev].filter((n) => alive.has(n)))
      })
    } catch (e: any) {
      setError(e?.message || '读取项目列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || String(p.title || '').toLowerCase().includes(q),
    )
  }, [projects, query])

  const visibleSelected = filtered.filter((p) => selected.has(p.name))
  const allVisibleSelected = filtered.length > 0 && visibleSelected.length === filtered.length

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach((p) => next.delete(p.name))
      else filtered.forEach((p) => next.add(p.name))
      return next
    })
  }

  const beginDelete = async (names: string[]) => {
    const clean = [...new Set(names.filter(Boolean))]
    if (!clean.length) return
    setTargets(clean)
    setResults(null)
    setConfirmText('')
    setPreviews(null)
    setPreviewing(true)
    try {
      const list = await previewProjectDeletes(clean)
      setPreviews(list)
    } catch (e: any) {
      setError(e?.message || '读取删除预览失败')
      setTargets([])
    } finally {
      setPreviewing(false)
    }
  }

  const cancelDelete = () => {
    if (deleting) return
    setTargets([])
    setPreviews(null)
    setConfirmText('')
  }

  const batch = targets.length > 1
  const expectedConfirm = batch ? String(targets.length) : targets[0] || ''
  const confirmOk = targets.length > 0 && !previewing && confirmText.trim() === expectedConfirm
  const blocked = (previews ?? []).filter((p) => p.exists && p.activeJobs.length > 0)
  const totals = useMemo(() => {
    const counts: Record<string, number> = {}
    let mediaBytes = 0
    for (const p of previews ?? []) {
      for (const [k, v] of Object.entries(p.counts ?? {})) counts[k] = (counts[k] ?? 0) + Number(v || 0)
      mediaBytes += Number(p.mediaBytes || 0)
    }
    return { counts, mediaBytes }
  }, [previews])

  const confirmDelete = async () => {
    if (!confirmOk) return
    setDeleting(true)
    setError('')
    try {
      const r = await deleteProjects(targets)
      setResults(r.results)
      const okNames = r.deleted ?? []
      setSelected((prev) => {
        const next = new Set(prev)
        okNames.forEach((n) => next.delete(n))
        return next
      })
      await load()
      if (okNames.length) await onDeleted(okNames)
      setTargets([])
      setPreviews(null)
      setConfirmText('')
    } catch (e: any) {
      setError(e?.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const body = (
    <>
      <div className="proj-manager-toolbar">
        <input
          className="proj-manager-search"
          data-project-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目名或标题"
        />
        <span className="proj-manager-count" data-project-selected-count>
          已选 {selected.size} 项
        </span>
        <button className="btn-mini" onClick={toggleAll} disabled={!filtered.length} data-manager-select-all>
          {allVisibleSelected ? '取消全选' : '全选当前'}
        </button>
        <span className="spacer" />
        <button
          className="btn"
          data-manager-delete-selected
          disabled={!selected.size || deleting}
          onClick={() => void beginDelete([...selected])}
        >
          删除选中
        </button>
      </div>

      {error && <p className="proj-error" data-manager-error>{error}</p>}

      {loading ? (
        <div className="st-modal-state">正在读取项目…</div>
      ) : filtered.length === 0 ? (
        <div className="st-modal-state">{projects.length ? '没有匹配的项目' : '还没有项目'}</div>
      ) : (
        <div className="proj-manager-list" role="table" aria-label="项目列表">
          <div className="proj-manager-row proj-manager-head" role="row">
            <span role="columnheader" />
            <span role="columnheader">项目</span>
            <span role="columnheader">数据</span>
            <span role="columnheader">更新时间</span>
            <span role="columnheader" />
          </div>
          {filtered.map((p) => (
            <div className="proj-manager-row" role="row" data-project-row={p.name} key={p.name}>
              <input
                type="checkbox"
                data-project-select={p.name}
                checked={selected.has(p.name)}
                onChange={() => toggle(p.name)}
                aria-label={`选择 ${p.name}`}
              />
              <span className="proj-manager-name" role="cell">
                <b>{p.name}</b>
                {p.title && p.title !== p.name ? <span className="proj-manager-title">{p.title}</span> : null}
              </span>
              <span className="proj-manager-meta" role="cell">
                {p.episodes} 集 · {p.shots} 镜
              </span>
              <span className="proj-manager-meta" role="cell">
                {fmtTime(p.updated_at)}
              </span>
              <button
                className="btn-mini danger"
                data-project-delete={p.name}
                disabled={deleting}
                onClick={() => void beginDelete([p.name])}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="proj-manager-results" data-manager-result>
          {results.map((r) => (
            <p key={r.name} className={r.ok ? 'proj-ok' : 'proj-warn'}>
              {r.ok ? '已删除' : '未删除'} <b>{r.name}</b>
              {r.ok ? '' : `：${r.message || r.code || '失败'}`}
              {r.ok && r.warnings?.length ? `（${r.warnings.join('；')}）` : ''}
              {r.jobs?.length
                ? ` · 进行中的任务：${r.jobs.map((j) => `${j.platform}/${j.state}`).join('、')}`
                : ''}
            </p>
          ))}
          <p className="st-hint">
            数据库快照写到 <code>{`${root || '项目根目录'}/.deleted/`}</code>，
            成片导出与发布包在共享产物目录，均未随项目删除，需要时请手工清理。
          </p>
        </div>
      )}

      {targets.length > 0 && (
        <div className="proj-confirm" role="group" aria-label="删除确认" data-project-delete-confirm>
          <h4>
            即将删除 {targets.length} 个项目：{targets.join('、')}
          </h4>
          {previewing ? (
            <p className="st-hint">正在读取影响范围…</p>
          ) : (
            <>
              <div className="proj-confirm-counts">
                {COUNT_LABELS.filter((c) => (totals.counts[c.key] ?? 0) > 0).map((c) => (
                  <span key={c.key}>
                    {c.label} <b>{totals.counts[c.key]}</b>
                  </span>
                ))}
                <span>
                  媒体 <b>{fmtBytes(totals.mediaBytes)}</b>
                </span>
              </div>
              {blocked.length > 0 && (
                <p className="proj-error" data-delete-blocked>
                  {blocked
                    .map(
                      (p) =>
                        `${p.name} 还有 ${p.activeJobs.length} 个进行中的发布任务（${p.activeJobs
                          .map((j) => `${j.platform}/${j.state}`)
                          .join('、')}）`,
                    )
                    .join('；')}
                  ，请先处理或取消。
                </p>
              )}
              <label className="proj-field">
                <span>{batch ? '输入选中数量' : '输入项目名'}确认</span>
                <input
                  data-delete-confirm-input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={expectedConfirm}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && confirmOk) void confirmDelete()
                  }}
                />
              </label>
              <p className="st-hint">删除不可撤销；数据库行会先写成快照，媒体文件不随快照恢复。</p>
            </>
          )}
          <div className="proj-confirm-actions">
            <span className="spacer" />
            <button className="btn" onClick={cancelDelete} disabled={deleting} data-delete-confirm-cancel>
              取消
            </button>
            <button
              className="btn danger"
              data-delete-confirm-submit
              disabled={!confirmOk || deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      )}
    </>
  )

  if (variant === 'inline') {
    return <section className="proj-manager-inline" data-project-manager>{body}</section>
  }

  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={() => !deleting && onClose?.()}>
      <div
        className="st-modal proj-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-label="项目管理"
        data-project-manager
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="st-modal-head">
          <div>
            <h3>项目管理</h3>
            <p className="st-hint">
              删除会级联清理镜头、角色、素材、聊天、成片与发布记录，并在项目根目录留下数据库快照。
            </p>
          </div>
          <span className="spacer" />
          <button className="btn-mini" onClick={onClose} title="关闭" data-manager-close>
            ✕
          </button>
        </header>
        <div className="proj-manager-body">{body}</div>
      </div>
    </div>
  )
}
