/**
 * 单元格值归一化：真实分镜表的单元格不是干净的枚举值。
 *
 * 实测样本（cat 仓库第 1 集分镜表）：
 *   时间    `00-05` / `0–5秒` / `5—11 秒`（三种破折号）
 *   景别    `极近景，猫眼` / `低机位远景` / `猫咪主观镜头`
 *   台词    `脚步声停止。人类轻声：小家伙，你怎么在这里？`（声音 + 台词混排）
 * 所以这三个值必须独立归一化，不能直接塞进契约。
 */
import { MOVES, SHOT_SIZES } from '../types'

/** 所有会被当作「区间」的破折号：连字符、短破折号、长破折号、波浪号 */
const RANGE_SEP = /[-–—~～至到]/

/**
 * 时长：支持纯秒数与时间区间。
 * 区间按「结束 − 开始」算；纯秒数直接用。
 * 无法解析返回 null —— 调用方必须跳过该行，不许猜默认值。
 */
export function parseDuration(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  // 纯秒数：`6`、`6秒`、`6.5s`、`3.5 秒`
  const plain = s.match(/^(\d+(?:\.\d+)?)\s*(?:秒|s|sec|seconds?)?$/i)
  if (plain) {
    const n = Number(plain[1])
    return Number.isFinite(n) && n > 0 ? round1(n) : null
  }

  // 区间：`00-05`、`0–5秒`、`5—11 秒`、`00:05-00:12`
  const parts = s.split(RANGE_SEP)
  if (parts.length === 2) {
    const a = parseClock(parts[0])
    const b = parseClock(parts[1])
    if (a == null || b == null) return null
    const d = round1(b - a)
    return d > 0 ? d : null
  }

  return null
}

/** `05` / `5` / `00:05` / `1:05` → 秒 */
function parseClock(raw: string): number | null {
  const s = String(raw ?? '')
    .replace(/[^\d:.]/g, '')
    .trim()
  if (!s) return null
  if (s.includes(':')) {
    const [m, sec] = s.split(':')
    const mm = Number(m)
    const ss = Number(sec)
    if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null
    return mm * 60 + ss
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 比标准枚举更长、必须先判的特例：否则「极近景」会被「近景」先吃掉 */
const SIZE_OVERRIDES: { test: RegExp; size: string; term: RegExp }[] = [
  { test: /极近景|大特写/, size: '大特写', term: /极近景|大特写/ },
  { test: /中近景/, size: '近景', term: /中近景/ },
  { test: /extreme close ?-?up|micro shot/i, size: '大特写', term: /extreme close ?-?up|micro shot/i },
  { test: /medium close ?-?up/i, size: '近景', term: /medium close ?-?up/i },
]

/**
 * 景别：接受标准枚举与自然语言。
 * 能唯一确定就归一化，其余文字（机位、主体）作为说明返回，不许丢。
 * 认不出时 size 为 null，调用方保留原文并标记未识别。
 */
export function normalizeSize(raw: unknown): { size: string | null; note: string } {
  const s = String(raw ?? '').trim()
  if (!s) return { size: null, note: '' }

  // 完全等于枚举值
  const exact = SHOT_SIZES.find((v) => v === s)
  if (exact) return { size: exact, note: '' }

  // 长于枚举的特例必须先判：「极近景」含「近景」，「中近景」也含「近景」
  for (const o of SIZE_OVERRIDES) {
    if (o.test.test(s)) return { size: o.size, note: stripTerms(s, [s.match(o.term)?.[0] || '']) }
  }

  // 普通枚举词：从长到短匹配，避免「大特写」被「特写」吃掉
  const byLength = [...SHOT_SIZES].sort((a, b) => b.length - a.length)
  for (const v of byLength) {
    if (s.includes(v)) return { size: v, note: stripTerms(s, [v]) }
  }

  // 英文常见说法
  const SYNONYMS: { test: RegExp; size: string }[] = [
    { test: /远景|wide|establishing/, size: '远景' },
    { test: /特写|close ?up/i, size: '特写' },
    { test: /中景|medium shot/i, size: '中景' },
    { test: /全景|full shot/i, size: '全景' },
  ]
  for (const { test, size } of SYNONYMS) {
    if (test.test(s)) return { size, note: stripTerms(s, [s.match(test)?.[0] || '']) }
  }

  return { size: null, note: s }
}

/** 从描述里剔掉已识别的词，剩下的当补充说明 */
function stripTerms(s: string, terms: string[]): string {
  let out = s
  for (const t of terms) if (t) out = out.split(t).join(' ')
  return out
    .replace(/[，,、/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 运镜：标准枚举直通；认不出返回 null（调用方按固定处理并计数） */
export function normalizeMove(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const exact = MOVES.find((v) => v === s)
  if (exact) return exact
  const SYNONYMS: { test: RegExp; move: string }[] = [
    { test: /推|dolly in|push in/, move: '推' },
    { test: /拉|dolly out|pull out/, move: '拉' },
    { test: /摇|pan\b/, move: '摇' },
    { test: /移|truck/, move: '移' },
    { test: /跟|track/, move: '跟' },
    { test: /升降|crane/, move: '升降' },
    { test: /手持|handheld/, move: '手持' },
    { test: /固定|static|still/, move: '固定' },
  ]
  for (const { test, move } of SYNONYMS) if (test.test(s)) return move
  return null
}

const SPEAKER_PREFIX = /^([^：:]{1,12})[：:]\s*(.+)$/
/** 明确不是角色的说话人：这些不进 cast，也不当成角色 */
const NARRATOR = /^(旁白|画外音|内心独白|os|vo|narrator)$/i
/** 声音/音乐类描述：不产生台词 */
const SOUND_ONLY =
  /^(雨声|环境声|音乐|音效|脚步声|心跳|呼吸|风声|雷声|[^：:]{0,6}(声|音乐|音效)[^：:]{0,12})$|^[^：:]*[。，,；;]$/

export type DialogueCell = {
  /** 真正要进镜头台词的条目 */
  lines: { speaker: string; text: string }[]
  /** 旁白单独标出（说话人是旁白，不进 cast） */
  narrators: { speaker: string; text: string }[]
  /** 音效/音乐等不产生台词的文字，保留备查 */
  sounds: string[]
}

/**
 * 台词列拆分：一个单元格里可能混着声音说明、旁白、角色台词。
 *
 * 规则：按「说话人：」切段。有前缀的算台词（旁白另记）；
 * 没前缀的整段算声音说明。绝不含糊地全部塞进台词，
 * 否则配音会把「雨声」念出来。
 */
export function splitDialogueCell(raw: unknown): DialogueCell {
  const s = String(raw ?? '').trim()
  const out: DialogueCell = { lines: [], narrators: [], sounds: [] }
  if (!s) return out

  // 先按句末标点 + 换行切成候选段，再逐段判断有没有说话人前缀
  const segments = s
    .split(/\n|(?<=[。！？!?])\s*/)
    .map((x) => x.trim())
    .filter(Boolean)

  for (const seg of segments) {
    const m = seg.match(SPEAKER_PREFIX)
    if (m) {
      const speaker = m[1].trim()
      const text = m[2].trim()
      if (!text) continue
      if (NARRATOR.test(speaker)) out.narrators.push({ speaker, text })
      else out.lines.push({ speaker, text })
      continue
    }
    if (SOUND_ONLY.test(seg)) out.sounds.push(seg)
    else out.sounds.push(seg)
  }

  return out
}
