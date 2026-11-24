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

/** 真实 APIMart 探测结果：单个 audio_url 字符串（可选参考）；2 秒视频被拒绝，4 秒合法。产品门禁：镜头须 ≥4 秒。 */

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

/**
 * 解析结果分三种，调用方必须显式分流：
 * - `reference`：有可用样本，带 `audio_url` 提交，音色跨镜一致。
 * - `no-reference`：**可以出片**，但只发 `generate_audio`，声音由模型决定。
 * - `blocked`：只剩上游一定会拒绝的两种情况——模型没有音频能力、镜头短于下限。
 *
 * 以前的形状只有 `ok: true/false`，把「没有样本」和「不能出片」混成一个 false，
 * 结果是无样本时整条降级成静音视频——与 spec「无样本可选无参考」直接冲突。
 * 2026-11-22 实测证明 `generate_audio:true` 不传 `audio_url` 也能出声带台词
 * （`task_01M81KX9X0DN2JBVBSXS9KCGY1`），所以这里把它拆成可提交的独立状态。
 */
export type NativeAudioRefResult =
  | {
      ok: true
      kind: 'reference'
      character: string
      url: string
      ref: AudioRef
      sampleSeconds: number
    }
  | {
      ok: true
      kind: 'no-reference'
      /** 说话角色（能判定时）；纯空镜为 '' */
      character: string
      /** 为什么没有参考，直接用于 UI 说明与出片 warn */
      reason: string
    }
  | { ok: false; kind: 'blocked'; reason: string }

/** 构造阻断结果；`reason` 必须可直接展示给用户 */
function blocked(reason: string): NativeAudioRefResult {
  return { ok: false, kind: 'blocked', reason }
}

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
 * 再到第一个有可用样本的角色卡。
 *
 * **不做强门镜**：音色参考只是可选增强，只有「模型没有原生音频能力」和
 * 「镜头短于上游下限」这两种上游一定会拒绝的情况才 `blocked`。其余一律降级成
 * `no-reference` 照常出片，只发 `generate_audio`、声音由模型决定：
 *
 * - 多说话人：上游只接受一条 `audio_url`（`maxRefAudios: 1`）。硬选其中一人
 *   会让所有人同声，比不带参考更失真，所以本次不带参考但仍出音轨。
 * - 说话人不在角色库：没有卡就没有样本，猜不出该用谁的音色。
 * - 样本不合规（时长超范围）：不是用户本意，但也不该因此拒绝出片；明说这次
 *   没用参考，用户想锁定音色再去重新生成样本。
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
  if (!input.caps?.supported) return blocked('当前视频模型没有通过音频参考探测')
  // 下限是含边界的：Seedance 2.5 实测 4 秒合法
  const minReq = Math.max(0, Number(input.caps.minVideoSeconds) || 0)
  if (Number(input.seconds) < minReq) {
    return blocked(`原生音频请求最短 ${minReq} 秒（当前按 ${input.seconds}s 计）`)
  }
  const speakers = speakingNames(input.dialogue, input.performance)

  // 有唯一说话人时以说话人为准；无声镜沿用已保存的角色。
  // 两条路径都先按名字定位，只有「一个名字都没有」时才去扫可用样本。
  const named = speakers[0] || String(input.preferredCharacter || '').trim()
  const card = named ? findCharacter(input.characters, named) : undefined
  /** 无参考时的角色名：能定位到卡就用卡名，否则沿用台词里的说话人 */
  const speakerLabel = card ? characterLabel(card) : named

  // 多说话人：上游一条 audio_url 装不下两套音色。不拦出片，只是本次不带参考。
  if (speakers.length > 1) {
    return {
      ok: true,
      kind: 'no-reference',
      character: speakerLabel,
      reason: `本镜有多个说话人（${speakers.join('、')}），音色参考只支持单个角色`,
    }
  }
  // 说话人不在角色库：没有卡就没有样本，同样降级而不是拒绝出片。
  if (named && !card) {
    return {
      ok: true,
      kind: 'no-reference',
      character: named,
      reason: `说话人「${named}」不在角色库里`,
    }
  }

  const chosen = card ?? input.characters.find((c) => isVoiceSampleUsable(c.voiceSample))
  if (!chosen) {
    return {
      ok: true,
      kind: 'no-reference',
      character: speakerLabel,
      reason: '没有可用的角色音色样本',
    }
  }
  const character = characterLabel(chosen)
  const sample = chosen.voiceSample
  if (!sample) {
    return {
      ok: true,
      kind: 'no-reference',
      character,
      reason: `角色「${character}」还没有音色样本`,
    }
  }
  // 样本存在但已失效（换过 voiceId/模型/试音稿）：按无参考出片，但要说清原因，
  // 不能让人以为这次用的是旧样本。
  if (sample.stale) {
    return {
      ok: true,
      kind: 'no-reference',
      character,
      reason: `角色「${character}」的音色样本已失效，本次声音由模型决定`,
    }
  }
  // 样本记录没有音频文件：等同没样本（没有东西可解析成 audio_url）
  if (!String(sample.url || '').trim()) {
    return {
      ok: true,
      kind: 'no-reference',
      character,
      reason: `角色「${character}」的音色样本缺少音频文件`,
    }
  }
  if (!isVoiceSampleUsable(sample)) {
    return {
      ok: true,
      kind: 'no-reference',
      character,
      reason: `角色「${character}」的样本 ${sample.seconds.toFixed(1)}s 不在 ${input.caps.minSeconds}-${input.caps.maxSeconds} 秒范围内`,
    }
  }
  return {
    ok: true,
    kind: 'reference',
    character,
    url: sample.url,
    ref: { character, url: sample.url, label: `${character} 音色` },
    sampleSeconds: sample.seconds,
  }
}

/** 原生音频提示词只写声音段；出片正文由调用方单独写。 */
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
