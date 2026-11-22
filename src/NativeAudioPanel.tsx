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

/** 画布视频的原生音频开关；音色样本可选，缺样本时仍能带原生音轨出片。 */
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
  /**
   * 正文里有没有写台词。
   *
   * 出片正文只由人/Agent 写入，运行时不追加声音段（`shot-prompt-agent-authored`）。
   * 实测确认：正文写了台词，模型就会念出来；正文没写，模型可能只出环境声。
   * 所以这里只做软提示——不阻塞出片，也不改正文。
   */
  const spokenLines = dialogue.filter((line) => String(line.text || '').trim())
  const body = String(data.videoPrompt || '')
  /** 台词整句出现在正文里就算写了；逐字匹配，避免把无关的短词算成命中 */
  const bodyHasDialogue =
    spokenLines.length > 0 && spokenLines.some((line) => body.includes(String(line.text).trim()))
  const bodyMissingDialogue = spokenLines.length > 0 && !bodyHasDialogue
  /** 台词原文，仅用于提示里给一句可复制的示例 */
  const firstLineText = String(spokenLines[0]?.text || '').trim()
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
  /** 有可用样本：音色跨镜一致 */
  const hasRef = ref.ok && ref.kind === 'reference'
  /** 能出片但没有音色锚点：声音由模型决定 */
  const noRef = ref.ok && ref.kind === 'no-reference'
  const refChanged = Boolean(hasRef && data.audioRef?.url !== ref.url && ref.url)
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
   * 仍然记录 native 偏好，出片时只发 `generate_audio`，声音由模型决定。
   */
  const canEnable = Boolean(caps?.supported)
  const reason = !caps?.supported ? '当前模型没有通过音频参考探测' : ''
  /** 只有真拦阻（模型没能力/多说话人/镜头太短/样本不合规）才算不可用 */
  const blockedHint = Boolean(mode === 'native' && !ref.ok)
  const blockedReason = ref.ok ? '' : ref.reason
  /** 已开 native 但没有音色样本：不是降级，只是声音由模型决定 */
  const noRefHint = Boolean(mode === 'native' && noRef)

  const toggle = (next: 'off' | 'native') => {
    if (next === 'native') {
      if (!canEnable) return
      // 有可用样本才记音色参考；没有样本也照样开，出片时只发 generate_audio
      if (!ref.ok || ref.kind !== 'reference') {
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
        {mode === 'native' && hasRef && <span className="lip-badge">已在 video 请求中开启</span>}
        {mode === 'native' && noRefHint && <span className="lip-badge">无音色参考</span>}
        {blockedHint && <span className="lip-badge warn">将降级为静音视频</span>}
        {stale && <span className="lip-badge warn">参考或台词变了，需重生成</span>}
      </div>
      {reason && <div className="lip-hint">{reason}</div>}
      {blockedHint && (
        <div className="lip-hint" data-native-degraded>
          这次不能带原生音轨：{blockedReason}。出片仍会继续，但成片是静音的。
        </div>
      )}
      {noRefHint && ref.ok && ref.kind === 'no-reference' && (
        <div className="lip-hint" data-native-no-reference>
          无音色参考：{ref.reason}。出片仍会带原生音轨，<b>声音由模型决定</b>，跨镜音色不一定一致；
          想锁定音色，去对应角色卡生成 2-30 秒音色样本即可。
        </div>
      )}
      {!reason && silentShot && hasRef && ref.ok && ref.kind === 'reference' && (
        <div className="lip-hint">
          这一镜没有台词，音色参考取角色「{ref.character}」的样本（只约束音色，不产生对白）。
        </div>
      )}
      {mode === 'native' && ref.ok && ref.kind === 'reference' && (
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
      {mode === 'native' && bodyMissingDialogue && (
        <div className="lip-hint" data-native-missing-dialogue>
          正文没写台词，模型可能只出声不说话：把「{firstLineText}」写进出片正文（声音描述）
          再出片，模型才会按这句发声。此提示不阻止出片，也不会改写正文。
        </div>
      )}
      {mode === 'native' && data.lipSync?.mode === 'provider' && (
        <div className="gen-warn">原生音频与 provider 口型互斥，请把口型切回关闭或提示词模式。</div>
      )}
    </div>
  )
}
