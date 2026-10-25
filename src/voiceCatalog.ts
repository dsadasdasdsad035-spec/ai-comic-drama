export type VoiceSource = 'preset' | 'account' | 'clone' | 'design' | 'system' | 'custom'

export type VoiceEntry = {
  /** 实际发给渠道的 voice id；保持旧字段兼容 */
  id: string
  voiceId: string
  label: string
  provider: string
  providerKind: string
  modelKey?: string
  source: VoiceSource
  note?: string
}

export type VoiceCapabilities = {
  supportsList: boolean
  supportsCustomVoiceId: boolean
  supportsClone: boolean
  supportsDesign: boolean
  supportsPreview: boolean
  maxCustomVoices?: number
}

export type CustomVoice = {
  id: string
  label: string
  provider: string
  modelKey?: string
  voiceId: string
  note?: string
  createdAt: string
}

export const VOICE_SOURCE_LABELS: Record<VoiceSource, string> = {
  preset: '预置',
  account: '账号',
  clone: '克隆',
  design: '设计',
  system: '系统',
  custom: '自定义',
}

export function voiceCapabilitiesForKind(kind: string | undefined): VoiceCapabilities {
  switch (kind) {
    case 'minimax':
      return {
        supportsList: true,
        supportsCustomVoiceId: true,
        supportsClone: false,
        supportsDesign: false,
        supportsPreview: true,
      }
    case 'elevenlabs':
      return {
        supportsList: true,
        supportsCustomVoiceId: true,
        supportsClone: false,
        supportsDesign: false,
        supportsPreview: true,
      }
    case 'volc-tts':
      return {
        supportsList: true,
        supportsCustomVoiceId: true,
        supportsClone: false,
        supportsDesign: false,
        supportsPreview: true,
      }
    case 'apimart':
      return {
        supportsList: true,
        supportsCustomVoiceId: false,
        supportsClone: false,
        supportsDesign: false,
        supportsPreview: true,
      }
    default:
      return {
        supportsList: true,
        supportsCustomVoiceId: false,
        supportsClone: false,
        supportsDesign: false,
        supportsPreview: true,
      }
  }
}

export function entryOf(input: {
  id: string
  label: string
  provider: string
  providerKind: string
  modelKey?: string
  source: VoiceSource
  note?: string
}): VoiceEntry {
  return {
    id: input.id,
    voiceId: input.id,
    label: input.label,
    provider: input.provider,
    providerKind: input.providerKind,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    source: input.source,
    ...(input.note ? { note: input.note } : {}),
  }
}

export function mergeCustomVoices(
  voices: VoiceEntry[],
  customs: CustomVoice[] | undefined,
  input: { provider: string; providerKind: string; modelKey?: string; capabilities: VoiceCapabilities },
): VoiceEntry[] {
  if (!input.capabilities.supportsCustomVoiceId) return voices
  const byId = new Map(voices.map((v) => [v.voiceId, v]))
  for (const custom of customs ?? []) {
    if (custom.provider !== input.provider) continue
    if (custom.modelKey && input.modelKey && custom.modelKey !== input.modelKey) continue
    const note = [
      custom.note,
      input.providerKind === 'volc-tts' ? '自定义 speaker，未验证' : '',
    ].filter(Boolean).join(' · ')
    byId.set(custom.voiceId, {
      id: custom.voiceId,
      voiceId: custom.voiceId,
      label: custom.label || custom.voiceId,
      provider: input.provider,
      providerKind: input.providerKind,
      ...(input.modelKey ? { modelKey: input.modelKey } : {}),
      source: 'custom',
      ...(note ? { note } : {}),
    })
  }
  return [...byId.values()]
}

/** MiniMax `/v1/get_voice` 的常见返回形状归一化；未知分类不猜。 */
export function miniMaxVoicesFromResponse(
  raw: any,
  input: { provider: string; providerKind: string; modelKey?: string },
): VoiceEntry[] {
  const out: VoiceEntry[] = []
  const add = (arr: any, source: VoiceSource) => {
    if (!Array.isArray(arr)) return
    for (const v of arr) {
      const id = String(v?.voice_id ?? v?.voiceId ?? v?.id ?? '').trim()
      if (!id) continue
      const label = String(v?.voice_name ?? v?.name ?? id)
      out.push(entryOf({ id, label, ...input, source }))
    }
  }
  const root = raw?.data ?? raw
  add(root?.system_voice, 'preset')
  add(root?.systemVoice, 'preset')
  add(root?.voice_cloning, 'clone')
  add(root?.voiceCloning, 'clone')
  add(root?.voice_generation, 'design')
  add(root?.voiceGeneration, 'design')
  return out
}

export function groupVoices(voices: VoiceEntry[]): { label: string; voices: VoiceEntry[] }[] {
  const groups = new Map<string, VoiceEntry[]>()
  for (const voice of voices) {
    const key = `${voice.provider} · ${VOICE_SOURCE_LABELS[voice.source]}`
    const list = groups.get(key) ?? []
    list.push(voice)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([label, list]) => ({ label, voices: list }))
}

export function normalizeCustomVoices(raw: unknown): CustomVoice[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CustomVoice[] = []
  for (const item of raw) {
    const v = (item || {}) as Record<string, unknown>
    const provider = String(v.provider || '').trim()
    const voiceId = String(v.voiceId || v.voice_id || '').trim()
    if (!provider || !voiceId) continue
    const key = `${provider}\u0000${voiceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: String(v.id || `${provider}:${voiceId}`),
      label: String(v.label || voiceId),
      provider,
      ...(v.modelKey ? { modelKey: String(v.modelKey) } : {}),
      voiceId,
      ...(v.note ? { note: String(v.note).slice(0, 200) } : {}),
      createdAt: String(v.createdAt || new Date().toISOString()),
    })
  }
  return out
}


export type VoiceResolution =
  | { ok: true; voice: string }
  | { ok: false; reason: string }

/** 显式角色音色优先；只有没有显式音色时才用当前镜头/渠道默认。 */
export function resolveVoiceForSpeaker(input: {
  character?: { voiceId?: string; voiceProvider?: string }
  currentProviderId?: string
  fallbackVoice?: string
}): VoiceResolution {
  const explicit = input.character?.voiceId?.trim()
  if (explicit) {
    if (input.character?.voiceProvider && input.currentProviderId && input.character.voiceProvider !== input.currentProviderId) {
      return {
        ok: false,
        reason: `角色音色属于渠道 ${input.character.voiceProvider}，当前音频模型属于 ${input.currentProviderId}；请切换音频模型或改选音色`,
      }
    }
    return { ok: true, voice: explicit }
  }
  if (input.fallbackVoice?.trim()) return { ok: true, voice: input.fallbackVoice.trim() }
  return { ok: false, reason: '当前没有可用音色（未配置 TTS 引擎）' }
}
