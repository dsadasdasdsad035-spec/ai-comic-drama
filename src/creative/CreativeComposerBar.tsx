import { useRef, useState } from 'react'
import type { CreativeMode, CreativeSessionSummary } from './sessionStore'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 输入区下方的媒体条：粘链接、上传视频、一键切分/抽帧 */
export function CreativeComposerBar({
  mode,
  session,
  busy,
  disabled,
  onUrl,
  onUpload,
  onSplit,
  onFrames,
}: {
  mode: CreativeMode
  session: CreativeSessionSummary | null
  busy: string
  disabled: boolean
  onUrl: (url: string) => void
  onUpload: (data: string, name: string) => void
  onSplit: () => void
  onFrames: () => void
}) {
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const source = session?.sources[0]
  const shots = source ? (session?.shots || {})[source.id] || [] : []

  const pick = async (file: File | undefined | null) => {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      window.alert(`视频超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`)
      return
    }
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
      window.alert('只支持视频文件')
      return
    }
    const data = await readAsDataUrl(file)
    onUpload(data, file.name)
  }

  return (
    <div data-creative-composer-bar className="creative-composer-bar">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          data-creative-url
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴视频链接（抖音 / B 站 / TikTok / 直链）"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim()) {
              e.preventDefault()
              onUrl(url.trim())
              setUrl('')
            }
          }}
          disabled={disabled}
        />
        <button
          type="button"
          data-creative-action="ingest-url"
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          onClick={() => {
            if (!url.trim()) return
            onUrl(url.trim())
            setUrl('')
          }}
          disabled={disabled || !url.trim() || busy === 'ingest'}
        >
          {busy === 'ingest' ? '摄取中…' : '摄取'}
        </button>
        <button
          type="button"
          data-creative-action="upload"
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy === 'ingest'}
        >
          上传视频
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground" title="当前会话的镜头数">
          {source ? `${shots.length} 镜` : '无源视频'}
        </span>
        <button
          type="button"
          data-creative-action="bar-split"
          className="rounded border border-border px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-40"
          onClick={onSplit}
          disabled={disabled || !source || busy === 'split'}
          title="按画面变化切分镜头"
        >
          {busy === 'split' ? '切分中…' : '切分'}
        </button>
        <button
          type="button"
          data-creative-action="bar-frames"
          className="rounded border border-border px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-40"
          onClick={onFrames}
          disabled={disabled || !source || !shots.length || busy === 'frames'}
          title="给每镜抽证据帧"
        >
          {busy === 'frames' ? '抽帧中…' : '抽帧'}
        </button>
        <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground" title="当前模式">
          {mode === 'plan' ? '策划' : mode === 'reverse' ? '反推' : '复刻'}
        </span>
      </div>
    </div>
  )
}
