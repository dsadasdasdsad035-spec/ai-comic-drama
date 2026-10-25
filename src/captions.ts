import { parseDialogue } from './prompts'

export type CaptionTiming = 'voice' | 'shot' | 'native-estimate'

export type CaptionCue = {
  id: string
  shotId: string
  text: string
  speaker?: string
  startOffsetMs: number
  endOffsetMs: number
  timing: CaptionTiming
  estimated: boolean
  /** subOffset 导致 cue 被夹到镜头内 */
  clamped?: boolean
}

export type CaptionIssue = {
  level: 'error' | 'warn'
  code: string
  message: string
  cueId?: string
}

export type CaptionStyle = {
  fontRatio: number
  bottomRatio: number
  maxWidthRatio: number
  lineHeight: number
  maxLines: number
  maxCharsPerLine: number
  background: string
  textColor: string
  fontFamily: string
  radius: number
}

export const CAPTION_STYLE: CaptionStyle = {
  fontRatio: 0.044,
  bottomRatio: 0.06,
  maxWidthRatio: 0.78,
  lineHeight: 1.42,
  maxLines: 2,
  maxCharsPerLine: 18,
  background: 'rgba(4, 8, 14, 0.58)',
  textColor: '#f4f8fc',
  fontFamily:
    '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  radius: 14,
}

const MIN_CUE_MS = 600
const MAX_CUE_MS = 6000
const CUE_GAP_MS = 60
const EDGE_MS = 80

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** 中文按字符数切；优先在逗号/顿号处断开 */
function splitLongPart(text: string, maxChars: number): string[] {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return [text]
  const out: string[] = []
  let rest = chars
  while (rest.length > maxChars) {
    let cut = -1
    for (let i = Math.min(maxChars, rest.length - 1); i >= Math.max(4, Math.floor(maxChars * 0.45)); i--) {
      if ('，、,:：'.includes(rest[i - 1])) {
        cut = i
        break
      }
    }
    if (cut < 0) cut = maxChars
    out.push(rest.slice(0, cut).join('').trim())
    rest = rest.slice(cut)
    while (rest.length && /\s/.test(rest[0])) rest = rest.slice(1)
  }
  if (rest.length) out.push(rest.join('').trim())
  return out.filter(Boolean)
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => splitLongPart(part, CAPTION_STYLE.maxCharsPerLine))
}

type CaptionSource = { speaker?: string; text: string }

function captionSources(dialogue: string): CaptionSource[] {
  return parseDialogue(dialogue).flatMap((line) => {
    const text = String(line.text || '').trim()
    if (!text) return []
    return splitSentences(text).map((part) => ({
      ...(line.speaker ? { speaker: line.speaker } : {}),
      text: part,
    }))
  })
}

/** 将一组 cue 在 [start, end] 内按文本长度分配，保证不重叠、留出间隔 */
function allocate(
  sources: CaptionSource[],
  start: number,
  end: number,
  timing: CaptionTiming,
  estimated: boolean,
  shotId: string,
  clamped: boolean,
): CaptionCue[] {
  const span = Math.max(0, end - start)
  if (!sources.length || span <= 0) return []
  const n = sources.length
  const gap = n > 1 ? Math.min(CUE_GAP_MS, Math.max(0, (span - n * 200) / (n - 1))) : 0
  const usable = Math.max(0, span - gap * (n - 1))
  const weights = sources.map((s) => Math.max(1, Array.from(s.text).length))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  let durations = weights.map((w) => (usable * w) / totalWeight)
  const rawTotal = durations.reduce((sum, d) => sum + d, 0)
  if (rawTotal > usable && rawTotal > 0) {
    const factor = usable / rawTotal
    durations = durations.map((d) => d * factor)
  }
  const cues: CaptionCue[] = []
  let cursor = start
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1
    const duration = isLast
      ? Math.max(0, end - cursor)
      : Math.max(0, Math.round(durations[i]))
    const cueEnd = Math.min(end, cursor + duration)
    if (cueEnd > cursor) {
      cues.push({
        id: `${shotId}:${i}`,
        shotId,
        text: sources[i].text,
        ...(sources[i].speaker ? { speaker: sources[i].speaker } : {}),
        startOffsetMs: Math.round(cursor),
        endOffsetMs: Math.round(cueEnd),
        timing,
        estimated,
        ...(clamped ? { clamped: true } : {}),
      })
    }
    cursor = cueEnd + gap
    if (cursor >= end && !isLast) break
  }
  return cues
}

/**
 * 从台词派生字幕 cue。输出相对镜头起点，预览/导出/时间线共用。
 * 有 TTS 时按配音区间分配；native/无配音按镜头时长估算。
 */
