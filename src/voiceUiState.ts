import type { AppSettings } from './api'
import type { CharacterSheet, VoiceSample } from './characters'
import { isVoiceSampleUsable } from './characters'
import { providerIdForAudioModelKey, resolveCharacterAudioModelKey } from './voiceCatalog'

export type VoiceUiKind =
  | 'no_project'
  | 'no_voices'
  | 'provider_mismatch'
  | 'no_voice_id'
  | 'sample_stale'
  | 'sample_bad_duration'
  | 'ready_no_sample'
  | 'ready_sample_ok'

export type VoiceUiState = {
  kind: VoiceUiKind
  message: string
  tone: 'warn' | 'ok' | 'muted'
  /** 是否允许点击「生成试音」 */
  canGenerateSample: boolean
  primaryAction?: 'pick_voice' | 'generate_sample' | 'open_settings'
  tabDot: 'none' | 'warn' | 'ok'
}

export type VoiceUiInput = {
  projectName: string
  character: CharacterSheet
  settings: AppSettings | null
  voicesCount: number
  sampleStale: boolean
  sampleText: string
  voiceSample?: VoiceSample
}

export function engineShortLabel(settings: AppSettings | null, modelKey: string): string {
  const key = String(modelKey || '').trim()
  if (!key) return '默认'
  const m = settings?.models.find((x) => x.key === key)
  return m?.label || m?.model || key
}

export function voiceSummaryLine(input: VoiceUiInput): string {
  const modelKey = resolveCharacterAudioModelKey(input.character, input.settings)
  const engine = engineShortLabel(input.settings, modelKey)
  const voice =
    input.character.voiceId?.trim() ? input.character.voiceId : '未选音色'
  const ui = resolveVoiceUiState(input)
  let sample = '试音未生成'
  if (input.voiceSample && !input.sampleStale) {
    sample = isVoiceSampleUsable(input.voiceSample)
      ? `试音 ${input.voiceSample.seconds.toFixed(1)}s 可用`
      : `试音 ${input.voiceSample.seconds.toFixed(1)}s 不可用`
  } else if (input.voiceSample && input.sampleStale) {
    sample = '试音需重生成'
  }
  return `${engine} · ${voice} · ${sample}`
}

/** 声音 Tab 状态轨：按优先级返回单一阻塞或就绪态 */
export function resolveVoiceUiState(input: VoiceUiInput): VoiceUiState {
  const modelKey = resolveCharacterAudioModelKey(input.character, input.settings)
  const modelProvider = providerIdForAudioModelKey(input.settings, modelKey)
  const voiceId = input.character.voiceId?.trim()
  const voiceProvider = input.character.voiceProvider?.trim()

  if (!input.projectName.trim()) {
    return {
      kind: 'no_project',
      message: '先选择项目再配置声音与试音',
      tone: 'warn',
      canGenerateSample: false,
      tabDot: 'warn',
    }
  }

  if (input.voicesCount === 0) {
    return {
      kind: 'no_voices',
      message: '当前配音引擎没有可用音色，请到设置页检查 Key 或更换引擎',
      tone: 'warn',
      canGenerateSample: false,
      primaryAction: 'open_settings',
      tabDot: 'warn',
    }
  }

  if (voiceId && voiceProvider && modelProvider && voiceProvider !== modelProvider) {
    return {
      kind: 'provider_mismatch',
      message: '音色与配音引擎渠道不一致，请重选音色或换回对应引擎',
      tone: 'warn',
      canGenerateSample: false,
      primaryAction: 'pick_voice',
      tabDot: 'warn',
    }
  }

  if (!voiceId) {
    return {
      kind: 'no_voice_id',
      message: '请选择固定音色后再生成试音（「跟随镜头」不能生成试音）',
      tone: 'warn',
      canGenerateSample: false,
      primaryAction: 'pick_voice',
      tabDot: 'none',
    }
  }

  if (input.sampleStale) {
    return {
      kind: 'sample_stale',
      message: '引擎、音色或试音稿已变化，请重新生成试音',
      tone: 'warn',
      canGenerateSample: true,
      primaryAction: 'generate_sample',
      tabDot: 'warn',
    }
  }

  if (input.voiceSample && !isVoiceSampleUsable(input.voiceSample)) {
    return {
      kind: 'sample_bad_duration',
      message: '试音需 2–30 秒才能作为 Seedance 参考，请改短试音稿后重生成',
      tone: 'warn',
      canGenerateSample: true,
      primaryAction: 'generate_sample',
      tabDot: 'warn',
    }
  }

  if (input.voiceSample && isVoiceSampleUsable(input.voiceSample)) {
    return {
      kind: 'ready_sample_ok',
      message: `试音 ${input.voiceSample.seconds.toFixed(1)} 秒，可用于 Seedance 音色参考`,
      tone: 'ok',
      canGenerateSample: true,
      primaryAction: 'generate_sample',
      tabDot: 'ok',
    }
  }

  return {
    kind: 'ready_no_sample',
    message: '声线已就绪，可生成试音样本',
    tone: 'muted',
    canGenerateSample: true,
    primaryAction: 'generate_sample',
    tabDot: 'none',
  }
}

/** 换引擎后 voiceId 是否仍在新目录中（不含「未知保留」） */
export function voiceIdInCatalog(voiceId: string | undefined, voices: { id: string }[]): boolean {
  const id = String(voiceId || '').trim()
  if (!id) return false
  return voices.some((v) => v.id === id)
}
