import { useCallback, useEffect, useMemo, useState } from 'react'
import StockBrowser from './StockBrowser'
import {
  filterStockLinks,
  loadCustomStockLinks,
  mergeStockLinks,
  newCustomLinkId,
  saveCustomStockLinks,
  type StockLinkEntry,
} from './stockCatalog'
import type { StockImportResult, StockImportTarget, StockItem, StockProviderId } from './types'

const PAGE_SIZE = 12

type Props = {
  projectName: string
  mode: 'picker' | 'library'
  onPicked?: (result: StockImportResult, item: StockItem) => void
  onImported?: (result: StockImportResult, item: StockItem, target: StockImportTarget) => void
  toast?: (m: string) => void
}

/**
 * 在线素材列表：推荐站点卡片（描述 + 图 + 外链），可搜索、分页、添加自定义；
 * 支持进入单来源的站内检索导入（StockBrowser）。
 */
export default function OnlineStockList({ projectName, mode, onPicked, onImported, toast }: Props) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [custom, setCustom] = useState<StockLinkEntry[]>(() => loadCustomStockLinks())
  const [browseProvider, setBrowseProvider] = useState<StockProviderId | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState({ title: '', description: '', href: '', imageUrl: '' })

  const all = useMemo(() => mergeStockLinks(custom), [custom])
  const filtered = useMemo(() => filterStockLinks(all, query), [all, query])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const slice = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, pageSafe])

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const removeCustom = useCallback(
    (id: string) => {
      const next = custom.filter((c) => c.id !== id)
      setCustom(next)
      saveCustomStockLinks(next)
      toast?.('已删除自定义条目')
    },
    [custom, toast],
  )

  const submitAdd = () => {
    const title = draft.title.trim()
    const href = draft.href.trim()
    if (!title || !href) {
      toast?.('请填写标题与链接')
      return
    }
    try {
      const u = new URL(href)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
    } catch {
      toast?.('链接须为 http 或 https')
      return
    }
    const entry: StockLinkEntry = {
      id: newCustomLinkId(),
      title,
      description: draft.description.trim() || '自定义素材站点',
      href,
      imageUrl: draft.imageUrl.trim() || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(href).hostname)}&sz=128`,
      tags: ['自定义'],
      builtin: false,
    }
    const next = [...custom, entry]
    setCustom(next)
    saveCustomStockLinks(next)
    setAddOpen(false)
    setDraft({ title: '', description: '', href: '', imageUrl: '' })
    toast?.('已添加到在线素材列表')
  }

  if (browseProvider) {
    return (
      <div className="online-stock-list" data-online-stock-list>
        <div className="online-stock-import-head">
          <button type="button" className="btn-ghost" data-online-stock-back onClick={() => setBrowseProvider(null)}>
            ← 返回列表
          </button>
          <span className="board-hint">站内检索并导入到当前项目</span>
        </div>
        <StockBrowser
          projectName={projectName}
          mode={mode}
          initialProvider={browseProvider}
          onPicked={onPicked}
          onImported={onImported}
          toast={toast}
        />
      </div>
    )
  }

  return (
    <div className="online-stock-list" data-online-stock-list>
      <div className="online-stock-toolbar">
        <input
          className="stock-search"
          data-online-stock-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索站点名称、说明或标签"
          aria-label="搜索在线素材列表"
        />
        <button type="button" className="btn" data-online-stock-add onClick={() => setAddOpen(true)}>
          + 添加
        </button>
      </div>

      <p className="stock-note">点击卡片标题区打开官网；已配置 Key 的来源可点「站内检索」下载到项目。</p>

      <div className="online-stock-cards" data-online-stock-cards>
        {slice.length === 0 ? (
          <div className="stock-empty">没有匹配的站点，换个关键词或添加自定义链接。</div>
        ) : (
          slice.map((item) => (
            <article key={item.id} className="online-stock-card" data-online-stock-card={item.id}>
              <a
                className="online-stock-card-media"
                href={item.href}
                target="_blank"
                rel="noreferrer"
                title={`打开 ${item.title}`}
              >
                <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
              </a>
              <div className="online-stock-card-body">
                <a className="online-stock-card-title" href={item.href} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <p className="online-stock-card-desc">{item.description}</p>
                {item.tags?.length ? (
                  <div className="online-stock-card-tags">
                    {item.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                ) : null}
                <div className="online-stock-card-actions">
                  {item.providerId ? (
                    <button
                      type="button"
                      className="btn-mini"
                      data-online-stock-browse={item.providerId}
                      onClick={() => setBrowseProvider(item.providerId!)}
                    >
                      站内检索
                    </button>
                  ) : null}
                  <a className="btn-mini ghost" href={item.href} target="_blank" rel="noreferrer">
                    打开站点
                  </a>
                  {!item.builtin ? (
                    <button type="button" className="btn-mini danger" onClick={() => removeCustom(item.id)}>
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="online-stock-pager" data-online-stock-pager>
          <button
            type="button"
            className="btn-mini"
            disabled={pageSafe <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span>
            第 {pageSafe} / {totalPages} 页 · 共 {filtered.length} 条
          </span>
          <button
            type="button"
            className="btn-mini"
            disabled={pageSafe >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      ) : filtered.length > 0 ? (
        <div className="online-stock-pager muted">
          <span>共 {filtered.length} 条</span>
        </div>
      ) : null}

      {addOpen ? (
        <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="mp-dialog online-stock-add-dialog" role="dialog" aria-modal="true" aria-label="添加素材站点">
            <header className="mp-head">
              <b>添加素材站点</b>
              <button type="button" className="mp-close" aria-label="关闭" onClick={() => setAddOpen(false)}>
                ×
              </button>
            </header>
            <div className="online-stock-add-form">
              <label>
                <span>标题</span>
                <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              </label>
              <label>
                <span>说明</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>
              <label>
                <span>跳转链接</span>
                <input value={draft.href} onChange={(e) => setDraft((d) => ({ ...d, href: e.target.value }))} placeholder="https://…" />
              </label>
              <label>
                <span>封面图 URL（可选）</span>
                <input
                  value={draft.imageUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, imageUrl: e.target.value }))}
                  placeholder="留空则用站点图标"
                />
              </label>
              <div className="online-stock-add-actions">
                <button type="button" className="btn" onClick={submitAdd}>
                  保存
                </button>
                <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}