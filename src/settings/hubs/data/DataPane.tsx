import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteProjects,
  listProjects,
  previewProjectDeletes,
  type ProjectDeletePreview,
  type ProjectSummary,
} from '../../../api'
import type { SettingsWorkbench } from '../../useSettingsWorkbench'

type Props = { wb: SettingsWorkbench }

/** 字节转可读体积；0 直接说 0，避免显示成 0.0 MB */
function fmtBytes(n: number): string {
  const v = Number(n) || 0
  if (v <= 0) return '0'
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 时间只留到分钟：这一列是「多久没动过」，秒没有意义 */
function fmtTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 数据设置页：项目清理与数据库路径。
 *
 * 删除走「先预览后确认」：预览拿到的 mediaBytes 是删除后真正释放的空间，
 * 确认框里给用户看的是这个数，而不是项目数量的模糊描述。
 */
export function DataPane({ wb }: Props) {
  const [root, setRoot] = useState('')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [bytes, setBytes] = useState<Record<string, number>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const current = wb.currentProjectName || ''

  const reload = useCallback(async () => {
    setBusy('reload')
    setError('')
    try {
      const r = await listProjects()
      setRoot(r.root)
      setProjects(r.projects)
      setPicked((cur) => cur.filter((n) => r.projects.some((p) => p.name === n)))
      // 占用体积只有预览接口给：批量算一次，别在渲染里逐个请求
      if (r.projects.length) {
        try {
          const items = await previewProjectDeletes(r.projects.map((p) => p.name))
          const next: Record<string, number> = {}
          for (const it of items) next[it.name] = Number(it.mediaBytes) || 0
          setBytes(next)
        } catch {
          // 体积只是参考信息：算不出来不该让整页报错
          setBytes({})
        }
      } else {
        setBytes({})
      }
    } catch (e) {
      setError((e as Error).message || '读取项目列表失败')
      setProjects([])
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const pickedBytes = useMemo(
    () => picked.reduce((sum, n) => sum + (bytes[n] || 0), 0),
    [picked, bytes],
  )

  const allChecked = projects.length > 0 && picked.length === projects.length

  const toggle = (name: string, on: boolean) => {
    // 当前打开的项目不让删：删了画布会指向不存在的工程
    if (name === current) return
    setPicked((cur) => (on ? [...cur, name] : cur.filter((n) => n !== name)))
  }

  const removePicked = async () => {
    const names = picked.filter((n) => n !== current)
    if (!names.length) return
    const line = `删除 ${names.length} 个项目，释放约 ${fmtBytes(pickedBytes)}？\n\n项目媒体会被一并删除，无法撤销。`
    if (!window.confirm(line)) return
    setBusy('delete')
    setError('')
    try {
      const r = await deleteProjects(names)
      const done = r.deleted || []
      const failed = (r.results || []).filter((x) => !x.ok)
      if (failed.length) {
        // 失败项逐条报原因：active_jobs 与 not_found 的处理方式不一样，不能合并成一句
        const why = failed.map((f) => `${f.name}：${f.message || f.code || '失败'}`).join('；')
        setError(`${failed.length} 个项目没删成 —— ${why}`)
      }
      if (done.length) {
        setPicked((cur) => cur.filter((n) => !done.includes(n)))
        await wb.onProjectsDeleted?.(done)
        wb.toast(`已删除 ${done.length} 个项目`)
      }
      await reload()
    } catch (e) {
      setError((e as Error).message || '删除项目失败')
    } finally {
      setBusy('')
    }
  }

  const totalBytes = useMemo(
    () => projects.reduce((sum, p) => sum + (bytes[p.name] || 0), 0),
    [projects, bytes],
  )

  return (
    <section className="st-sec" data-settings-pane="data">
      <header className="st-sec-head">
        <h3>数据</h3>
        <span className="st-hint">项目清理与数据库路径。删除会连同项目媒体一起移除，不可撤销。</span>
        <span className="spacer" />
        <button type="button" className="btn" data-data-refresh disabled={busy === 'reload'} onClick={() => void reload()}>
          {busy === 'reload' ? '读取中…' : '刷新'}
        </button>
      </header>

      <div className="st-grid">
        <label className="st-field">
          <span>存储目录</span>
          <input readOnly value={root} placeholder="（读取中）" data-data-root />
          <em>项目库与媒体都在这下面；换目录要改启动参数，不在这里改</em>
        </label>
        <label className="st-field">
          <span>数据库文件</span>
          <input readOnly value={root ? `${root}/storyboard.sqlite` : ''} placeholder="（读取中）" data-data-db />
          <em>SQLite 单文件，备份时项目目录与它一起拷走</em>
        </label>
      </div>

      {error ? <p className="st-error" data-data-error>{error}</p> : null}

      <div className="data-pane-head">
        <h4 className="st-subhead">项目清理</h4>
        <span className="st-hint" data-data-summary>
          共 {projects.length} 个项目 · 媒体合计 {fmtBytes(totalBytes)}
          {picked.length ? ` · 已选 ${picked.length} 个（${fmtBytes(pickedBytes)}）` : ''}
        </span>
        <span className="spacer" />
        <button type="button" className="btn-mini ghost" data-data-clear-pick disabled={!picked.length} onClick={() => setPicked([])}>
          清空选择
        </button>
        <button type="button" className="btn-mini danger" data-data-delete disabled={!picked.length || busy === 'delete'} onClick={() => void removePicked()}>
          {busy === 'delete' ? '删除中…' : '删除所选'}
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="st-hint" data-data-empty>
          {busy === 'reload' ? '正在读取项目…' : '还没有项目。回到大厅新建一个就会出现在这里。'}
        </p>
      ) : (
        <div className="data-pane-wrap">
          <table className="data-pane-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全选项目"
                    checked={allChecked}
                    onChange={(e) => setPicked(e.target.checked ? projects.filter((p) => p.name !== current).map((p) => p.name) : [])}
                  />
                </th>
                <th>项目</th>
                <th>镜头</th>
                <th>时长</th>
                <th>占用</th>
                <th>最后修改</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const isCurrent = p.name === current
                return (
                  <tr key={p.name} data-data-project={p.name} className={isCurrent ? 'on' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${p.name}`}
                        checked={picked.includes(p.name)}
                        // 当前项目不能删，但选择框仍可读，禁用比隐藏更容易理解
                        disabled={isCurrent}
                        title={isCurrent ? '当前打开的项目不能删除' : ''}
                        onChange={(e) => toggle(p.name, e.target.checked)}
                      />
                    </td>
                    <td>
                      <div className="data-pane-name">{p.title || p.name}</div>
                      <div className="data-pane-sub">
                        {p.name}
                        {isCurrent ? <span className="data-pane-tag">当前</span> : null}
                        {p.broken ? <span className="data-pane-tag bad">损坏</span> : null}
                      </div>
                    </td>
                    <td>{p.shots || 0}</td>
                    <td>{Math.round(Number(p.seconds) || 0)} 秒</td>
                    <td>{fmtBytes(bytes[p.name] || 0)}</td>
                    <td>{fmtTime(p.updated_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
