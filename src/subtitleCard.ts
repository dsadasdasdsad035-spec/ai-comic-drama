import { buildShotCaptions, CAPTION_STYLE, serializeSrt } from './captions'
import type { ShotPromptField, ShotPromptSlice } from './assetShotPromptRef'

export type StoredSubtitleCue = {
  id: string
  text: string
  startMs: number
  endMs: number
  speaker?: string
}

const DEFAULT_SHOT_MS = 5000

/** 从引用的分镜填充字幕 cue（不写回镜头） */
export function fillSubtitleCuesFromShots(
  shots: ShotPromptSlice[],
  field: ShotPromptField,
): StoredSubtitleCue[] {
  if (!shots.length) return []
  if (field === 'video_prompt') {
    const cues: StoredSubtitleCue[] = []
    let t = 0
    for (const s of shots) {
      const text = String(s.video_prompt || '').trim()
      if (!text) continue
      const dur = Math.max(1000, Math.round((Number(s.seconds) || 5) * 1000))
      cues.push({
        id: `vp-${s.id}-${t}`,
        text,
        startMs: t,
        endMs: t + dur,
      })
      t += dur
    }
    return cues
  }
  const cues: StoredSubtitleCue[] = []
  let offsetMs = 0
  for (const s of shots) {
    const sec = Number(s.seconds) || 5
    const built = buildShotCaptions({
      shotId: s.id,
      dialogue: String(s.dialogue || ''),
      shotSeconds: sec,
      voiceSeconds: 0,
      voiceOffset: 0,
      subOffset: 0,
      audioMode: 'off',
    })
    for (const c of built) {
      if (!String(c.text || '').trim()) continue
      cues.push({
        id: c.id,
        text: c.text,
        startMs: offsetMs + c.startOffsetMs,
        endMs: offsetMs + c.endOffsetMs,
        speaker: c.speaker,
      })
    }
    offsetMs += Math.round(sec * 1000) || DEFAULT_SHOT_MS
  }
  return cues
}

export function exportSubtitleCardSrt(cues: StoredSubtitleCue[]): string {
  return serializeSrt(
    cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })),
  )
}

export function subtitleCardHasExportableCues(cues: StoredSubtitleCue[] | undefined): boolean {
  return (cues ?? []).some((c) => String(c.text || '').trim())
}

export function subtitleCardHasExportableSrt(srtBody: string | undefined): boolean {
  return isValidSubtitleSrt(String(srtBody || ''))
}

/** 遗留 cues → SRT 正文（打开项目时一次性迁移） */
export function migrateCuesToSrtBody(cues: StoredSubtitleCue[] | undefined): string {
  if (!cues?.length) return ''
  return exportSubtitleCardSrt(cues)
}

const SRT_TIME_ARROW =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/

function srtTimeToMs(h: number, m: number, s: number, ms: number): number {
  return ((h * 60 + m) * 60 + s) * 1000 + ms
}

export type ParsedSrtBlock = { startMs: number; endMs: number; text: string }

/** 从 SRT 文本解析字幕块（轻量校验用） */
export function parseSrtBlocks(raw: string): ParsedSrtBlock[] {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!text) return []
  const chunks = text.split(/\n\s*\n/)
  const out: ParsedSrtBlock[] = []
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trimEnd())
    if (lines.length < 2) continue
    let i = 0
    if (/^\d+$/.test(lines[0]?.trim() || '')) i = 1
    const timeLine = lines[i]?.trim() || ''
    const m = timeLine.match(SRT_TIME_ARROW)
    if (!m) continue
    const startMs = srtTimeToMs(+m[1], +m[2], +m[3], +m[4])
    const endMs = srtTimeToMs(+m[5], +m[6], +m[7], +m[8])
    const body = lines.slice(i + 1).join('\n').trim()
    if (!body || endMs <= startMs) continue
    out.push({ startMs, endMs, text: body })
  }
  return out
}

