import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../api'
import type { CreativeArtifact } from './sessionStore'
import { promoteCreativeArtifact } from './mediaApi'

/** 晋升确认：新建或写入现有项目；两种都需要显式确认 */
export function PromoteDialog({
  artifact,
  settings,
  onClose,
  onDone,
}: {
  artifact: CreativeArtifact
  settings: AppSettings | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const payload = (artifact.payload || {}) as { shots?: Array<{ start: number; end: number }> }
  const shotCount = payload.shots?.length ?? 0
  const [target, setTarget] = useState<'new' | 'existing'>('new')
  const [projectName, setProjectName] = useState('')
  const [title, setTitle] = useState(artifact.title || '')
  const [aspect, setAspect] = useState('9:16')
  const [episode, setEpisode] = useState(1)
  const [projects, setProjects] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/project')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        setProjects(Array.isArray(j?.projects) ? j.projects.map((p: { name: string }) => p.name) : [])
      })
      .catch(() => {
        /* 列表失败不阻止新建 */
      })
    return () => {
      alive = false
    }
  }, [])

  const suggested = useMemo(() => {
    const base = (artifact.title || 'creative').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    return (base || 'creative').slice(0, 32).toLowerCase()
  }, [artifact.title])

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      const name = target === 'new' ? projectName.trim() || suggested : projectName.trim()
      if (!name) throw new Error('请选择或填写项目名')
      const r = await promoteCreativeArtifact({
        artifactId: artifact.id,
        target,
        projectName: name,
        title: title.trim() || artifact.title,
        aspect,
        episode,
      })
      onDone(
        r.created
          ? `已新建项目「${r.projectName}」并写入 ${r.shots} 镜`
          : `已写入「${r.projectName}」：新增 ${r.newShots ?? 0} 镜，更新 ${r.updated ?? 0} 镜`,
      )
    } catch (e) {
      setError((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="creative-dialog-scrim" role="dialog" aria-modal="true" aria-label="晋升项目">
      <div className="creative-dialog" data-promote-dialog>
        <h3>晋升到项目</h3>
        <p className="creative-dialog-note">
          将把 {shotCount} 镜的首帧与运动提示词写入项目；已有镜头的手改字段不会被覆盖。
        </p>
        <div className="creative-dialog-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={target === 'new'}
            className={target === 'new' ? 'on' : ''}
            onClick={() => setTarget('new')}
          >
            新建项目
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={target === 'existing'}
            className={target === 'existing' ? 'on' : ''}
            onClick={() => setTarget('existing')}
          >
            写入现有项目
          </button>
        </div>

        {target === 'new' ? (
          <>
            <label className="creative-dialog-field">
              <span>项目名（字母/数字/-/_）</span>
              <input
                data-promote-name
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={suggested}
              />
            </label>
            <label className="creative-dialog-field">
              <span>项目标题</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="creative-dialog-field">
            <span>目标项目</span>
            <select value={projectName} onChange={(e) => setProjectName(e.target.value)}>
              <option value="">选择项目…</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex gap-2">
          <label className="creative-dialog-field flex-1">
            <span>画幅</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1</option>
            </select>
          </label>
          <label className="creative-dialog-field w-24">
            <span>集号</span>
            <input
              type="number"
              min={1}
              value={episode}
              onChange={(e) => setEpisode(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

        <div className="creative-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" data-promote-confirm className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '写入中…' : '确认晋升'}
          </button>
        </div>
      </div>
    </div>
  )
}
