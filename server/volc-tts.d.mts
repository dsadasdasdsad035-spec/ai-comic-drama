/** server/volc-tts.mjs 的类型声明（火山 Seed TTS 2.0 客户端） */

export interface VolcTtsVoice {
  id: string
  label: string
}

export declare const VOLC_TTS_RESOURCE_ID: string
export declare const DEFAULT_VOLC_TTS_VOICE: string
export declare const VOLC_TTS_VOICES: VolcTtsVoice[]

export declare class VolcTtsError extends Error {
  kind: string
  code: number
  status: number
  constructor(message: string, opts?: { kind?: string; code?: number; status?: number })
}

export interface VolcVoicePerformance {
  emotion?: string
  intensity?: number
  pace?: string
  volume?: string
  emphasis?: string
}

export declare function buildTtsBody(opts: {
  text: string
  speaker?: string
  performance?: VolcVoicePerformance
  allowCustomSpeaker?: boolean
}): {
  user: { uid: string }
  req_params: {
    text: string
    speaker: string
    audio_params: { format: string; sample_rate: number }
    [key: string]: unknown
  }
}

export declare function synthesizeVolcTts(opts: {
  baseUrl: string
  apiKey: string
  text: string
  speaker?: string
  performance?: VolcVoicePerformance
  allowCustomSpeaker?: boolean
  fetchImpl?: typeof fetch
  connectId?: string
}): Promise<{
  audio: Buffer
  engine: string
  speaker: string
  applied: string[]
  unsupported: string[]
}>