export function buildShotCaptions(input: {
  shotId: string
  dialogue: string
  shotSeconds: number
  voiceSeconds?: number
  voiceOffset?: number
  subOffset?: number
  audioMode?: 'off' | 'native'
}): CaptionCue[] {
  const sources = captionSources(input.dialogue || '')
  if (!sources.length) return []
  const shotMs = Math.max(200, Math.round((Number(input.shotSeconds) || 2) * 1000))
  const voiceMs = Math.max(0, Math.round((Number(input.voiceSeconds) || 0) * 1000))
  const voiceOffsetMs = Math.round((Number(input.voiceOffset) || 0) * 1000)
  const subOffsetMs = Math.round((Number(input.subOffset) || 0) * 1000)
  const hasVoice = voiceMs > 0

  if (hasVoice) {
    const requestedStart = voiceOffsetMs + subOffsetMs
    const requestedEnd = voiceOffsetMs + voiceMs + subOffsetMs
    const start = clamp(requestedStart, 0, Math.max(0, shotMs - EDGE_MS))
    const end = clamp(requestedEnd, start + 120, Math.max(start + 120, shotMs - EDGE_MS / 2))
    const clamped = start !== requestedStart || end !== requestedEnd
    return allocate(sources, start, end, 'voice', false, input.shotId, clamped)
  }

  const requestedStart = 150 + subOffsetMs
  const requestedEnd = shotMs - EDGE_MS + subOffsetMs
  const start = clamp(requestedStart, 0, Math.max(0, shotMs - 200))
  const end = clamp(requestedEnd, start + 150, Math.max(start + 150, shotMs - 40))
  const clamped = start !== requestedStart || end !== requestedEnd
  const timing: CaptionTiming = input.audioMode === 'native' ? 'native-estimate' : 'shot'
  return allocate(sources, start, end, timing, true, input.shotId, clamped)
}

/** 逐镜校验；导出前 errors 阻止，warnings 需确认 */
export function validateCaptions(cues: CaptionCue[], shotSeconds: number): CaptionIssue[] {
  const shotMs = Math.max(200, Math.round((Number(shotSeconds) || 2) * 1000))
  const issues: CaptionIssue[] = []
  let prevEnd = -1
  for (const cue of cues) {
    const text = String(cue.text || '').trim()
    if (!text) {
      issues.push({ level: 'error', code: 'empty', message: '字幕文本为空', cueId: cue.id })
      continue
    }
    if (cue.endOffsetMs <= cue.startOffsetMs) {
      issues.push({
        level: 'error',
        code: 'invalid-range',
        message: `cue 起止倒置：${cue.startOffsetMs}–${cue.endOffsetMs}`,
        cueId: cue.id,
      })
    }
    if (cue.startOffsetMs < 0 || cue.endOffsetMs > shotMs + 1) {
      issues.push({
        level: 'error',
        code: 'out-of-range',
        message: `cue 超出镜头：${cue.startOffsetMs}–${cue.endOffsetMs} / ${shotMs}ms`,
        cueId: cue.id,
      })
    }
    if (prevEnd >= 0 && cue.startOffsetMs < prevEnd - 1) {
      issues.push({
        level: 'error',
        code: 'overlap',
        message: `cue 与前一条重叠：${cue.startOffsetMs} < ${prevEnd}`,
        cueId: cue.id,
      })
    }
    const duration = cue.endOffsetMs - cue.startOffsetMs
    if (duration > 0) {
      if (duration < MIN_CUE_MS) {
        issues.push({
          level: 'warn',
          code: 'short',
          message: `cue 时长 ${duration}ms，低于 ${MIN_CUE_MS}ms`,
          cueId: cue.id,
        })
      } else if (duration > MAX_CUE_MS) {
        issues.push({
          level: 'warn',
          code: 'long',
          message: `cue 时长 ${duration}ms，高于 ${MAX_CUE_MS}ms`,
          cueId: cue.id,
        })
      }
      const lines = text.split('\n')
      if (lines.length > CAPTION_STYLE.maxLines) {
        issues.push({
          level: 'warn',
          code: 'too-many-lines',
          message: `cue 有 ${lines.length} 行，建议不超过 ${CAPTION_STYLE.maxLines} 行`,
          cueId: cue.id,
        })
      }
      const tooLong = lines.some((line) => Array.from(line).length > CAPTION_STYLE.maxCharsPerLine)
      if (tooLong) {
        issues.push({
          level: 'warn',
          code: 'line-too-long',
          message: `cue 单行超过 ${CAPTION_STYLE.maxCharsPerLine} 字`,
          cueId: cue.id,
        })
      }
      const chars = Array.from(text.replace(/\s/g, '')).length
      const cps = chars / (duration / 1000)
      if (cps > 12) {
        issues.push({
          level: 'error',
          code: 'reading-speed',
          message: `阅读速度 ${cps.toFixed(1)} 字/秒，超过 12`,
          cueId: cue.id,
        })
      } else if (cps > 8) {
        issues.push({
          level: 'warn',
          code: 'reading-speed-warn',
          message: `阅读速度 ${cps.toFixed(1)} 字/秒，建议不超过 8`,
          cueId: cue.id,
        })
      }
    }
    if (cue.clamped) {
      issues.push({
        level: 'warn',
        code: 'clamped',
        message: '字幕偏移超出镜头，cue 已被夹紧',
        cueId: cue.id,
      })
    }
    prevEnd = Math.max(prevEnd, cue.endOffsetMs)
  }
  return issues
}

export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/** SRT 序列化；cue 内换行原样保留，空 cue 忽略 */
export function serializeSrt(
  cues: { startMs: number; endMs: number; text: string }[],
): string {
  const rows = cues
    .filter((cue) => String(cue.text || '').trim())
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
  if (!rows.length) return ''
  return rows
    .map(
      (cue, i) =>
        `${i + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${String(
          cue.text,
        ).trim()}\n`,
    )
    .join('\n')
}
