import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from './api'
import type { NarratorVoice } from './api'
import { listVoicesCached, type VoiceOption } from './api'
import {
  buildNarrationPayload,
  extractNarrationLines,
  narrationVoiceStale,
  type NarratorVoiceConfig,
} from './narration'
import type { ShotData } from './types'
import { parseDialogue } from './prompts'
import GenErrorNote from './GenErrorNote'

type Props = {
  data: ShotData
  narratorVoice?: NarratorVoice | null
  onSaveNarratorVoice: (next: NarratorVoice) => void
  onGenerate: () => void
  settings: AppSettings | null
}

export default function NarrationPanel({ data, narratorVoice, onSaveNarratorVoice, onGenerate, settings }: Props) {
  const lines = useMemo(() => extractNarrationLines(parseDialogue(data.dialogue)), [data.dialogue])
  const parsed = useMemo(() => parseDialogue(data.dialogue), [data.dialogue])
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
  const payloadOk = Boolean(
    narratorVoice && buildNarrationPayload({ dialogue: parsed, dialogueDelivery: data.dialogueDelivery, narrator: narratorVoice }),
  )

  const setModel = (mk: string) => {
    const voiceId = narratorVoice?.voiceId && voices.some((v) => v.id === narratorVoice.voiceId) ? narratorVoice.voiceId : ''
    onSaveNarratorVoice({ modelKey: mk, voiceId })
  }
  const setVoice = (voiceId: string) => {
    if (!modelKey) return
    onSaveNarratorVoice({ modelKey, voiceId })
  }

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
          disabled={!ready || !payloadOk || data.voiceState === 'running'}
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