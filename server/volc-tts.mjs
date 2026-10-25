/**
 * 火山 Seed TTS 2.0（Agent Plan）客户端。
 * 纯 HTTP + 行式 JSON 解析，不依赖 vite，可用 node 直接测试。
 */
import crypto from 'node:crypto'

export const VOLC_TTS_RESOURCE_ID = 'seed-tts-2.0'
export const DEFAULT_VOLC_TTS_VOICE = 'zh_female_vv_uranus_bigtts'
export const VOLC_TTS_VOICES = [
  { id: 'zh_female_vv_uranus_bigtts', label: '火山 · 通用女声' },
  { id: 'zh_female_gaolengyujie_uranus_bigtts', label: '火山 · 高冷御姐' },
]

export class VolcTtsError extends Error {
  constructor(message, { kind = 'api', code = 0, status = 0 } = {}) {
    super(message)
    this.name = 'VolcTtsError'
    this.kind = kind
    this.code = code
    this.status = status
  }
}

function ttsEndpoint(baseUrl) {
  const base = String(baseUrl || 'https://openspeech.bytedance.com/api/v3/plan').replace(/\/+$/, '')
  return `${base}/tts/unidirectional`
}

function pickSpeaker(speaker, allowCustom = false) {
  const id = String(speaker || '').trim()
  if (allowCustom && id) return id
  return VOLC_TTS_VOICES.some((v) => v.id === id) ? id : DEFAULT_VOLC_TTS_VOICE
}

const EMOTIONS = new Set([
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
])

const PACE_RATE = { slow: -20, normal: 0, fast: 20 }
const VOLUME_LOUDNESS = { whisper: -20, soft: -10, normal: 0, loud: 10, shout: 20 }

/** 把归一化表演参数映射到火山 Seed TTS 2.0 的 req_params，并报告实际应用项。 */
export function mapVoicePerformance(performance = {}) {
  const p = performance || {}
  const applied = []
  const unsupported = []
  const extra = {}
  if (p.emotion && p.emotion !== 'neutral') {
    if (EMOTIONS.has(p.emotion)) {
      extra.emotion = p.emotion
      applied.push('emotion')
      if (typeof p.intensity === 'number' && Number.isFinite(p.intensity)) {
        extra.emotion_scale = Math.max(1, Math.min(5, Math.round(p.intensity)))
        applied.push('intensity')
      }
    } else {
      unsupported.push('emotion')
    }
  } else if (typeof p.intensity === 'number' && Number.isFinite(p.intensity)) {
    unsupported.push('intensity')
  }
  if (p.pace && p.pace !== 'normal') {
    if (p.pace in PACE_RATE) {
      extra.speech_rate = PACE_RATE[p.pace]
      applied.push('pace')
    } else {
      unsupported.push('pace')
    }
  }
  if (p.volume && p.volume !== 'normal') {
    if (p.volume in VOLUME_LOUDNESS) {
      extra.loudness_rate = VOLUME_LOUDNESS[p.volume]
      applied.push('volume')
    } else {
      unsupported.push('volume')
    }
  }
  if (p.emphasis) unsupported.push('emphasis')
  return { extra, applied, unsupported }
}

export function buildTtsBody({ text, speaker, performance, allowCustomSpeaker = false }) {
  const value = String(text || '').trim()
  if (!value) throw new VolcTtsError('台词为空', { kind: 'config' })
  const mapped = mapVoicePerformance(performance)
  return {
    user: { uid: 'storyboard-canvas' },
    req_params: {
      text: value,
      speaker: pickSpeaker(speaker, allowCustomSpeaker),
      audio_params: { format: 'mp3', sample_rate: 24000 },
      ...mapped.extra,
    },
  }
}

function parseFirstJson(raw) {
  const first = String(raw || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean)
  if (!first) return null
  try {
    return JSON.parse(first)
  } catch {
    return null
  }
}

function codeOf(obj) {
  return Number(obj?.code ?? obj?.header?.code ?? 0)
}

function messageOf(obj) {
  return String(obj?.message ?? obj?.header?.message ?? '')
}

function errorFromResponse(raw, status) {
  const obj = parseFirstJson(raw)
  const code = obj ? codeOf(obj) : 0
  const message = (obj && messageOf(obj)) || String(raw || '').slice(0, 300)
  const kind =
    status === 401 || status === 403
      ? 'auth'
      : /AgentPlanDeductNotEnabled/.test(`${message} ${raw}`)
        ? 'plan'
        : 'api'
  return new VolcTtsError(`${code ? `code ${code} ` : ''}${message}`, { kind, code, status })
}

function errorFromCode(code, message, raw) {
  if (/AgentPlanDeductNotEnabled/.test(`${message} ${raw}`)) {
    return new VolcTtsError(
      `需在 Agent Plan 控制台开启扣减：${message || 'AgentPlanDeductNotEnabled'}`,
      { kind: 'plan', code },
    )
  }
  return new VolcTtsError(`火山 TTS ${code}：${message || '合成失败'}`, { kind: 'api', code })
}

/**
 * 合成一段文本，返回合并后的音频 Buffer。
 * 响应是按行返回的 JSON：code=0 的 data 为 base64 音频，code=20000000 表示结束。
 */
export async function synthesizeVolcTts({
  baseUrl,
  apiKey,
  text,
  speaker,
  performance,
  allowCustomSpeaker = false,
  fetchImpl = fetch,
  connectId = crypto.randomUUID(),
}) {
  const body = buildTtsBody({ text, speaker, performance, allowCustomSpeaker })
  const mapped = mapVoicePerformance(performance)
  const r = await fetchImpl(ttsEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': VOLC_TTS_RESOURCE_ID,
      'X-Api-Connect-Id': connectId,
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })

  const raw = await r.text()
  if (!r.ok) throw errorFromResponse(raw, r.status)

  const chunks = []
  for (const line of raw.split('\n')) {
    const value = line.trim()
    if (!value) continue
    let obj
    try {
      obj = JSON.parse(value)
    } catch {
      throw new VolcTtsError(`TTS 返回了非 JSON 行：${value.slice(0, 120)}`, { kind: 'protocol' })
    }
    const code = codeOf(obj)
    if (code === 20000000) break
    if (code !== 0) throw errorFromCode(code, messageOf(obj), raw)
    const data = obj?.data
    const b64 =
      typeof data === 'string' ? data : typeof data?.audio === 'string' ? data.audio : ''
    if (b64) chunks.push(Buffer.from(b64, 'base64'))
  }

  if (chunks.length === 0) {
    throw new VolcTtsError('TTS 未返回音频数据', { kind: 'protocol' })
  }
  return {
    audio: Buffer.concat(chunks),
    engine: `volc-tts:${body.req_params.speaker}`,
    speaker: body.req_params.speaker,
    applied: mapped.applied,
    unsupported: mapped.unsupported,
  }
}
