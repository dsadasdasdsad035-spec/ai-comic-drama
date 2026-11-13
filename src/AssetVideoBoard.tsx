import { useCallback, useMemo, useRef, useState } from 'react'
import type { ProjectAsset } from './api'
import { getProject, ingestShot3dReference, patchProject } from './api'
import { assetMediaType } from './mediaPick'
import type { AssetKind } from './data'
import { useVideoFirstFrame } from './videoFirstFrame'

type Props = {
  projectName: string
  disabled?: boolean
  assets: ProjectAsset[]
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

export default function AssetVideoBoard({
  projectName,
  disabled,
  assets,
  onAssetsChange,
  onAddAssetCard,
  toast,
}: Props) {
  const [linkUrl, setLinkUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const videos = useMemo(
    () =>
      assets.filter((a) => assetMediaType(String(a.kind) as AssetKind, a.url) === 'video'),
    [assets],
  )

  const ingest = useCallback(
    async (body: { url?: string; adapter?: string; name?: string; data?: string }) => {
      if (!projectName) {
        toast('请先选择项目')
        return
      }
      setBusy(true)
      try {
        const r = await ingestShot3dReference({ projectName, ...body })
        const p = await getProject(projectName)
        await onAssetsChange(p.assets || [])
        setLinkUrl('')
        toast(`已加入视频库：${r.adapterLabel || r.adapter || '视频'}`)
      } catch (e) {
        toast((e as Error).message || '下载失败')
      } finally {
        setBusy(false)
      }
    },
    [projectName, onAssetsChange, toast],
  )

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (file.size > 200 * 1024 * 1024) {
        toast('文件超过 200MB 上限')
        return
      }
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
      <section className="asset-video-toolbar" data-asset-link-ingest aria-labelledby="asset-video-ingest-title">
        <h4 id="asset-video-ingest-title">添加视频</h4>
        <p className="board-hint">
          平台链、本地 MP4 都会落在本项目的<strong>视频库</strong>，供几何分析与发布素材卡；解析器在设置 → 素材库。
        </p>
        <div className="asset-ingest-row">
          <input
            type="url"
            className="asset-ingest-url"
            data-asset-ingest-url
            placeholder="粘贴抖音 / B 站分享链…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            disabled={disabled || busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ingest({ url: linkUrl.trim() })
            }}
          />
          <button
            type="button"
            className="btn primary"
            data-asset-ingest-submit
            disabled={disabled || busy || !linkUrl.trim()}
            onClick={() => void ingest({ url: linkUrl.trim() })}
          >
            {busy ? '处理中…' : '链接下载'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
          >
            上传本地视频
          </button>
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
        </div>
        {disabled && <p className="board-hint asset-ingest-warn">先选择项目后再添加视频</p>}
      </section>

      <div className="asset-video-grid" data-asset-ingest-video-list>
        {!projectName ? (
          <div className="char-empty-board">先选择项目，再管理视频素材。</div>
        ) : videos.length === 0 ? (
          <div className="char-empty-board asset-video-empty">
            <p>视频库还是空的。</p>
            <p className="board-hint">用上方链接下载或上传第一条参考片；下载后会自动出现在这里。</p>
          </div>
        ) : (
          videos.map((v) => (
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
