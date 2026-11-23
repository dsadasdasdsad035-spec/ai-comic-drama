import { useEffect, useMemo, useState } from 'react'
import {
  importPromptCases,
  listPromptCaseSources,
  previewPromptCases,
  type PromptCasePreview,
  type PromptCasePreviewItem,
  type PromptCaseSourceInfo,
} from './api'

/**
 * 导入外部案例：先预览再提交。
 *
 * 预览只拿摘要与令牌，提交只传 token + 勾选的 id —— 客户端不拼任何抓取地址。
 */
export default function ImportDialog({
  open,
  onClose,
  onImported,
  toast,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
  toast: (m: string) => void
}) {
  const [sources, setSources] = useState<PromptCaseSourceInfo[]>([])
  const [source, setSource] = useState('vflow')
  const [q, setQ] = useState('')
  const [model, setModel] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [unmappedOnly, setUnmappedOnly] = useState(false)
  const [limit, setLimit] = useState(24)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PromptCasePreview | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    listPromptCaseSources()
      .then((list) => {
        if (!alive) return
        setSources(list)
        const firstEnabled = list.find((s) => s.enabled)
        if (firstEnabled) setSource(firstEnabled.id)
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setPicked(new Set())
      setError('')
      setResult('')
    }
  }, [open])

  const enabledSources = useMemo(() => sources.filter((s) => s.enabled), [sources])
  const disabledSources = useMemo(() => sources.filter((s) => !s.enabled), [sources])
  // 「仅看未映射」只影响展示，不改变勾选集合：用户可以先把未映射的处理掉，再回来全选
  const visibleItems = useMemo(
    () => (preview?.items || []).filter((it) => !unmappedOnly || (it.unmapped?.length || 0) > 0),
    [preview, unmappedOnly],
  )
  const allPicked = Boolean(visibleItems.length) && visibleItems.every((i) => picked.has(i.id))

  if (!open) return null

  const runPreview = async () => {
    setBusy('preview')
    setError('')
    setResult('')
    try {
      const p = await previewPromptCases({ source, q: q.trim(), model, category, limit })
      setPreview(p)
      setCategories(p.categories || [])
      setPicked(new Set(p.items.map((i) => i.id)))
    } catch (e) {
      setPreview(null)
      setError((e as Error).message || '预览失败')
    } finally {
      setBusy('')
    }
  }

  const submit = async () => {
    if (!preview || picked.size === 0) return
    setBusy('import')
    setError('')
    try {
      const r = await importPromptCases({ source: preview.source, token: preview.token, ids: [...picked] })
      setResult(
        `新增 ${r.created} 条，更新 ${r.updated} 条，写入 ${r.facetsWritten} 个分面${
          r.failed.length ? `，${r.failed.length} 条失败` : ''
        }`,
      )
      onImported()
      toast(`已导入 ${r.created} 条案例`)
    } catch (e) {
      setError((e as Error).message || '导入失败')
    } finally {
      setBusy('')
    }
  }

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="mp-backdrop"
      data-prompt-case-import-backdrop
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="mp-dialog pc-import-dialog" role="dialog" aria-modal="true" aria-label="导入外部案例">
        <header className="mp-head">
          <div>
            <b>导入外部案例</b>
            <span>先预览，勾选后再入库；只保存提示词与外链，不下载媒体</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" disabled={Boolean(busy)} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="pc-import-body">
          <div className="pc-import-row">
            <label className="pc-field">
              <span>来源</span>
              <select
                data-prompt-case-import-source
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  setPreview(null)
                  setCategories([])
                  setCategory('')
                  setResult('')
                }}
                disabled={Boolean(busy)}
              >
                {enabledSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
                {enabledSources.length === 0 ? <option value="">没有已启用的来源</option> : null}
              </select>
            </label>
            <label className="pc-field grow">
              <span>关键词（标题 / 作者 / 分类）</span>
              <input
                data-prompt-case-import-q
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如 rain alley、claymation"
                disabled={Boolean(busy)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runPreview()
                }}
              />
            </label>
            <label className="pc-field">
              <span>分类</span>
              <select
                data-prompt-case-import-category
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setResult('')
                }}
                disabled={Boolean(busy)}
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="pc-field">
              <span>条数</span>
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={Boolean(busy)}>
                {[12, 24, 40, 60].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {disabledSources.length ? (
            <details className="pc-import-disabled">
              <summary>{disabledSources.length} 个来源未启用</summary>
              <ul>
                {disabledSources.map((s) => (
                  <li key={s.id}>
                    <b>{s.label}</b>：{s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="pc-import-actions">
            <button
              type="button"
              className="btn primary"
              data-prompt-case-import-preview
              disabled={Boolean(busy) || !source}
              onClick={() => void runPreview()}
            >
              {busy === 'preview' ? '拉取中…' : '预览'}
            </button>
            {preview ? (
              <>
                <span className="board-hint">
                  命中 {preview.total} 条，已取 {preview.items.length} 条
                </span>
                <button
                  type="button"
                  className="btn-mini ghost"
                  onClick={() =>
                    setPicked(allPicked ? new Set() : new Set(visibleItems.map((i) => i.id)))
                  }
                >
                  {allPicked ? '全不选' : '全选'}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-prompt-case-import-submit
                  disabled={Boolean(busy) || picked.size === 0}
                  onClick={() => void submit()}
                >
                  {busy === 'import' ? '导入中…' : `导入 ${picked.size} 条`}
                </button>
              </>
            ) : null}
          </div>

          {error ? <p className="board-hint pc-import-error">{error}</p> : null}
          {result ? <p className="board-hint pc-import-ok">{result}</p> : null}

          {preview ? (
            <>
              <div className="pc-import-filters">
                {preview.models.length ? (
                  <label className="pc-field">
                    <span>模型</span>
                    <select value={model} onChange={(e) => setModel(e.target.value)} disabled={Boolean(busy)}>
                      <option value="">全部</option>
                      {preview.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="pc-field pc-check">
                  <input
                    type="checkbox"
                    data-prompt-case-import-unmapped-only
                    checked={unmappedOnly}
                    onChange={(e) => setUnmappedOnly(e.target.checked)}
                  />
                  <span>仅看未映射</span>
                </label>
                <span className="board-hint">改筛选后需重新预览</span>
              </div>

              <ul className="pc-import-list" data-prompt-case-import-list>
                {visibleItems.map((it: PromptCasePreviewItem) => (
                  <li key={it.id} className={picked.has(it.id) ? 'on' : ''}>
                    <label>
                      <input
                        type="checkbox"
                        checked={picked.has(it.id)}
                        onChange={() => toggle(it.id)}
                        disabled={Boolean(busy)}
                      />
                      {it.posterUrl ? <img src={it.posterUrl} alt="" loading="lazy" /> : <span className="pc-import-ph" />}
                      <span className="pc-import-text">
                        <b>{it.title || '(无标题)'}</b>
                        <em>
                          {[it.model, it.category, it.author].filter(Boolean).join(' · ') || '—'}
                        </em>
                        <span className="pc-import-facets">
                          {(it.facets || []).slice(0, 5).map((f) => (
                            <span key={`${f.axis}:${f.value}`} className="pc-facet-tag">
                              {f.value}
                            </span>
                          ))}
                          {it.unmapped?.length ? (
                            <span
                              className="pc-facet-tag unmapped"
                              data-import-unmapped
                              title={it.unmapped.join('、')}
                            >
                              未映射 {it.unmapped.length}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <footer className="mp-foot">
          <button type="button" className="btn-mini" disabled={Boolean(busy)} onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
