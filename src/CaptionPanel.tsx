import { useMemo, useState } from 'react'
import type { ShotData } from './types'
import { buildShotCaptionBundle, type CaptionCue } from './captions'

type Props = {
  data: ShotData
  /** 镜号，用于 SRT 文件名 */
  shotNo: string
}

const timingLabel = (cue: CaptionCue): string => {
  if (cue.timing === 'voice') return '配音'
  if (cue.timing === 'native-estimate') return '原生估算'
  return '估算'
}

const fmt = (ms: number): string => {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const f = total % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`
}

/** 下载文本为文件（Blob + 临时 a 标签，不依赖后端） */
function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob(['\ufeff', text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 立刻回收会让部分浏览器来不及下载，给一帧余量
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 单镜字幕：按本品规则生成 cue 并导出 SRT。
 *
 * 为什么在前端算而不是调服务端：字幕只是台词的派生（有配音按配音区间、
 * 没有按镜头时长均分），buildShotCaptions 已经把这套规则实现过一遍，
 * 预览与导出都读它。再走一次服务端只会多一次往返，还可能和服务端版本漂移。
 */
export default function CaptionPanel({ data, shotNo }: Props) {
  // 生成是一个显式动作：数据变了以后要重新点一次，而不是每敲一个字就重算
  const [bundle, setBundle] = useState<ReturnType<typeof buildShotCaptionBundle> | null>(null)
  /** 生成那一刻的数据签名；与当前签名不同即表示结果已过期 */
  const [bundleSignature, setBundleSignature] = useState<string | null>(null)

  const signature = useMemo(
    () =>
      JSON.stringify([
        data.dialogue,
        data.seconds,
        data.voiceSeconds,
        data.voiceOffset,
        data.subOffset,
        data.audioMode,
      ]),
    [data.dialogue, data.seconds, data.voiceSeconds, data.voiceOffset, data.subOffset, data.audioMode],
  )
  /** 派生：已生成且数据已变 -> 过期。不在渲染里调度 setState */
  const staleHint = Boolean(bundle && bundleSignature !== null && bundleSignature !== signature)

  const generate = () => {
    setBundleSignature(signature)
    setBundle(
      buildShotCaptionBundle({
        shotId: shotNo,
        dialogue: data.dialogue,
        shotSeconds: data.seconds,
        voiceSeconds: data.voiceSeconds,
        voiceOffset: data.voiceOffset,
        subOffset: data.subOffset,
        audioMode: data.audioMode === 'native' ? 'native' : 'off',
      }),
    )
  }

  const errors = (bundle?.issues ?? []).filter((i) => i.level === 'error')
  const warns = (bundle?.issues ?? []).filter((i) => i.level === 'warn')

  return (
    <div className="field caption-panel">
      <span>
        字幕
        <i className="hint-inline">按台词与配音生成 cue，可导出单镜 SRT</i>
      </span>
      <div className="narration-actions">
        <button type="button" className="btn-primary" data-shot-caption-generate onClick={generate}>
          {bundle ? '重新生成字幕' : '生成字幕'}
        </button>
        {bundle && bundle.srt ? (
          <button
            type="button"
            className="btn-ghost"
            data-shot-caption-download
            onClick={() => downloadText(bundle.srt, `${shotNo}.srt`, 'text/srt;charset=utf-8')}
          >
            下载 SRT
          </button>
        ) : null}
      </div>

      {staleHint ? (
        <p className="gen-note">台词或时长已改动，建议重新生成字幕。</p>
      ) : null}

      {!bundle ? (
        <p className="gen-note">点「生成字幕」按当前台词与配音算出字幕时间段。</p>
      ) : bundle.cues.length === 0 ? (
        <p className="gen-note">这一镜没有台词，没有可生成的字幕。</p>
      ) : (
        <>
          <p className="gen-note">
            {bundle.cues.length} 条 cue
            {bundle.estimated ? '（无配音，时间按镜头时长均分估算）' : '（按配音实际时长分配）'}
          </p>
          <ul className="caption-cues" data-shot-caption-cues>
            {bundle.cues.map((cue) => (
              <li key={cue.id} className={cue.clamped ? 'clamped' : undefined}>
                <span className="caption-cue-time">
                  {fmt(cue.startOffsetMs)} → {fmt(cue.endOffsetMs)}
                </span>
                <span className="caption-cue-text">{cue.text}</span>
                <em className="caption-cue-timing">{timingLabel(cue)}</em>
              </li>
            ))}
          </ul>
          {errors.length ? (
            <div className="gen-error">
              有 {errors.length} 条错误：{errors.slice(0, 3).map((e) => e.message).join('；')}
            </div>
          ) : null}
          {warns.length ? (
            <div className="gen-note">
              {warns.length} 条提示：{warns.slice(0, 3).map((w) => w.message).join('；')}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
