import { useRef } from 'react'
import type { CreativeSessionSummary } from './sessionStore'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 输入区下方的媒体条：上传视频、一键切分/抽帧 */
export function CreativeComposerBar({
  session,
  busy,
  disabled,
  onUpload,
  onSplit,
  onFrames,
}: {
  session: CreativeSessionSummary | null
  busy: string
  disabled: boolean
  onUpload: (data: string, name: string) => void
  onSplit: () => void
  onFrames: () => void
}) {
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
        <button
          type="button"
          data-creative-action="upload"
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy === 'ingest'}
        >
          {busy === 'ingest' ? '上传中…' : '上传视频'}
        </button>
        <span className="text-[10px] text-muted-foreground">
          单文件 ≤200MB；平台链接请在素材页「链接下载」
        </span>
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
      </div>
    </div>
  )
}
