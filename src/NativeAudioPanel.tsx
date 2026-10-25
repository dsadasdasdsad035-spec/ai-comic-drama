import { parseDialogue } from './prompts'
import { nativeAudioFingerprint, nativeAudioRef, nativeAudioStale, type AudioRefCapabilities } from './nativeAudio'
import type { CharacterSheet } from './characters'
import type { ShotData } from './types'

type Props = {
  data: ShotData
  onPatch: (patch: Partial<ShotData>) => void
  characters: CharacterSheet[]
  caps: AudioRefCapabilities | null
  modelKey?: string
}

/** 画布视频的原生音频开关；首期只允许单说话人 + 有效角色音色样本。 */
export default function NativeAudioPanel({ data, onPatch, characters, caps, modelKey }: Props) {
  const dialogue = parseDialogue(data.dialogue)
  const ref = nativeAudioRef({
    dialogue,
    performance: data.performance,
    characters,
    caps,
    seconds: Number(data.seconds) || 0,
  })
  const mode = data.audioMode ?? 'off'
  const refChanged = Boolean(mode === 'native' && ref.ok && data.audioRef?.url !== ref.url)
  const stale =
    refChanged ||
    nativeAudioStale(data.audioMeta, {
      modelKey,
      audioRef: data.audioRef,
      dialogue,
    })
  const canEnable = Boolean(caps?.supported && ref.ok)
  const reason = !caps?.supported
    ? '当前模型没有通过音频参考探测'
    : ref.ok
      ? ''
      : ref.reason

  const toggle = (next: 'off' | 'native') => {
    if (next === 'native') {
      if (!canEnable || !ref.ok) return
      onPatch({
        audioMode: 'native',
        audioRef: ref.ref,
        audioMeta: { fingerprint: nativeAudioFingerprint({ modelKey, audioRef: ref.ref, dialogue }), modelKey, createdAt: new Date().toISOString() },
      })
    } else {
      onPatch({ audioMode: 'off', audioMeta: undefined })
    }
  }

  return (
    <div className="native-audio-panel" data-native-audio>
      <div className="lip-head">
        <span>原生音频</span>
        <label className="perf-check">
          <input
            type="checkbox"
            checked={mode === 'native'}
            disabled={mode !== 'native' && !canEnable}
            onChange={(e) => toggle(e.target.checked ? 'native' : 'off')}
          />
          使用 Seedance 原生声音
        </label>
        {mode === 'native' && <span className="lip-badge">已在 video 请求中开启</span>}
        {stale && <span className="lip-badge warn">参考或台词变了，需重生成</span>}
      </div>
      {reason && <div className="lip-hint">{reason}</div>}
      {mode === 'native' && ref.ok && (
        <div className="native-audio-ref">
          <div>
            音色参考：<b>{ref.character}</b>
            <span className="lip-hint"> · {ref.sampleSeconds.toFixed(1)}s</span>
          </div>
          <audio src={ref.url} controls preload="metadata" />
          <div className="lip-hint">
            参考音频只约束音色；模型会重新发声，不保证与 TTS 文件逐字一致。
          </div>
        </div>
      )}
      {mode === 'native' && data.lipSync?.mode === 'provider' && (
        <div className="gen-warn">原生音频与 provider 口型互斥，请把口型切回关闭或提示词模式。</div>
      )}
    </div>
  )
}
