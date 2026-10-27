import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchStockProviders,
  importStockItem,
  searchStockItems,
  stockErrorMessage,
  StockRequestError,
} from './api'
import { stockAttributionText, stockDurationText, stockLicenseLabel, stockSizeText } from './stockFormat'
import type {
  StockImportResult,
  StockImportTarget,
  StockItem,
  StockMediaType,
  StockProviderId,
  StockProviderInfo,
} from './types'

const MEDIA_LABEL: Record<StockMediaType, string> = { image: '图片', video: '视频', audio: '音频' }

type Props = {
  /** 当前项目；空串表示未选项目，可以浏览但不能导入 */
  projectName: string
  mode: 'picker' | 'library'
  /** picker 模式：导入成功后把本地地址交给选择器 */
  onPicked?: (result: StockImportResult, item: StockItem) => void
  /** library 模式：导入结果交给素材页决定落点 */
  onImported?: (result: StockImportResult, item: StockItem, target: StockImportTarget) => void
  toast?: (m: string) => void
}

/**
 * 在线素材浏览器：检索、预览、授权信息与导入。
 *
 * 检索只在显式提交时发起（在线来源额度很紧），分页追加保留已选项；
 * 导入只提交令牌，服务端决定真实下载地址。
 */
export default function StockBrowser({ projectName, mode, onPicked, onImported, toast }: Props) {
  const [providers, setProviders] = useState<StockProviderInfo[]>([])
  const [providersError, setProvidersError] = useState('')
  const [provider, setProvider] = useState<StockProviderId | ''>('')
  const [mediaType, setMediaType] = useState<StockMediaType>('image')
  const [query, setQuery] = useState('')
  /** 提交时的关键词：只认它，不认输入框的实时值 */
  const [submitted, setSubmitted] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<StockItem[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [cached, setCached] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<StockItem | null>(null)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<Record<string, StockImportResult>>({})
  const [target, setTarget] = useState<StockImportTarget>('asset')
  const [copied, setCopied] = useState('')
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetchStockProviders()
      .then((list) => {
        if (!alive) return
        setProviders(list)
        const first = list.find((p) => p.ok) || list[0]
        if (first) {
          setProvider(first.id)
          setMediaType(first.mediaTypes[0])
        }
      })
      .catch((e) => {
        if (alive) setProvidersError(stockErrorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [])

  const current = providers.find((p) => p.id === provider)
  const canSearch = Boolean(provider) && query.trim().length >= 2 && Boolean(current?.ok)

  const selectProvider = (id: StockProviderId) => {
    const next = providers.find((p) => p.id === id)
    setProvider(id)
    setItems([])
    setSelected(null)
    setTotal(undefined)
    setHasMore(false)
    setError('')
    setSubmitted('')
    if (next) setMediaType(next.mediaTypes[0])
  }

  const runSearch = useCallback(
    async (nextPage: number, keyword: string) => {
      if (!provider || keyword.trim().length < 2) return
      setSearching(true)
      setError('')
      try {
        const r = await searchStockItems({
          provider,
          mediaType,
          query: keyword.trim(),
          page: nextPage,
          perPage: 24,
        })
        setItems((prev) => (nextPage === 1 ? r.items : [...prev, ...r.items]))
        setTotal(r.total)
        setHasMore(r.hasMore)
        setCached(r.cached)
        setPage(nextPage)
        setSubmitted(keyword.trim())
        if (nextPage === 1) setSelected(r.items[0] ?? null)
      } catch (e) {
        // 限流/鉴权不是空结果，保留旧列表并显示原因
        setError(stockErrorMessage(e))
        if (nextPage === 1) {
          setItems([])
          setSelected(null)
        }
      } finally {
        setSearching(false)
      }
    },
    [provider, mediaType],
  )

  const submit = () => {
    if (!canSearch) return
    void runSearch(1, query)
  }

  const loadMore = () => {
    if (!hasMore || searching || !submitted) return
    void runSearch(page + 1, submitted)
  }

  const changeMediaType = (t: StockMediaType) => {
    setMediaType(t)
    setItems([])
    setSelected(null)
    setHasMore(false)
    setTotal(undefined)
    setError('')
    setSubmitted('')
  }

  const importSelected = async () => {
    if (!selected || !projectName || importing) return
    setImporting(true)
    try {
      const r = await importStockItem({ project: projectName, token: selected.token })
      setImported((prev) => ({ ...prev, [selected.itemId]: r }))
      if (mode === 'picker') onPicked?.(r, selected)
      else onImported?.(r, selected, target)
      toast?.(r.reused ? '已在项目里，复用已有素材' : `已下载到项目：${selected.title}`)
    } catch (e) {
      const msg = stockErrorMessage(e)
      setError(msg)
      toast?.(msg)
      // 令牌过期：提示重新检索，但不自动重发请求
      if (e instanceof StockRequestError && e.kind === 'expired') setSubmitted('')
    } finally {
      setImporting(false)
    }
  }

  const copyAttribution = async () => {
    if (!selected) return
    const text = stockAttributionText(selected.license, { author: selected.author, source: selected.provider })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(selected.itemId)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      toast?.('复制失败，请手动选择署名文本')
    }
  }

  const targetOptions = useMemo<{ v: StockImportTarget; label: string }[]>(() => {
    if (mediaType === 'image') {
      return [
        { v: 'asset', label: '普通素材卡' },
        { v: 'scene', label: '场景设定' },
        { v: 'prop', label: '道具设定' },
      ]
    }
    return [{ v: 'asset', label: mediaType === 'video' ? '视频素材卡' : '音频素材卡' }]
  }, [mediaType])

  useEffect(() => {
    if (!targetOptions.some((o) => o.v === target)) setTarget(targetOptions[0].v)
  }, [targetOptions, target])

  return (
    <div className="stock-browser" data-stock-browser>
      <div className="stock-bar">
        <div className="stock-providers" role="tablist" aria-label="素材来源">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={provider === p.id}
              data-stock-provider={p.id}
              className={provider === p.id ? 'on' : ''}
              title={p.ok ? p.label : p.reason}
              onClick={() => selectProvider(p.id)}
            >
              {p.label}
              {p.keyFromEnv ? <span className="stock-env-badge">ENV</span> : null}
              {!p.ok ? <span className="stock-off-badge">不可用</span> : null}
            </button>
          ))}
        </div>
        <div className="stock-types" role="group" aria-label="媒体类型">
          {(current?.mediaTypes ?? (['image', 'video', 'audio'] as StockMediaType[])).map((t) => (
            <button
              key={t}
              type="button"
              data-stock-type={t}
              className={mediaType === t ? 'on' : ''}
              onClick={() => changeMediaType(t)}
            >
              {MEDIA_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="stock-search-row">
        <input
          className="stock-search"
          data-stock-query
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="输入关键词后回车检索（至少 2 个字符）"
          aria-label="在线素材关键词"
        />
        <button type="button" className="btn" data-stock-search disabled={!canSearch || searching} onClick={submit}>
          {searching ? '检索中…' : '搜索'}
        </button>
      </div>

      {providersError ? <div className="stock-note stock-error">{providersError}</div> : null}
      {current && !current.ok ? (
        <div className="stock-note stock-error">
          {current.label} 不可用：{current.reason}
        </div>
      ) : null}
      {error ? <div className="stock-note stock-error" data-stock-error>{error}</div> : null}

      <div className="stock-body">
        <div className="stock-grid" data-stock-grid>
          {searching && items.length === 0 ? (
            <div className="stock-empty">正在检索…</div>
          ) : items.length === 0 ? (
            <div className="stock-empty">
              {submitted ? '没有匹配的素材，换个关键词试试' : '输入关键词检索在线素材'}
            </div>
          ) : (
            items.map((item) => {
              const result = imported[item.itemId]
              return (
                <button
                  key={item.itemId}
                  type="button"
                  data-stock-item={item.itemId}
                  className={`stock-tile ${selected?.itemId === item.itemId ? 'on' : ''}`}
                  aria-pressed={selected?.itemId === item.itemId}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => {
                    setSelected(item)
                    if (mode === 'picker' && projectName && !importing) void importSelected()
                  }}
                >
                  <span className="stock-thumb">
                    {item.mediaType === 'audio' ? (
                      <span className="stock-audio-badge" aria-hidden="true">
                        ♪ {stockDurationText(item.duration)}
                      </span>
                    ) : (
                      // 在线缩略图不预解码全部列表
                      <img src={item.thumbnailUrl || item.previewUrl} alt="" loading="lazy" decoding="async" />
                    )}
                    <span className={`stock-kind stock-kind-${item.mediaType}`}>{MEDIA_LABEL[item.mediaType]}</span>
                    {result ? <span className="stock-imported-badge">{result.reused ? '已存在' : '已导入'}</span> : null}
                  </span>
                  <span className="stock-tile-title">{item.title}</span>
                  <span className="stock-tile-sub">
                    {item.author || '未署名'} · {stockLicenseLabel(item.license)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="stock-detail" ref={detailRef} data-stock-detail>
          {selected ? (
            <>
              <div className="stock-detail-head">
                <b>{selected.title}</b>
                <span>
                  {selected.provider} · {MEDIA_LABEL[selected.mediaType]}
                </span>
              </div>
              <div className="stock-preview">
                {selected.mediaType === 'image' ? (
                  <img src={selected.previewUrl || selected.thumbnailUrl} alt={selected.title} />
                ) : selected.mediaType === 'video' ? (
                  <video src={selected.previewUrl || selected.variants[0]?.url} controls muted playsInline preload="metadata" />
                ) : (
                  <audio src={selected.variants[0]?.url} controls preload="metadata" />
                )}
              </div>
              <dl className="stock-meta">
                <div>
                  <dt>作者</dt>
                  <dd>{selected.author || '未署名'}</dd>
                </div>
                <div>
                  <dt>许可</dt>
                  <dd>{stockLicenseLabel(selected.license)}</dd>
                </div>
                <div>
                  <dt>尺寸</dt>
                  <dd>{stockSizeText(selected)}</dd>
                </div>
                {selected.mediaType !== 'image' ? (
                  <div>
                    <dt>时长</dt>
                    <dd>{stockDurationText(selected.duration)}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.license.requiresAttribution ? (
                <div className="stock-attribution">
                  <span>这个许可要求署名，发布时请保留：</span>
                  <code>{stockAttributionText(selected.license, { author: selected.author, source: selected.provider })}</code>
                  <button type="button" className="btn-mini" data-stock-copy onClick={() => void copyAttribution()}>
                    {copied === selected.itemId ? '已复制' : '复制署名'}
                  </button>
                </div>
              ) : null}
              {selected.sourceUrl ? (
                <a className="stock-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">
                  打开来源页面
                </a>
              ) : null}
              {selected.mediaType === 'audio' ? (
                <div className="stock-note">音频本期只作为素材入库，不参与出片音轨。</div>
              ) : null}
              {mode === 'library' ? (
                <label className="stock-target">
                  <span>导入为</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value as StockImportTarget)}>
                    {targetOptions.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="btn primary stock-import"
                data-stock-import
                disabled={!projectName || importing}
                onClick={() => void importSelected()}
                title={projectName ? '' : '先选择项目再导入'}
              >
                {importing ? '下载中…' : imported[selected.itemId] ? '再次导入（复用）' : '下载到项目'}
              </button>
              {!projectName ? <div className="stock-note stock-error">先选择项目再导入</div> : null}
            </>
          ) : (
            <div className="stock-empty">选一个素材查看大图 / 视频 / 音频与授权信息</div>
          )}
        </div>
      </div>

      <div className="stock-foot">
        <span className="stock-count">
          {total ? `共 ${total} 条` : items.length ? `${items.length} 条` : '—'}
          {cached ? ' · 来自缓存' : ''}
        </span>
        {hasMore ? (
          <button type="button" className="btn" data-stock-more disabled={searching} onClick={loadMore}>
            {searching ? '加载中…' : '加载更多'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
