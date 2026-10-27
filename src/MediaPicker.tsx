import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { listMedia, type MediaBundle } from './api'
import type { AssetKind } from './data'
import {
  assetMediaType,
  buildPickItems,
  KIND_LABEL,
  pickerTabOf,
  SOURCE_LABEL,
  type PickItem,
} from './mediaPick'
import StockBrowser from './stock/StockBrowser'
import type { StockImportResult, StockItem } from './stock/types'

type Tab = 'project' | 'generated' | 'video' | 'audio' | 'stock' | 'manual'

const TABS: { key: Tab; label: string }[] = [
  { key: 'project', label: '项目素材' },
  { key: 'generated', label: '生成图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'stock', label: '在线素材' },
  { key: 'manual', label: '手填地址' },
]

type Props = {
  projectName: string
  currentUrl?: string
  currentKind: AssetKind
  onConfirm: (item: PickItem) => void
  onClose: () => void
}

function fmtSize(n?: number): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtWhen(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function MediaThumb({
  item,
  playing,
  broken,
  onPlay,
  onStop,
  onBroken,
}: {
  item: PickItem
  playing: boolean
  broken: boolean
  onPlay: () => void
  onStop: () => void
  onBroken: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const el = item.mediaType === 'audio' ? audioRef.current : videoRef.current
    if (!el || (item.mediaType !== 'video' && item.mediaType !== 'audio')) return
    if (playing) el.play().catch(() => {})
    else el.pause()
  }, [playing, item.mediaType])

  if (broken) {
    return (
      <div className="mp-thumb-error">
        <span>预览失败</span>
      </div>
    )
  }

  if (item.mediaType === 'audio') {
    return (
      <>
        <audio
          ref={audioRef}
          className="mp-thumb-audio"
          src={item.url}
          muted
          loop
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={onBroken}
        />
        <span className="mp-audio-badge" aria-hidden="true">
          {playing ? '❚❚' : '♪'}
        </span>
        {duration > 0 && <span className="mp-duration">{fmtDuration(duration)}</span>}
      </>
    )
  }

  if (item.mediaType === 'video') {
    return (
      <>
        <video
          ref={videoRef}
          className="mp-thumb-media"
          src={item.url}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={onBroken}
          onMouseEnter={onPlay}
          onMouseLeave={onStop}
          onFocus={onPlay}
          onBlur={onStop}
        />
        <span className="mp-play-badge" aria-hidden="true">
          {playing ? '❚❚' : '▶'}
        </span>
        {duration > 0 && <span className="mp-duration">{fmtDuration(duration)}</span>}
      </>
    )
  }

  return (
    <img
      className="mp-thumb-media"
      src={item.url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={onBroken}
    />
  )
}

export default function MediaPicker({
  projectName,
  currentUrl,
  currentKind,
  onConfirm,
  onClose,
}: Props) {
  const [media, setMedia] = useState<MediaBundle>({ assets: [], images: [], videos: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('project')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PickItem | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [manualUrl, setManualUrl] = useState(currentUrl ?? '')
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [detailDims, setDetailDims] = useState<{ w: number; h: number } | null>(null)
  const [detailDuration, setDetailDuration] = useState(0)

  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const detailVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let alive = true
    listMedia(projectName)
      .then((m) => {
        if (!alive) return
        setMedia(m)
        const items = buildPickItems(m, { url: currentUrl, kind: currentKind })
        const current = items.find((i) => i.current) ?? null
        // 没有当前来源时优先停在「项目素材」，而不是被最新生成图带到生成页签
        const projectFirst = items.find((i) => pickerTabOf(i) === 'project') ?? null
        const cur = current ?? projectFirst ?? items[0] ?? null
        setSelected(cur)
        setTab(
          current
            ? current.source === 'manual'
              ? 'manual'
              : current.mediaType === 'video'
                ? 'video'
                : current.source === 'generated-image'
                  ? 'generated'
                  : 'project'
            : projectFirst
              ? 'project'
              : cur
                ? pickerTabOf(cur)
                : 'project',
        )
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setLoading(false)
        setLoadError((e as Error).message || '读取素材失败')
      })
    return () => {
      alive = false
    }
    // 只在打开选择器时读取一次；current 变化由父组件重新挂载处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    searchRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (tab === 'manual') manualRef.current?.focus()
    else searchRef.current?.focus()
  }, [tab])

  useEffect(() => {
    if (tab === 'manual') {
      const manual = manualUrl.trim()
        ? buildPickItems(
            { assets: [], images: [], videos: [] },
            { url: manualUrl.trim(), kind: currentKind },
          )[0]
        : null
      setSelected(manual ?? null)
    }
  }, [tab, manualUrl, currentKind])

  useEffect(() => {
    setDetailDims(null)
    setDetailDuration(0)
    if (selected?.mediaType !== 'video' && selected?.mediaType !== 'audio') return
    const v = detailVideoRef.current
    if (!v) return
    const done = () => setDetailDuration(v.duration)
    v.addEventListener('loadedmetadata', done)
    return () => v.removeEventListener('loadedmetadata', done)
  }, [selected])

  const items = useMemo(
    () => buildPickItems(media, { url: currentUrl, kind: currentKind }),
    [media, currentUrl, currentKind],
  )

  const countFor = (key: Tab) => {
    if (key === 'manual' || key === 'stock') return 0
    return items.filter((i) => pickerTabOf(i) === key).length
  }

  const tabItems = useMemo(() => {
    if (tab === 'manual' || tab === 'stock') return []
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (pickerTabOf(i) !== tab) return false
      if (!q) return true
      return `${i.title} ${i.name ?? ''} ${KIND_LABEL[i.kind]} ${SOURCE_LABEL[i.source]}`
        .toLowerCase()
        .includes(q)
    })
  }, [items, tab, query])

  const selectTab = (next: Tab) => {
    setTab(next)
    setPlayingKey(null)
    detailVideoRef.current?.pause()
    if (next === 'manual') {
      const manual = manualUrl.trim()
        ? buildPickItems(
            { assets: [], images: [], videos: [] },
            { url: manualUrl.trim(), kind: currentKind },
          )[0]
        : null
      setSelected(manual ?? null)
      return
    }
    if (next === 'stock') {
      setSelected(null)
      return
    }
    const list = items.filter((i) => pickerTabOf(i) === next)
    if (!selected || !list.some((i) => i.key === selected.key)) {
      setSelected(list[0] ?? null)
    }
  }

  const pick = (item: PickItem) => {
    setSelected(item)
    setDetailDims(null)
    setDetailDuration(0)
  }

  const playThumb = (item: PickItem) => {
    detailVideoRef.current?.pause()
    setPlayingKey(item.key)
  }

  const stopThumb = (item: PickItem) => {
    setPlayingKey((k) => (k === item.key ? null : k))
  }

  const markBroken = (item: PickItem) => {
    setBroken((b) => ({ ...b, [item.key]: true }))
    setPlayingKey((k) => (k === item.key ? null : k))
  }

  const canConfirm = Boolean(selected?.url) && !broken[selected?.key ?? '']

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-pick-key]') ?? [],
    )
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (idx < 0) return
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, idx + step))]
    next?.focus()
    e.preventDefault()
  }

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 选择器打开时不要触发画布的 V/P/R/G 快捷键，也不要把 Esc 传给 App 清空选中
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const nodes = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((el) => el.offsetParent !== null)
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /** 在线素材：先下载进项目，再把站内地址交给父组件的确认流程 */
  const onStockPicked = (result: StockImportResult, item: StockItem) => {
    const kind = item.mediaType === 'audio' ? 'audio' : item.mediaType === 'video' ? 'video' : 'image'
    const picked: PickItem = {
      key: result.url,
      source: 'stock',
      kind,
      mediaType: item.mediaType,
      title: item.title,
      url: result.url,
      name: result.url.split('/').pop(),
      mtime: Date.now(),
    }
    onConfirm(picked)
  }

  const detailBroken = selected ? broken[selected.key] : false

  return (
    <div
      className="mp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="mp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="mp-head">
          <div>
            <b id="mp-title">选择素材</b>
            <span>先预览，再使用</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="mp-toolbar">
          <div className="mp-tabs" role="tablist" aria-label="素材来源">
            {TABS.map((t) => (
              <button
                key={t.key}
                id={`mp-tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                aria-controls="mp-panel"
                className={tab === t.key ? 'on' : ''}
                onClick={() => selectTab(t.key)}
              >
                {t.label}
                {t.key !== 'manual' && <span>{countFor(t.key)}</span>}
              </button>
            ))}
          </div>
          {tab !== 'manual' && tab !== 'stock' && (
            <input
              ref={searchRef}
              className="mp-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、文件名或类型…"
              aria-label="搜索素材"
            />
          )}
        </div>

        {tab === 'stock' ? (
          <div className="mp-stock-body">
            <StockBrowser projectName={projectName} mode="picker" onPicked={onStockPicked} />
          </div>
        ) : (
        <div className="mp-body">
          <div
            className="mp-list"
            id="mp-panel"
            role="tabpanel"
            aria-labelledby={`mp-tab-${tab}`}
          >
            {loading ? (
              <div className="mp-empty">正在读取素材…</div>
            ) : loadError ? (
              <div className="mp-empty mp-error">{loadError}</div>
            ) : tab === 'manual' ? (
              <div className="mp-manual">
                <label className="mp-manual-label" htmlFor="mp-manual-url">
                  图片或视频地址
                </label>
                <input
                  ref={manualRef}
                  id="mp-manual-url"
                  className="mp-manual-input"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="/generated/xxx.jpg、/videos/xxx.mp4、https://… 或 data:"
                  autoComplete="off"
                />
                <p className="mp-manual-hint">
                  支持项目素材、外链、data URL；视频按 .mp4 / .webm / .mov 识别。
                </p>
              </div>
            ) : tabItems.length === 0 ? (
              <div className="mp-empty">
                {query.trim() ? '没有匹配的素材' : '这个分类还没有素材'}
              </div>
            ) : (
              <div className="mp-grid" ref={gridRef} onKeyDown={onGridKeyDown}>
                {tabItems.map((item) => {
                  const isBroken = Boolean(broken[item.key])
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-pick-key={item.key}
                      className={`mp-tile ${selected?.key === item.key ? 'on' : ''} ${isBroken ? 'bad' : ''}`}
                      aria-pressed={selected?.key === item.key}
                      aria-label={`${KIND_LABEL[item.kind]} ${item.title}${
                        item.name ? `，${item.name}` : ''
                      }`}
                      onClick={() => pick(item)}
                      onFocus={() => playThumb(item)}
                      onBlur={() => stopThumb(item)}
                      onDoubleClick={() => {
                        if (!isBroken) onConfirm(item)
                      }}
                    >
                      <div className="mp-thumb">
                        <MediaThumb
                          item={item}
                          playing={playingKey === item.key}
                          broken={isBroken}
                          onPlay={() => playThumb(item)}
                          onStop={() => stopThumb(item)}
                          onBroken={() => markBroken(item)}
                        />
                        <span className={`mp-kind mp-kind-${item.kind}`}>
                          {KIND_LABEL[item.kind]}
                        </span>
                        {item.current && <span className="mp-current-badge">当前</span>}
                      </div>
                      <span className="mp-tile-title">{item.title}</span>
                      <span className="mp-tile-sub">
                        {item.name || SOURCE_LABEL[item.source]}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <aside className="mp-detail" aria-label="选中素材预览">
            {selected ? (
              <>
                <div className="mp-detail-head">
                  <div>
                    <b>{selected.title}</b>
                    <span>
                      {SOURCE_LABEL[selected.source]} · {KIND_LABEL[selected.kind]}
                      {selected.current ? ' · 当前来源' : ''}
                    </span>
                  </div>
                  <span className="mp-detail-kind">
                    {selected.mediaType === 'video' ? '视频' : selected.mediaType === 'audio' ? '音频' : '图片'}
                  </span>
                </div>
                <div className={`mp-detail-preview ${detailBroken ? 'bad' : ''}`}>
                  {detailBroken ? (
                    <div className="mp-detail-error">素材无法加载，换一个或检查地址</div>
                  ) : selected.mediaType === 'audio' ? (
                    <audio
                      key={selected.key}
                      className="mp-detail-audio"
                      src={selected.url}
                      controls
                      preload="metadata"
                      onLoadedMetadata={(e) => setDetailDuration(e.currentTarget.duration)}
                      onError={() => markBroken(selected)}
                    />
                  ) : selected.mediaType === 'video' ? (
                    <video
                      ref={detailVideoRef}
                      key={selected.key}
                      src={selected.url}
                      controls
                      playsInline
                      preload="metadata"
                      onPlay={() => {
                        setPlayingKey(null)
                      }}
                      onLoadedMetadata={(e) => {
                        setDetailDims({
                          w: e.currentTarget.videoWidth,
                          h: e.currentTarget.videoHeight,
                        })
                        setDetailDuration(e.currentTarget.duration)
                      }}
                      onError={() => markBroken(selected)}
                    />
                  ) : (
                    <img
                      key={selected.key}
                      src={selected.url}
                      alt={selected.title}
                      onLoad={(e) =>
                        setDetailDims({
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                      onError={() => markBroken(selected)}
                    />
                  )}
                </div>
                <dl className="mp-meta">
                  {selected.mediaType === 'video' || selected.mediaType === 'audio' ? (
                    <div>
                      <dt>时长</dt>
                      <dd>{fmtDuration(detailDuration) || '—'}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>尺寸</dt>
                    <dd>{detailDims ? `${detailDims.w} × ${detailDims.h}` : '—'}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{fmtSize(selected.size) || '—'}</dd>
                  </div>
                  <div>
                    <dt>时间</dt>
                    <dd>{fmtWhen(selected.mtime) || '—'}</dd>
                  </div>
                </dl>
                <div className="mp-file" title={selected.url}>
                  {selected.name || selected.url}
                </div>
              </>
            ) : (
              <div className="mp-empty">选一个素材查看大图 / 视频 / 音频</div>
            )}
          </aside>
        </div>
        )}

        <footer className="mp-foot">
          <span className="mp-foot-hint">
            {tab === 'stock'
              ? '下载到项目后会自动选用；也可以先选中预览'
              : manualUrl && tab === 'manual' && selected
                ? selected.title
                : '双击条目也可以直接使用'}
          </span>
          <button type="button" className="mp-btn" onClick={onClose}>
            取消
          </button>
          {tab !== 'stock' && (
            <button
              type="button"
              className="mp-btn primary"
              disabled={!canConfirm}
              onClick={() => {
                if (selected && canConfirm) onConfirm(selected)
              }}
            >
              使用这个
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