export function isValidSubtitleSrt(raw: string): boolean {
  return parseSrtBlocks(raw).length > 0
}

/** 剥掉模型常回的 markdown 围栏 */
export function normalizeSrtFromLlm(text: string): string {
  let s = String(text || '').trim()
  const fence = s.match(/^```(?:srt)?\s*\n([\s\S]*?)\n```\s*$/i)
  if (fence) s = fence[1].trim()
  return s.replace(/^\uFEFF/, '').trim()
}

/** LLM 直接生成 SRT 的系统提示 */
export function subtitleLlmSrtSystemPrompt(): string {
  return [
    '你是字幕编辑助手。根据用户提供的分镜文案生成**完整 SRT 文件正文**。',
    `每条字幕单行不超过 ${CAPTION_STYLE.maxCharsPerLine} 字、最多 ${CAPTION_STYLE.maxLines} 行（用 \\n 换行）。`,
    '输出格式必须符合 SubRip：每条含递增序号、一行 `HH:MM:SS,mmm --> HH:MM:SS,mmm`、一行或多行文本，块与块之间空一行。',
    '时间轴从 00:00:00,000 起，须落在用户给出的各镜时间窗内，不得超出总时长。',
    '不要输出 JSON、不要 markdown 代码围栏、不要解释性前后缀，只输出 SRT 正文。',
  ].join('\n')
}

/** LLM 生成字幕 cue 的系统提示（遗留，仅供迁移测试） */
export function subtitleLlmSystemPrompt(): string {
  return [
    '你是字幕编辑助手。根据用户提供的分镜文案生成字幕 cue 列表。',
    `每条 cue 的 text 单行不超过 ${CAPTION_STYLE.maxCharsPerLine} 字、最多 ${CAPTION_STYLE.maxLines} 行（用 \\n 换行）。`,
    '输出必须是 JSON 对象：{ "cues": [ { "text": string, "startMs": number, "endMs": number, "speaker"?: string } ] }。',
    '时间单位为毫秒，从 0 起连续覆盖；不要输出 JSON 以外的内容。',
  ].join('\n')
}

export function subtitleLlmUserPrompt(
  shots: ShotPromptSlice[],
  field: ShotPromptField,
  note?: string,
): string {
  const lines: string[] = []
  if (note?.trim()) lines.push(`说明：${note.trim()}`)
  let t = 0
  for (const s of shots) {
    const text =
      field === 'video_prompt'
        ? String(s.video_prompt || '').trim()
        : String(s.dialogue || '').trim()
    if (!text) continue
    const dur = Math.max(1000, Math.round((Number(s.seconds) || 5) * 1000))
    lines.push(`镜号 ${s.no || s.id}（约 ${dur}ms，从 ${t}ms 起）：\n${text}`)
    t += dur
  }
  return lines.join('\n\n')
}

export type SubtitleLlmCueJson = { text: string; startMs: number; endMs: number; speaker?: string }

export function cuesFromLlmJson(
  raw: unknown,
  idPrefix = 'llm',
): StoredSubtitleCue[] {
  if (!raw || typeof raw !== 'object') return []
  const cues = (raw as { cues?: unknown }).cues
  if (!Array.isArray(cues)) return []
  const out: StoredSubtitleCue[] = []
  let i = 0
  for (const c of cues) {
    if (!c || typeof c !== 'object') continue
    const text = String((c as SubtitleLlmCueJson).text || '').trim()
    if (!text) continue
    const startMs = Math.max(0, Number((c as SubtitleLlmCueJson).startMs) || 0)
    const endMs = Math.max(startMs + 200, Number((c as SubtitleLlmCueJson).endMs) || startMs + 2000)
    out.push({
      id: `${idPrefix}-${i++}`,
      text,
      startMs,
      endMs,
      ...((c as SubtitleLlmCueJson).speaker ? { speaker: String((c as SubtitleLlmCueJson).speaker) } : {}),
    })
  }
  return out
}