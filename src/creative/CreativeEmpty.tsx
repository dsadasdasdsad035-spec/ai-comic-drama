import { useRef } from 'react'
import type { CreativeMode } from './sessionStore'

const MODE_COPY: Record<CreativeMode, { title: string; body: string }> = {
  plan: {
    title: '先说想法，不用先建项目',
    body: '创意会话独立于项目：聊到能拍了再晋升。这里只写对话与产物，不会改动任何项目数据。',
  },
  reverse: {
    title: '粘链接或上传视频，逆推出提示词',
    body: '会依次做：摄取 → 探测 → 切分镜头 → 抽证据帧 → 逐镜反推。分析会产生视觉模型费用，开始前会确认。',
  },
  remake: {
    title: '用提示词包生成复刻片段',
    body: '先有提示词包再复刻。真实视频生成每次都要确认费用，不会自动扣费。',
  },
}

/** 空态：说明边界 + 起点，上传与链接入口也在这里。
 *  示例只在输入框上方出现（可点击、只填入不发送），这里不再重复一组静态列表。 */
export function CreativeEmpty({
  mode,
  loading,
  hasSource,
  onUpload,
}: {
  mode: CreativeMode
  loading: boolean
  hasSource: boolean
  onUpload: (data: string, name: string) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const copy = MODE_COPY[mode]

  return (
    <div data-creative-empty className="creative-empty">
      <h3>{loading ? '正在准备会话…' : copy.title}</h3>
      <p>{loading ? '稍等，正在读取会话与技能。' : copy.body}</p>
      {!loading && mode !== 'plan' ? (
        <div className="creative-empty-actions">
          <button
            type="button"
            data-creative-action="empty-upload"
            className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] hover:bg-primary/20"
            onClick={() => fileRef.current?.click()}
          >
            上传视频
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result || ''))
                reader.onerror = () => reject(new Error('读取文件失败'))
                reader.readAsDataURL(file)
              }).catch(() => '')
              if (data) onUpload(data, file.name)
            }}
          />
          <span className="text-[10px] text-muted-foreground">
            {hasSource ? '已有源视频，可直接说「反推提示词」' : '也可以直接粘贴链接'}
          </span>
        </div>
      ) : null}
      {!loading ? (
        <p className="creative-empty-hint">点下面的示例只填入输入框，不会直接发送。</p>
      ) : null}
    </div>
  )
}
