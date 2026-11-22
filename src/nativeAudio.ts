import { isVoiceSampleUsable, type CharacterSheet } from './characters'
import { shortHash } from './hash'
import type { AudioMeta, AudioRef, PerformanceEntry } from './types'

export type AudioRefCapabilities = {
  supported: boolean
  audioRefField: 'audio_url' | ''
  maxRefAudios: number
  minSeconds: number
  maxSeconds: number
  minVideoSeconds: number
  supportsMultiSpeaker: boolean
  source: string
}

/** 真实 APIMart 探测结果：单个 audio_url 字符串；2 秒视频被拒绝。产品门禁：名义镜头须大于 4 秒（不含 4）。 */

export const APIMART_SEEDANCE_AUDIO_CAPS: AudioRefCapabilities = {
  supported: true,
  audioRefField: 'audio_url',
  maxRefAudios: 1,
  minSeconds: 2,
  maxSeconds: 30,
  minVideoSeconds: 4,
  supportsMultiSpeaker: false,
  source: 'apimart-empirical',
}

export function audioRefCapabilitiesFor(input: {
  providerKind?: string
  model?: string
  audioOut?: boolean
}): AudioRefCapabilities | null {
  if (input.providerKind !== 'apimart') return null
  if (!input.audioOut) return null
  if (!/seedance[-_ ]?2[.-]?5/i.test(String(input.model || ''))) return null
  return APIMART_SEEDANCE_AUDIO_CAPS
}

export function speakingNames(
  dialogue: { speaker: string; text: string }[],
  performance?: PerformanceEntry[],
): string[] {
  const names = new Set<string>()
  for (const line of dialogue) {
    if (line.speaker && String(line.text || '').trim()) names.add(line.speaker)
  }
  return [...names]
}

export type NativeAudioRefResult =
  | { ok: true; character: string; url: string; ref: AudioRef; sampleSeconds: number }
  | { ok: false; reason: string }

function findCharacter(characters: CharacterSheet[], name: string): CharacterSheet | undefined {
  return characters.find((c) => c.name === name || c.id === name)
}

/** 角色卡的展示名（名字优先，缺省用 id） */
function characterLabel(card: CharacterSheet): string {
  return card.name || card.id
}

/**
 * 解析本镜要用的音色参考。
 *
 * 音色参考约束的是「用什么声音说话」，与这一镜写不写台词无关：无声镜也可以
 * 带原生音轨（环境声、呼吸、即兴发声），同样需要一个音色锚点。所以**没有台词
 * 不是禁用条件**——此时不猜说话人，按 `preferredCharacter`（镜上已保存的选择）
 * 再到第一个有可用样本的角色卡。以前这里直接报「这一镜没有台词」，等于把
 * 「推断不出说话人」当成了「不能用」，用户只能去编一句台词才能开开关。
 *
 * 仍然拦住多说话人：APIMart Seedance 2.5 只接受一个 audio_url
 * （`maxRefAudios: 1`、`supportsMultiSpeaker: false`），混两段音色不是保守做法，
 * 而是上游根本不支持。
 */
export function nativeAudioRef(input: {
  dialogue: { speaker: string; text: string }[]
  performance?: PerformanceEntry[]
  characters: CharacterSheet[]
  caps: AudioRefCapabilities | null
  seconds: number
  /** 镜上已保存的音色角色；没有台词时用它决定取谁的样本 */
  preferredCharacter?: string
}): NativeAudioRefResult {
  if (!input.caps?.supported) return { ok: false, reason: '当前视频模型没有通过音频参考探测' }
  const minReq = input.caps.minVideoSeconds + 1
  if (Number(input.seconds) < minReq) {
    return {
      ok: false,
      reason: `原生音频请求须至少 ${minReq} 秒（当前按 ${input.seconds}s 计）`,
    }
  }
  const speakers = speakingNames(input.dialogue, input.performance)
  if (speakers.length > 1) {
    return { ok: false, reason: '首期原生音频只支持单说话人；请拆成单人镜或改用静音视频 + TTS' }
  }

  // 有唯一说话人时以说话人为准；无声镜沿用已保存的角色。
  // 两条路径都先按名字定位，只有「一个名字都没有」时才去扫可用样本。
  const named = speakers[0] || String(input.preferredCharacter || '').trim()
  const card = named ? findCharacter(input.characters, named) : undefined
  if (named && !card) return { ok: false, reason: `找不到角色卡：${named}` }

  const chosen = card ?? input.characters.find((c) => isVoiceSampleUsable(c.voiceSample))
  if (!chosen) {
    return { ok: false, reason: '没有可用的角色音色样本：请先在某张角色卡里生成 2-30 秒的音色样本' }
  }
  const character = characterLabel(chosen)
  const sample = chosen.voiceSample
  if (!sample) return { ok: false, reason: `角色「${character}」还没有音色样本` }
  if (sample.stale) return { ok: false, reason: `角色「${character}」的音色样本已失效，请重生成` }
  if (!isVoiceSampleUsable(sample)) {
    return { ok: false, reason: `角色「${character}」样本 ${sample.seconds.toFixed(1)}s，需 ${input.caps.minSeconds}-${input.caps.maxSeconds} 秒` }
  }
  return {
    ok: true,
    character,
    url: sample.url,
    ref: { character, url: sample.url, label: `${character} 音色` },
    sampleSeconds: sample.seconds,
  }
}

/** 原生音频提示词只写声音段；运动提示词仍由调用方单独拼。 */
export function nativeAudioPrompt(
  character: string,
  dialogue: { speaker: string; text: string }[],
  hasReference: boolean,
): string {
  const lines = dialogue.filter((line) => line.speaker === character && String(line.text || '').trim())
  if (lines.length === 0) return ''
  const spoken = lines.map((line) => `${character}说：“${line.text}”`).join('\n')
  return (
    '声音：\n' +
    `${spoken}\n` +
    (hasReference ? '音色参考音频1。' : '无音色参考，声音由模型决定。') +
    '\n嘴型与台词同步，不生成额外对白、字幕或画外旁白。'
  )
}

export function nativeAudioFingerprint(input: {
  modelKey?: string
  audioRef?: AudioRef | null
  dialogue: { speaker: string; text: string }[]
}): string {
  return shortHash(
    JSON.stringify({
      model: input.modelKey || '',
      audio: input.audioRef?.url || '',
      character: input.audioRef?.character || '',
      dialogue: input.dialogue.map((line) => [line.speaker, line.text]),
    }),
  )
}

export function nativeAudioStale(
  meta: AudioMeta | undefined,
  input: {
    modelKey?: string
    audioRef?: AudioRef | null
    dialogue: { speaker: string; text: string }[]
  },
): boolean {
  if (!meta?.fingerprint) return false
  return meta.fingerprint !== nativeAudioFingerprint(input)
}
