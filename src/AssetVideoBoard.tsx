import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectAsset } from './api'
import { getProject, ingestShot3dReference, patchProject } from './api'
import { assetMediaType } from './mediaPick'
import type { AssetKind } from './data'
import { useVideoFirstFrame } from './videoFirstFrame'
import { extractIngestUrl, isPlatformMediaUrl } from './ingestUrl'
import { listCreativeAdapters, type AdapterInfo } from './creative/mediaApi'
import { BoardListToolbar } from './BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, useBoardListFilter, videoAssetListMatch } from './boardListFilter'

type Props = {
  projectName: string
  disabled?: boolean
  assets: ProjectAsset[]
  ingestOpen?: boolean
  onIngestOpenChange?: (open: boolean) => void
  onAssetsChange: (next: ProjectAsset[]) => void | Promise<void>
  onAddAssetCard?: (input: { title: string; kind: string; url: string }) => void
  toast: (msg: string) => void
}

function fileNameOf(url: string): string {
  const clean = String(url || '').split('?')[0]
  const part = clean.split('/').pop() || clean
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function VideoCard({
  item,
  onPublish,
  onRemove,
}: {
  item: ProjectAsset
  onPublish: () => void
  onRemove: () => void
}) {
  const poster = useVideoFirstFrame(item.url)
  const [playing, setPlaying] = useState(false)

  return (
    <article className="asset-video-card" data-asset-video-card>
      <div
        className="asset-video-thumb"
        onMouseEnter={() => setPlaying(true)}
        onMouseLeave={() => setPlaying(false)}
      >
        {playing ? (
          <video
            src={item.url}
            className="asset-video-el"
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
          />
        ) : poster ? (
          <img src={poster} alt="" className="asset-video-poster" />
        ) : (
          <div className="asset-video-ph" aria-hidden>
            ▶
          </div>
        )}
        <span className="asset-video-badge">视频</span>
      </div>
      <div className="asset-video-body">
        <h3 className="asset-video-title" title={item.title}>
          {item.title || fileNameOf(item.url)}
        </h3>
        {item.note ? <p className="asset-video-note">{item.note}</p> : null}
        <p className="asset-video-path mono" title={item.url}>
          {fileNameOf(item.url)}
        </p>
        <div className="asset-video-actions">
          <button type="button" className="btn-mini primary" onClick={onPublish}>
            发布素材卡
          </button>
          <button type="button" className="btn-mini ghost" onClick={onRemove}>
            从库移除
          </button>
        </div>
      </div>
    </article>
  )
}

function VideoIngestDialog({
  open,
  busy,
  disabled,
  linkUrl,
  ingestHint,
  onLinkChange,
  onClose,
  onLinkIngest,
  onPickFile,
}: {
  open: boolean
  busy: boolean
  disabled?: boolean
  linkUrl: string
  ingestHint: string
  onLinkChange: (v: string) => void
  onClose: () => void
  onLinkIngest: () => void
  onPickFile: () => void
}) {
  if (!open) return null

  return (
    <div
      className="mp-backdrop"
      data-asset-video-ingest-backdrop
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="mp-dialog asset-video-ingest-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-video-ingest-title"
        data-asset-link-ingest
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="mp-head">
          <div>
            <b id="asset-video-ingest-title">添加视频</b>
            <span>链接下载或上传本地文件，写入本项目视频库</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="asset-video-ingest-body">
          <p className="board-hint">
            平台链、本地 MP4 都会落在本项目的<strong>视频库</strong>，供几何分析与发布素材卡；解析器在设置 →
            素材库 → 平台链接下载。
          </p>
          <p className="board-hint asset-ingest-adapters" data-asset-ingest-adapters>
            {ingestHint}
          </p>
          <div className="asset-ingest-row">
            <input
              type="text"
              className="asset-ingest-url"
              data-asset-ingest-url
              placeholder="粘贴分享链接或整段口令（自动提取 URL）"
              value={linkUrl}
              onChange={(e) => onLinkChange(e.target.value)}
              disabled={disabled || busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onLinkIngest()
              }}
            />
            <button
              type="button"
              className="btn primary"
              data-asset-ingest-submit
              disabled={disabled || busy || !extractIngestUrl(linkUrl)}
              onClick={onLinkIngest}
            >
              {busy ? '处理中…' : '链接下载'}
            </button>
            <button type="button" className="btn-ghost" disabled={disabled || busy} onClick={onPickFile}>
              上传本地视频
            </button>
          </div>
          {disabled ? <p className="board-hint asset-ingest-warn">先选择项目后再添加视频</p> : null}
        </div>
        <footer className="mp-foot">
          <button type="button" className="btn-mini" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}

export default function AssetVideoBoard({
  projectName,
  disabled,
  assets,
  ingestOpen: ingestOpenProp,
  onIngestOpenChange,
  onAssetsChange,
  onAddAssetCard,
  toast,
}: Props) {
  const [linkUrl, setLinkUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [ingestOpenLocal, setIngestOpenLocal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ingestOpen = ingestOpenProp ?? ingestOpenLocal
  const setIngestOpen = useCallback(
    (open: boolean) => {
      onIngestOpenChange?.(open)
      setIngestOpenLocal(open)
      if (!open) setLinkUrl('')
    },
    [onIngestOpenChange],
  )

  useEffect(() => {
    let alive = true
    listCreativeAdapters()
      .then((r) => {
        if (alive) setAdapters(r.adapters || [])
      })
      .catch(() => {
        if (alive) setAdapters([])
      })
    return () => {
      alive = false
    }
  }, [])

  const ingestHint = useMemo(() => {
    const ytdlp = adapters.find((a) => a.id === 'ytdlp')
    const dtk = adapters.find((a) => a.id === 'dtk')
    const parts: string[] = []
    if (ytdlp?.ok) parts.push('yt-dlp 可用（B 站等）')
    else if (ytdlp) parts.push(`yt-dlp：${ytdlp.reason || '未配置'}`)
    if (dtk?.ok) parts.push('DTK 可用（抖音推荐）')
    else if (dtk) parts.push(`DTK：${dtk.reason || '未配置'}`)
    if (!parts.length) return '加载解析器状态…'
    return parts.join(' · ')
  }, [adapters])

  const videos = useMemo(
    () =>
      assets.filter((a) => assetMediaType(String(a.kind) as AssetKind, a.url) === 'video'),
    [assets],
  )
  const videoList = useBoardListFilter(videos, videoAssetListMatch)

  const ingest = useCallback(
    async (body: { url?: string; adapter?: string; name?: string; data?: string }) => {
      if (!projectName) {
        toast('请先选择项目')
        return
      }
      let url = body.url
      if (url) {
        url = extractIngestUrl(url)
        if (!/^https?:\/\//i.test(url)) {
          toast('未识别到有效链接，请粘贴抖音/B 站分享链接或整段口令')
          return
        }
        if (isPlatformMediaUrl(url)) {
          const ytdlpOk = adapters.find((a) => a.id === 'ytdlp')?.ok
          const dtkOk = adapters.find((a) => a.id === 'dtk')?.ok
          if (!ytdlpOk && !dtkOk) {
            toast('平台链接需要解析器：请到 设置 → 素材库 → 平台链接下载，启用 yt-dlp（B 站）或 DTK（抖音）')
            return
          }
        }
      }
      setBusy(true)
      try {
        const r = await ingestShot3dReference({ projectName, ...body, url })
        const p = await getProject(projectName)
        await onAssetsChange(p.assets || [])
        setLinkUrl('')
        setIngestOpen(false)
        toast(`已加入视频库：${r.adapterLabel || r.adapter || '视频'}`)
      } catch (e) {
        toast((e as Error).message || '下载失败')
      } finally {
        setBusy(false)
      }
    },
    [projectName, onAssetsChange, toast, adapters, setIngestOpen],
  )

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => reject(new Error('读取文件失败'))
        r.readAsDataURL(file)
      })
      await ingest({ adapter: 'upload', name: file.name, data })
    },
    [ingest, toast],
  )

  const remove = useCallback(
    async (url: string) => {
      if (!projectName) return
      const title = videos.find((v) => v.url === url)?.title || fileNameOf(url)
      if (!window.confirm(`从项目视频库移除「${title}」？画布上已发布的素材卡不会自动删除。`)) return
      const next = assets.filter((a) => a.url !== url)
      await patchProject(projectName, { assets: next })
      await onAssetsChange(next)
      toast('已从视频库移除')
    },
    [projectName, assets, videos, onAssetsChange, toast],
  )

  return (
    <div className="asset-video-board" data-asset-video-board>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <VideoIngestDialog
        open={ingestOpen}
        busy={busy}
        disabled={disabled}
        linkUrl={linkUrl}
        ingestHint={ingestHint}
        onLinkChange={setLinkUrl}
        onClose={() => setIngestOpen(false)}
        onLinkIngest={() => void ingest({ url: extractIngestUrl(linkUrl) })}
        onPickFile={() => fileRef.current?.click()}
      />

      {videos.length > 0 ? (
        <BoardListToolbar
          query={videoList.query}
          onQueryChange={videoList.setQuery}
          placeholder="搜索标题、文件名、备注…"
          ariaLabel="搜索视频库"
          filteredCount={videoList.filteredCount}
          totalCount={videoList.totalCount}
          page={videoList.page}
          totalPages={videoList.totalPages}
          onPageChange={videoList.setPage}
          pageSize={BOARD_LIST_PAGE_SIZE}
        />
      ) : null}

      <div className="asset-video-grid" data-asset-ingest-video-list>
        {!projectName ? (
          <div className="char-empty-board">先选择项目，再管理视频素材。</div>
        ) : videos.length === 0 ? (
          <div className="char-empty-board asset-video-empty">
            <p>视频库还是空的。</p>
            <p className="board-hint">点右上角「+ 添加视频」下载链接或上传本地参考片。</p>
            <button
              type="button"
              className="btn primary"
              data-asset-video-add-inline
              disabled={disabled}
              onClick={() => setIngestOpen(true)}
            >
              添加视频
            </button>
          </div>
        ) : videoList.filteredCount === 0 ? (
          <div className="char-empty-board">没有匹配的视频，换个关键词试试。</div>
        ) : (
          videoList.slice.map((v) => (
            <VideoCard
              key={v.url}
              item={v}
              onPublish={() => {
                onAddAssetCard?.({
                  title: v.title || fileNameOf(v.url),
                  kind: 'video',
                  url: v.url,
                })
                toast('已发布视频素材卡到画布')
              }}
              onRemove={() => void remove(v.url)}
            />
          ))
        )}
      </div>
    </div>
  )
}