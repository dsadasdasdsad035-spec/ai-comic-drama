import { isVoiceSampleUsable, type CharacterSheet } from './characters'
import { shortHash } from './scheduleGeometry'
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

/** 真实 APIMart 探测结果：单个 audio_url 字符串；2 秒视频被拒绝，最短 4 秒。 */
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

/** 首期只接受唯一说话角色；多说话人返回明确原因，不混多个音频。 */
export function nativeAudioRef(input: {
  dialogue: { speaker: string; text: string }[]
  performance?: PerformanceEntry[]
  characters: CharacterSheet[]
  caps: AudioRefCapabilities | null
  seconds: number
}): NativeAudioRefResult {
  if (!input.caps?.supported) return { ok: false, reason: '当前视频模型没有通过音频参考探测' }
  if (Number(input.seconds) < input.caps.minVideoSeconds) {
    return { ok: false, reason: `原生音频最短 ${input.caps.minVideoSeconds} 秒，当前镜头 ${input.seconds}s` }
  }
  const speakers = speakingNames(input.dialogue, input.performance)
  if (speakers.length === 0) return { ok: false, reason: '这一镜没有台词，不能使用音色参考' }
  if (speakers.length > 1) {
    return { ok: false, reason: '首期原生音频只支持单说话人；请拆成单人镜或改用静音视频 + TTS' }
  }
  const character = speakers[0]
  const card = input.characters.find((c) => c.name === character || c.id === character)
  if (!card) return { ok: false, reason: `找不到角色卡：${character}` }
  const sample = card.voiceSample
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
