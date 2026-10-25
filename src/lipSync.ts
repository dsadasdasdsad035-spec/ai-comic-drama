import { shortHash } from './scheduleGeometry'
import type { LipSyncMode, LipSyncState } from './types'

export type LipSyncEligibility = {
  ok: boolean
  reason?: string
  speakerCount: number
}

export function normalizeLipSyncMode(mode: unknown): LipSyncMode {
  return mode === 'prompt' || mode === 'provider' ? mode : 'off'
}

export function normalizeLipSyncState(input: unknown): LipSyncState {
  const raw = (input || {}) as Partial<LipSyncState>
  return {
    mode: normalizeLipSyncMode(raw.mode),
    ...(raw.provider ? { provider: raw.provider } : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.sourceVideo ? { sourceVideo: raw.sourceVideo } : {}),
    ...(raw.audio ? { audio: raw.audio } : {}),
    ...(raw.outputVideo ? { outputVideo: raw.outputVideo } : {}),
    ...(raw.fingerprint ? { fingerprint: raw.fingerprint } : {}),
    ...(raw.adopted ? { adopted: true } : {}),
    ...(raw.error ? { error: raw.error } : {}),
    ...(raw.qa ? { qa: raw.qa } : {}),
  }
}

export function speakerNames(dialogue: { speaker: string; text: string }[] | undefined): string[] {
  return Array.from(
    new Set(
      (dialogue ?? [])
        .filter((line) => line.speaker && String(line.text ?? '').trim())
        .map((line) => line.speaker),
    ),
  )
}

export function lipSyncEligibility(input: {
  mode: LipSyncMode
  dialogue: { speaker: string; text: string }[]
  videoUrl?: string
  voiceUrl?: string
  providerConfigured: boolean
}): LipSyncEligibility {
  const speakers = speakerNames(input.dialogue)
  if (input.mode === 'off') return { ok: true, speakerCount: speakers.length }
  if (input.mode === 'prompt') {
    if (speakers.length === 0) return { ok: false, reason: '这一镜没有台词，prompt 口型不会生效', speakerCount: 0 }
    return { ok: true, speakerCount: speakers.length }
  }
  if (!input.videoUrl) return { ok: false, reason: '先生成或选择视频，再做 provider 口型', speakerCount: speakers.length }
  if (!input.voiceUrl) return { ok: false, reason: '先生成台词配音，再做 provider 口型', speakerCount: speakers.length }
  if (speakers.length === 0) return { ok: false, reason: '这一镜没有台词，不能做口型', speakerCount: 0 }
  if (speakers.length > 1) {
    return {
      ok: false,
      reason: '多说话人镜头暂不支持 provider 口型；请拆成单人镜，或先用 prompt 模式',
      speakerCount: speakers.length,
    }
  }
  if (!input.providerConfigured) return { ok: false, reason: '还没有配置口型 provider，去设置页填写', speakerCount: speakers.length }
  return { ok: true, speakerCount: speakers.length }
}

export function lipSyncFingerprint(
  videoUrl: string | undefined,
  audioUrl: string | undefined,
  dialogue: { speaker: string; text: string }[],
): string {
  return shortHash(
    JSON.stringify({
      video: videoUrl || '',
      audio: audioUrl || '',
      dialogue: dialogue.map((line) => [line.speaker, line.text]),
    }),
  )
}

export function lipSyncStale(
  state: LipSyncState | undefined,
  videoUrl: string | undefined,
  audioUrl: string | undefined,
  dialogue: { speaker: string; text: string }[],
): boolean {
  if (!state?.outputVideo) return false
  const expected = state.fingerprint || lipSyncFingerprint(state.sourceVideo, state.audio, dialogue)
  return expected !== lipSyncFingerprint(videoUrl, audioUrl, dialogue)
}

/** 预览/导出用：adopted 且有待选口型视频时使用口型版。 */
export function activeVideoUrl(data: {
  videoUrl?: string
  lipSync?: LipSyncState
}): string | undefined {
  return data.lipSync?.adopted && data.lipSync.outputVideo ? data.lipSync.outputVideo : data.videoUrl
}
