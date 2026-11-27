import { CapModelSelect } from './ModelSelect'
import type { AppSettings, Cap } from './api'

/** 出片模型 + 分辨率（分镜视频 Tab 与转场生成共用） */
export function VideoOutgoingModelRow({
  settings,
  pick,
  onPick,
  vidRes,
  onVidResChange,
}: {
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  onPick: (cap: Cap, key: string) => void
  vidRes: '480p' | '720p'
  onVidResChange: (v: '480p' | '720p') => void
}) {
  return (
  <>
    <CapModelSelect
      cap="video"
      caps={['video', 'videoRef']}
      label="出片模型"
      settings={settings}
      value={pick.video}
      onChange={(key) => onPick('video', key)}
    />
    <div className="gen-controls">
      <select value={vidRes} onChange={(e) => onVidResChange(e.target.value as '480p' | '720p')} title="分辨率">
        <option value="480p">480p</option>
        <option value="720p">720p</option>
      </select>
    </div>
  </>
  )
}
