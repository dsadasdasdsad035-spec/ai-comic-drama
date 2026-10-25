import { useEffect, useMemo, useState } from 'react'
import type { Cap, ModelEntry, Provider } from '../api'
import { CAP_LABELS } from '../modelCaps'

export type CatalogEntry = {
  id: string
  category: 'chat' | 'image' | 'video' | 'audio' | 'unknown'
  tags: string[]
  suggestedCaps: Cap[]
  runtime: 'ready' | 'catalog-only'
  reason?: string
  features?: Record<string, unknown>
}

type Props = {
  provider: Provider
  models: ModelEntry[]
  onClose: () => void
  onApply: (entries: CatalogEntry[]) => { added: number; updated: number; skipped: number }
}

const TABS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'chat', label: '对话' },
  { id: 'image', label: '图像' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
]

export default function CatalogDialog({ provider, models, onClose, onApply }: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number } | null>(null)

  const existing = useMemo(
    () => new Set(models.filter((m) => m.provider === provider.id).map((m) => m.model)),
    [models, provider.id],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/provider-catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: provider.id, provider }),
        })
        const j = await r.json()
        if (!alive) return
        if (!j.ok) {
          throw Object.assign(new Error(j.message || '读取目录失败'), { kind: j.kind })
        }
        const list = (j.entries || []) as CatalogEntry[]
        setEntries(list)
        setSelected(
          new Set(
            list
              .filter(
                (e) =>
                  e.runtime === 'ready' &&
                  e.suggestedCaps?.length > 0 &&
                  !existing.has(e.id),
              )
              .map((e) => e.id),
          ),
        )
      } catch (e) {
        if (!alive) return
        const err = e as Error & { kind?: string }
        setError(
          err.kind === 'billing'
            ? `余额不足，充值后可同步：${err.message}`
            : err.kind === 'auth'
              ? `Key 无效或无权限：${err.message}`
              : err.kind === 'no-key'
                ? '这个渠道还没有 APIMart API Key'
                : err.message || '读取目录失败',
        )
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [provider, existing])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (tab !== 'all' && e.category !== tab) return false
      if (q && !e.id.toLowerCase().includes(q) && !e.tags.join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, tab, search])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: entries.length }
    for (const e of entries) m[e.category] = (m[e.category] || 0) + 1
    return m
  }, [entries])

  const selectable = visible.filter((e) => e.suggestedCaps?.length > 0)
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) selectable.forEach((e) => next.delete(e.id))
      else selectable.forEach((e) => next.add(e.id))
      return next
    })
  }

  const apply = () => {
    const picked = entries.filter((e) => selected.has(e.id))
    if (!picked.length) return
    const r = onApply(picked)
    setResult(r)
    setSelected(new Set())
  }

  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="st-modal"
        role="dialog"
        aria-modal="true"
        aria-label="同步模型目录"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="st-modal-head">
          <div>
            <h3>同步模型目录</h3>
            <p className="st-hint">
              {provider.label} · 目录来自 {provider.baseUrl || 'APIMart'}
            </p>
          </div>
          <button className="btn-mini" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>

        {loading && <div className="st-modal-state">正在读取目录…</div>}
        {error && <div className="st-modal-error">{error}</div>}
        {!loading && !error && (
          <>
            <div className="st-catalog-toolbar">
              <div className="st-tabs">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={tab === t.id ? 'on' : ''}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                    <span>{counts[t.id] || 0}</span>
                  </button>
                ))}
              </div>
              <input
                className="st-search"
                placeholder="搜索模型 ID / 标签"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {result && (
              <div className="st-catalog-result">
                已加入草稿：新增 {result.added} · 更新 {result.updated} · 跳过 {result.skipped}
                <span>保存设置后生效</span>
              </div>
            )}

            <div className="st-catalog-list">
              <div className="st-catalog-row head">
                <label className="chk" title="全选本页">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </label>
                <span>模型</span>
                <span>能力</span>
                <span>状态</span>
              </div>
              {visible.map((e) => {
                const already = existing.has(e.id)
                const disabled = !e.suggestedCaps?.length
                return (
                  <label
                    key={e.id}
                    className={`st-catalog-row ${disabled ? 'disabled' : ''}`}
                    data-catalog-id={e.id}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                    <span className="st-catalog-id">
                      {e.id}
                      <em>{e.category}</em>
                    </span>
                    <span className="st-catalog-caps">
                      {e.suggestedCaps?.length
                        ? e.suggestedCaps.map((c) => CAP_LABELS[c]).join(' / ')
                        : '未映射'}
                    </span>
                    <span>
                      {already ? <b className="st-badge">已存在</b> : null}
                      {e.runtime === 'catalog-only' ? (
                        <b className="st-badge bad" title={e.reason}>
                          未接入
                        </b>
                      ) : (
                        <b className="st-badge ok">可运行</b>
                      )}
                    </span>
                  </label>
                )
              })}
              {visible.length === 0 && <div className="st-modal-state">没有匹配的模型</div>}
            </div>

            <footer className="st-modal-foot">
              <span className="st-hint">已选 {selected.size} 个</span>
              <span className="spacer" />
              <button className="btn-mini" onClick={() => setSelected(new Set())} disabled={!selected.size}>
                清空
              </button>
              <button className="btn primary" onClick={apply} disabled={!selected.size}>
                同步 {selected.size} 个模型
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
