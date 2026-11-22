import { parseDialogue } from './prompts'
import {
  nativeAudioFingerprint,
  nativeAudioRef,
  nativeAudioStale,
  speakingNames,
  type AudioRefCapabilities,
} from './nativeAudio'
import type { CharacterSheet } from './characters'
import type { ShotData } from './types'
import { shotRequestSeconds } from './videoSeconds'

type Props = {
  data: ShotData
  onPatch: (patch: Partial<ShotData>) => void
  characters: CharacterSheet[]
  caps: AudioRefCapabilities | null
  modelKey?: string
  /** 转场等场景：展示与分镜相同控件但不可启用 */
  forcedOff?: boolean
  forcedOffHint?: string
}

/** 画布视频的原生音频开关；首期只允许单说话人 + 有效角色音色样本。 */
export default function NativeAudioPanel({
  data,
  onPatch,
  characters,
  caps,
  modelKey,
  forcedOff,
  forcedOffHint,
}: Props) {
  const dialogue = parseDialogue(data.dialogue)
  /** 与出片请求同源：原生音频门槛由 shotRequestSeconds 解出，面板不再自行抬高秒数 */
  const requestSeconds = shotRequestSeconds({
    seconds: Number(data.seconds) || 0,
    nativeAudio: Boolean(caps?.supported),
    nativeAudioMinVideoSeconds: caps?.minVideoSeconds,
  }).seconds
  const ref = nativeAudioRef({
    dialogue,
    performance: data.performance,
    characters,
    caps,
    seconds: requestSeconds,
    // 无声镜没有说话人可推断，沿用镜上已保存的音色角色
    preferredCharacter: data.audioRef?.character,
  })
  const mode = data.audioMode ?? 'off'
  /** 无声镜不说话人都是空的，此时音色参考只能按角色卡兜底，界面要说清是谁 */
  const silentShot = speakingNames(dialogue, data.performance).length === 0
  const refChanged = Boolean(mode === 'native' && ref.ok && data.audioRef?.url !== ref.url)
  const stale =
    refChanged ||
    nativeAudioStale(data.audioMeta, {
      modelKey,
      audioRef: data.audioRef,
      dialogue,
    })
  /**
   * 开关只看模型能力，不看音色样本。
   *
   * 以前这里要求 `ref.ok`，等于「没有角色音色样本就没法开原生音轨」。但样本
   * 缺失只是拿不到音色锚点，不该拦住出片：用户点了按钮就该拿到视频。缺样本时
   * 仍然记录 native 偏好，出片时 `buildShotVideoRequest` 会降级成普通出片并给出
   * 说明——降级决策只在一处，面板不重复实现一套。
   */
  const canEnable = Boolean(caps?.supported)
  const reason = !caps?.supported ? '当前模型没有通过音频参考探测' : ''
  /** 已开原生音轨但拿不到样本：说清这次会怎么出片 */
  const degradedHint = Boolean(mode === 'native' && !ref.ok)
  /** 降级原因；degradedHint 为真时 ref 一定不 ok */
  const degradedReason = ref.ok ? '' : ref.reason

  const toggle = (next: 'off' | 'native') => {
    if (next === 'native') {
      if (!canEnable) return
      // 有样本才记音色参考；没有样本也照样开，出片时降级为静音视频
      if (!ref.ok) {
        onPatch({ audioMode: 'native', audioRef: undefined, audioMeta: undefined })
        return
      }
      onPatch({
        audioMode: 'native',
        audioRef: ref.ref,
        audioMeta: { fingerprint: nativeAudioFingerprint({ modelKey, audioRef: ref.ref, dialogue }), modelKey, createdAt: new Date().toISOString() },
      })
    } else {
      onPatch({ audioMode: 'off', audioMeta: undefined })
    }
  }

  if (forcedOff) {
    return (
      <div className="native-audio-panel dim" data-native-audio>
        <div className="lip-head">
          <span>原生音频</span>
          <label className="perf-check">
            <input type="checkbox" checked={false} disabled readOnly />
            使用 Seedance 原生声音
          </label>
        </div>
        {forcedOffHint ? <div className="lip-hint">{forcedOffHint}</div> : null}
      </div>
    )
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
        {mode === 'native' && !degradedHint && <span className="lip-badge">已在 video 请求中开启</span>}
        {degradedHint && <span className="lip-badge warn">将降级为静音视频</span>}
        {stale && <span className="lip-badge warn">参考或台词变了，需重生成</span>}
      </div>
      {reason && <div className="lip-hint">{reason}</div>}
      {degradedHint && (
        <div className="lip-hint" data-native-degraded>
          没有可用的音色参考：{degradedReason}。出片仍会继续，只是不带原生音轨；
          想带上声音，去对应角色卡生成 2-30 秒音色样本即可。
        </div>
      )}
      {!reason && silentShot && ref.ok && (
        <div className="lip-hint">
          这一镜没有台词，音色参考取角色「{ref.character}」的样本（只约束音色，不产生对白）。
        </div>
      )}
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
