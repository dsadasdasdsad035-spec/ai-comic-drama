import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from './api'
import type { NarratorVoice } from './api'
import { listVoicesCached, type VoiceOption } from './api'
import {
  extractNarrationLines,
  narrationVoiceStale,
  type NarratorVoiceConfig,
} from './narration'
import type { ShotData } from './types'
import GenErrorNote from './GenErrorNote'

type Props = {
  data: ShotData
  narratorVoice?: NarratorVoice | null
  onSaveNarratorVoice: (next: NarratorVoice) => void
  onGenerate: () => void
  settings: AppSettings | null
}

export default function NarrationPanel({ data, narratorVoice, onSaveNarratorVoice, onGenerate, settings }: Props) {
  // extractNarrationLines 自己会按文本/结构化两种形态解析台词，这里不必先 parseDialogue
  const lines = useMemo(() => extractNarrationLines(data.dialogue), [data.dialogue])
  const stale = useMemo(
    () =>
      narrationVoiceStale(
        data.voiceMeta,
        lines,
        data.dialogueDelivery,
        narratorVoice?.modelKey && narratorVoice?.voiceId ? (narratorVoice as NarratorVoiceConfig) : undefined,
      ),
    [data.voiceMeta, data.dialogueDelivery, lines, narratorVoice],
  )
  const audioModels = useMemo(
    () =>
      (settings?.models ?? []).filter(
        (m) => m.cap === 'audio' || (m.caps ?? []).includes('audio' as never),
      ),
    [settings?.models],
  )
  const modelKey = narratorVoice?.modelKey || settings?.defaults?.audio || ''
  const [voices, setVoices] = useState<VoiceOption[]>([])
  useEffect(() => {
    if (!modelKey) {
      setVoices([])
      return
    }
    listVoicesCached(modelKey)
      .then((list) => setVoices(list.voices ?? []))
      .catch(() => setVoices([]))
  }, [modelKey])

  const ready = Boolean(narratorVoice?.modelKey && narratorVoice?.voiceId && lines.length)

  const setModel = (mk: string) => {
    const voiceId = narratorVoice?.voiceId && voices.some((v) => v.id === narratorVoice.voiceId) ? narratorVoice.voiceId : ''
    onSaveNarratorVoice({ modelKey: mk, voiceId })
  }
  const setVoice = (voiceId: string) => {
    if (!modelKey) return
    onSaveNarratorVoice({ modelKey, voiceId })
  }

  /**
   * 音色为空时自动选第一个可用音色。
   *
   * 为什么必须自动：换引擎会清空 voiceId（不同引擎的音色不通用，这是对的），
   * 但清空后「生成旁白」就一直是置灰状态，而面板收在折叠区里、用户看不出
   * 少选了什么。实测就是「我选了音色，按钮还是灰的」。
   *
   * 只在 voiceId 为空时补，不覆盖用户已选的音色。
   */
  useEffect(() => {
    if (!modelKey || narratorVoice?.voiceId) return
    const first = voices[0]?.id
    if (!first) return
    onSaveNarratorVoice({ modelKey, voiceId: first })
    // 依赖刻意只含 modelKey 与首个音色：voices 数组每次拉取都是新引用，
    // 把它放进依赖会在音色加载完成时重复触发（虽然被 voiceId 判空挡住，但没必要）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, voices, narratorVoice?.voiceId])

  return (
    <div className="field narration-panel">
      <span>
        旁白配音
        <i className="hint-inline">仅本镜试听与下载，不进连播与导出成片</i>
      </span>
      {lines.length === 0 ? (
        <p className="gen-note">台词里没有旁白行（说话人：旁白 / VO / 画外音等）。</p>
      ) : (
        <p className="gen-note">本镜 {lines.length} 条旁白将参与合成，角色对白不会念出。</p>
      )}
      <div className="narration-voice-row">
        <label>
          旁白引擎
          <select value={modelKey} onChange={(e) => setModel(e.target.value)}>
            <option value="">请选择</option>
            {audioModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label || m.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          旁白音色
          <select value={narratorVoice?.voiceId || ''} disabled={!modelKey} onChange={(e) => setVoice(e.target.value)}>
            <option value="">请选择</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label || v.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!narratorVoice?.voiceId ? <p className="gen-note">请为当前项目选择旁白音色后再生成。</p> : null}
      {data.voiceMeta?.scope !== 'narration' && data.voiceUrl ? (
        <p className="gen-note">当前音频为历史配音，建议点「生成旁白」覆盖为旁白专用音轨。</p>
      ) : null}
      {stale && data.voiceUrl ? <span className="lip-badge warn">旁白或声线已变，需重新生成</span> : null}
      <div className="narration-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={data.voiceState === 'running'}
          data-narration-generate
          title={
            !ready
              ? !lines.length
                ? '这一镜没有旁白行（说话人写「旁白」「画外音」「VO」等）'
                : '请先选择旁白引擎与音色'
              : undefined
          }
          onClick={onGenerate}
        >
          {data.voiceState === 'running' ? '生成中…' : data.voiceUrl ? '重新生成旁白' : '生成旁白'}
        </button>
      </div>
      {data.voiceState === 'error' && data.voiceError ? <GenErrorNote message={data.voiceError} /> : null}
      {data.voiceUrl ? (
        <div className="narration-audio">
          <audio controls preload="metadata" src={data.voiceUrl} />
          <a className="btn-ghost" href={data.voiceUrl} download>
            下载 mp3
          </a>
        </div>
      ) : null}
    </div>
  )
}