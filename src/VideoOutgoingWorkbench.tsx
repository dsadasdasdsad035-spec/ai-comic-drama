import type { ReactNode } from 'react'
import { CapModelSelect } from './ModelSelect'
import type { AppSettings, Cap } from './api'
import type { VideoAttachment } from './videoPrompt'
import { videoRefLimitLabel } from './videoRefLimits'
import NativeAudioPanel from './NativeAudioPanel'
import type { CharacterSheet } from './characters'
import type { AudioRefCapabilities } from './nativeAudio'
import type { ShotData } from './types'

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

/** 与分镜 VideoPromptPanel 同构的参考列表 */
export function VideoReferenceList({
  refs,
  video,
  omitted,
  omittedVideos,
  prefix,
}: {
  refs: VideoAttachment[]
  video: VideoAttachment | null
  omitted: { label: string; reason: string }[]
  omittedVideos: { label: string; reason: string }[]
  prefix?: ReactNode
}) {
  return (
    <ul className="vp-refs">
      {prefix}
      {refs.map((r) => (
        <li key={`${r.slot}-${r.index}-${r.url}`}>
          <b>图{r.index}</b> {r.label}
          <span>{r.purpose}</span>
        </li>
      ))}
      {video ? (
        <li>
          <b>视频1</b> {video.label}
          <span>{video.purpose}</span>
        </li>
      ) : null}
      {omitted.map((o, i) => (
        <li className="omitted" key={`omitted-${i}-${o.label}`}>
          <b>省略</b> {o.label}
          <span>{o.reason}</span>
        </li>
      ))}
      {omittedVideos.map((o, i) => (
        <li className="omitted" key={`omitted-video-${i}-${o.label}`}>
          <b>忽略</b> {o.label}
          <span>{o.reason}</span>
        </li>
      ))}
    </ul>
  )
}

export function VideoReferenceSummary({
  refCount,
  submittedCount,
  hasVideo,
  omittedCount,
}: {
  refCount: number
  submittedCount: number
  hasVideo: boolean
  omittedCount: number
}) {
  return (
    <span>
      参考图 {refCount}
      {videoRefLimitLabel() !== '不限' ? `/${videoRefLimitLabel()}` : ' 张'}
      （将提交 {submittedCount}）
      {omittedCount > 0 ? ` · 省略 ${omittedCount}` : ''}
      {hasVideo ? ' · 参考视频 1' : ''}
    </span>
  )
}

/** 转场：与分镜 Inspector 原生音频区块同布局 */
export function TransitionNativeAudioBlock({
  data,
  onPatch,
  characters,
  caps,
  modelKey,
}: {
  data: ShotData
  onPatch: (patch: Partial<ShotData>) => void
  characters: CharacterSheet[]
  caps: AudioRefCapabilities | null
  modelKey?: string
}) {
  return (
    <div className="field native-audio-field">
      <span>
        原生音频
        <i
          className="hint-inline"
          title="合并相邻两镜台词解析说话人；首期仅单说话人。请求时长在开启时会抬高到大于 4 秒。"
        >
          视频自带声音
        </i>
      </span>
      <NativeAudioPanel data={data} onPatch={onPatch} characters={characters} caps={caps} modelKey={modelKey} />
    </div>
  )
}
