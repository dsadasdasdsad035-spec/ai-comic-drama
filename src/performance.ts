import { shortHash } from './scheduleGeometry'
import type {
  DialogueDelivery,
  PerformanceEmotion,
  PerformanceEntry,
  PerformancePace,
  PerformanceVolume,
} from './types'
import { PERFORMANCE_EMOTION_LABELS, PERFORMANCE_EMOTIONS } from './types'

export const EMOTION_OPTIONS = PERFORMANCE_EMOTIONS.map((value) => ({
  value,
  label: PERFORMANCE_EMOTION_LABELS[value],
}))

export const PACE_OPTIONS: { value: PerformancePace; label: string }[] = [
  { value: 'slow', label: '慢' },
  { value: 'normal', label: '中' },
  { value: 'fast', label: '快' },
]

export const VOLUME_OPTIONS: { value: PerformanceVolume; label: string }[] = [
  { value: 'whisper', label: '耳语' },
  { value: 'soft', label: '压低' },
  { value: 'normal', label: '正常' },
  { value: 'loud', label: '放大' },
  { value: 'shout', label: '爆发' },
]

export function emotionLabel(e: PerformanceEmotion | undefined): string {
  return e ? PERFORMANCE_EMOTION_LABELS[e] : '平静'
}

export function defaultPerformance(character: string, speaks = false): PerformanceEntry {
  return { character, emotion: 'neutral', intensity: 3, speaks }
}

export function normalizePerformanceEntry(input: PerformanceEntry): PerformanceEntry {
  const emotion = PERFORMANCE_EMOTIONS.includes(input.emotion) ? input.emotion : 'neutral'
  const intensity = Math.max(0, Math.min(5, Math.round(Number(input.intensity) || 0)))
  return {
    character: String(input.character || '').trim(),
    emotion,
    intensity,
    ...(input.action?.trim() ? { action: input.action.trim() } : {}),
    ...(input.gaze?.trim() ? { gaze: input.gaze.trim() } : {}),
    ...(typeof input.speaks === 'boolean' ? { speaks: input.speaks } : {}),
  }
}

/** cast 是权威名单；performance 里多出的角色也保留，方便用户删。 */
export function ensurePerformance(
  cast: string[] | undefined,
  performance: PerformanceEntry[] | undefined,
  dialogue: { speaker: string; text: string }[],
): PerformanceEntry[] {
  const speakers = new Set(dialogue.filter((d) => d.speaker).map((d) => d.speaker))
  const names: string[] = []
  for (const name of cast ?? []) if (name && !names.includes(name)) names.push(name)
  for (const entry of performance ?? []) {
    if (entry.character && !names.includes(entry.character)) names.push(entry.character)
  }
  for (const name of speakers) if (name && !names.includes(name)) names.push(name)
  const byName = new Map((performance ?? []).map((p) => [p.character, normalizePerformanceEntry(p)]))
  return names.map((name) => byName.get(name) ?? defaultPerformance(name, speakers.has(name)))
}

export function performanceSummary(entries: PerformanceEntry[] | undefined): string {
  if (!entries?.length) return ''
  return entries
    .filter((e) => e.character)
    .map((e) => {
      const bits = [`${e.character} ${emotionLabel(e.emotion)}${e.intensity ?? 3}`]
      if (e.action?.trim()) bits.push(e.action.trim())
      else if (e.gaze?.trim()) bits.push(`看${e.gaze.trim()}`)
      return bits.join(' ')
    })
    .join(' · ')
}

export function deliveryForLine(
  delivery: DialogueDelivery[] | undefined,
  index: number,
): DialogueDelivery {
  return delivery?.[index] ?? {}
}

/** 逐行表演优先；没有逐行数据时退到该角色的镜头表演。 */
export function deliveryForSpeaker(
  performance: PerformanceEntry[] | undefined,
  speaker: string,
  delivery: DialogueDelivery[] | undefined,
  index: number,
): DialogueDelivery {
  const line = deliveryForLine(delivery, index)
  if (Object.keys(line).length) return line
  const entry = performance?.find((p) => p.character === speaker)
  return entry ? { emotion: entry.emotion, intensity: entry.intensity } : {}
}

/** 台词文本 + 表演参数指纹；用于判断配音是否过期。 */
export function voiceFingerprint(text: string, delivery?: DialogueDelivery[]): string {
  return shortHash(JSON.stringify({ text: String(text || ''), delivery: delivery ?? [] }))
}
