/**
 * 分镜表单元格语法：导出与导入共用的唯一实现。
 *
 * 为什么单独成模块：导出写 `角色[angry/4/slow/soft]：台词`、导入读同一串，
 * 两边各写一份必然漂移。这里的每个 render 都有配对的 parse，改动时能同时看到两侧。
 *
 * 为什么用固定槽位而不是 key=value：固定槽位解析不需要猜顺序，空槽保留位置，
 * 「没填」与「填了空值」可区分；key=value 一旦值里出现 `=` 就要转义。
 *
 * 为什么只解析冒号之前：台词原文里出现 `[` `{` 是常态（如 `[系统]警告`），
 * 限定解析窗口就完全不需要为原文设计转义规则。台词方括号的代价是说话人名
 * 不能含方括号——实际不存在这种名字。
 *
 * 槽位内的分隔符用全角写法转义：`/` → `／`、`:` → `：`、`}` → `｝`。
 * 这几个字符是结构分隔符，出现在字段值里会让定长槽位错位。转义在 parse 侧
 * 会还原，保证往返逐字相等——这一点与 mdCell 的竖线替换不同，竖线是单边处理。
 */
import { PERFORMANCE_EMOTIONS, type DialogueDelivery, type PerformanceEmotion, type PerformanceEntry } from './types'

/** 多条目分隔：Markdown 表格里不能换行，用 `<br>` */
export const CELL_BREAK = '<br>'
/** 槽位分隔 */
const SLOT = '/'
/** 单条表演里「角色」与各槽的分隔 */
const COLON = ':'
/** 选角列与参考列名单内部分隔 */
export const NAME_SEP = '、'
/** 参考列里两类之间的分隔 */
const REF_GROUP_SEP = ';'
/** 参考列里类别与名单之间的分隔 */
const REF_KIND_SEP = ':'
/** 参考列的两个类别标签 */
export const REF_KIND_LABEL = { character: '角色', asset: '素材' } as const

const PACE_VALUES = ['slow', 'normal', 'fast'] as const
const VOLUME_VALUES = ['whisper', 'soft', 'normal', 'loud', 'shout'] as const

/** 字段值里的结构分隔符转全角，避免槽位错位 */
function escField(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\//g, '／')
    .replace(/:/g, '：')
    .replace(/}/g, '｝')
    .replace(/\{/g, '｛')
    .replace(/[[\]]/g, (m) => (m === '[' ? '［' : '］'))
}

/** escField 的逆运算；只还原转义用到的几个全角字符 */
function unescField(raw: string): string {
  return raw
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/｝/g, '}')
    .replace(/｛/g, '{')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
}

const trimSlot = (raw: string | undefined): string => String(raw ?? '').trim()

/** 只接受枚举内的情绪；不认识的当未设置，不猜近似值 */
function parseEmotion(raw: string): PerformanceEmotion | undefined {
  const v = raw.trim().toLowerCase()
  return (PERFORMANCE_EMOTIONS as string[]).includes(v) ? (v as PerformanceEmotion) : undefined
}

/** 强度 0-5；越界与非法值都当未设置 */
function parseIntensity(raw: string): number | undefined {
  const v = trimSlot(raw)
  if (!v) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 5) return undefined
  return n
}

function parsePace(raw: string): DialogueDelivery['pace'] {
  const v = raw.trim().toLowerCase()
  return (PACE_VALUES as readonly string[]).includes(v) ? (v as DialogueDelivery['pace']) : undefined
}

function parseVolume(raw: string): DialogueDelivery['volume'] {
  const v = raw.trim().toLowerCase()
  return (VOLUME_VALUES as readonly string[]).includes(v) ? (v as DialogueDelivery['volume']) : undefined
}

// ------------------------------------------------------------------ 台词表演标注

/**
 * `[情绪/强度/语速/音量]{强调}` 里的方括号部分。
 * 全部为空时返回空串，避免给无表演的台词凭空造出 `[]`。
 */
export function renderDeliveryBracket(d?: DialogueDelivery): string {
  if (!d) return ''
  const slots = [
    d.emotion ?? '',
    d.intensity === undefined ? '' : String(d.intensity),
    d.pace ?? '',
    d.volume ?? '',
  ]
  return slots.every((s) => !String(s).trim()) ? '' : `[${slots.join(SLOT)}]`
}

/** 强调词单独成段；没有就不写花括号 */
export function renderDeliveryEmphasis(d?: DialogueDelivery): string {
  const v = escField(d?.emphasis)
  return v ? `{${v}}` : ''
}

/**
 * 台词整行的标注部分（冒号之前、说话人之后）。
 * 说话人之后的标注顺序固定：方括号在前、花括号在后。
 */
export function renderDialogueAnnotation(d?: DialogueDelivery): string {
  return `${renderDeliveryBracket(d)}${renderDeliveryEmphasis(d)}`
}

/**
 * 解析说话人与首个冒号之间的标注。
 *
 * 只吃 `[..]` 与 `{..}`，其它内容原样当说话人尾巴丢弃——
 * 调用方负责先把说话人切出来，这里只处理标注段。
 */
export function parseDialogueAnnotation(raw: string): DialogueDelivery | undefined {
  const text = String(raw ?? '')
  const bracket = text.match(/\[([^\]]*)\]/)
  const brace = text.match(/\{([^}]*)\}/)
  if (!bracket && !brace) return undefined
  const out: DialogueDelivery = {}
  if (bracket) {
    const slots = bracket[1].split(SLOT)
    const emotion = parseEmotion(trimSlot(slots[0]))
    const intensity = parseIntensity(trimSlot(slots[1]))
    const pace = parsePace(trimSlot(slots[2]))
    const volume = parseVolume(trimSlot(slots[3]))
    if (emotion) out.emotion = emotion
    if (intensity !== undefined) out.intensity = intensity
    if (pace) out.pace = pace
    if (volume) out.volume = volume
  }
  if (brace) {
    const emphasis = unescField(trimSlot(brace[1]))
    if (emphasis) out.emphasis = emphasis
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 单条台词：`角色[..]{..}：原文`。
 * 说话人为空时角色位留空，标注仍写在冒号前，使标注不丢。
 */
export function renderDialogueLine(
  speaker: string,
  text: string,
  delivery?: DialogueDelivery,
): string {
  const name = escField(speaker)
  const body = String(text ?? '')
  const ann = renderDialogueAnnotation(delivery)
  if (!name && !ann) return body
  return `${name}${ann}${'：'}${body}`
}

// ------------------------------------------------------------------ 表演列

/** `情绪/强度/动作/视线/是否说话` 五个槽，缺项留空 */
export function renderPerformanceLine(entry: PerformanceEntry): string {
  const slots = [
    entry.emotion ?? '',
    entry.intensity === undefined ? '' : String(entry.intensity),
    escField(entry.action),
    escField(entry.gaze),
    entry.speaks === undefined ? '' : entry.speaks ? '说' : '不说',
  ]
  return `${escField(entry.character)}${COLON}${slots.join(SLOT)}`
}

export function renderPerformanceCell(entries?: PerformanceEntry[]): string {
  const list = (entries ?? []).filter((e) => e && String(e.character ?? '').trim())
  return list.map(renderPerformanceLine).join(CELL_BREAK)
}

/**
 * 单条表演解析。
 *
 * 情绪与强度在 `PerformanceEntry` 上是必填，而表格可能只写了动作，
 * 所以缺槽时退回 neutral/3，并在返回值里标出「这条是补的」。
 * 让调用方知道哪些条目不是文件内容，预览才能如实报告。
 */
function parsePerformanceLineDetail(raw: string): { entry?: PerformanceEntry; filled: boolean } {
  const line = String(raw ?? '').trim()
  if (!line) return { filled: false }
  const at = line.indexOf(COLON)
  if (at <= 0) return { filled: false }
  const character = unescField(trimSlot(line.slice(0, at)))
  if (!character) return { filled: false }
  const slots = line.slice(at + 1).split(SLOT)
  const emotion = parseEmotion(trimSlot(slots[0]))
  const intensity = parseIntensity(trimSlot(slots[1]))
  const entry: PerformanceEntry = {
    character,
    emotion: emotion ?? 'neutral',
    intensity: intensity ?? 3,
  }
  const action = unescField(trimSlot(slots[2]))
  const gaze = unescField(trimSlot(slots[3]))
  const speaks = trimSlot(slots[4])
  if (action) entry.action = action
  if (gaze) entry.gaze = gaze
  if (speaks === '说') entry.speaks = true
  else if (speaks === '不说') entry.speaks = false
  return { entry, filled: !emotion || intensity === undefined }
}

export function parsePerformanceLine(raw: string): PerformanceEntry | undefined {
  return parsePerformanceLineDetail(raw).entry
}

/**
 * 表演列解析。
 *
 * `filled` 是需要补默认值的条目数，调用方按镜聚合后交给预览，
 * 使「文件写的表演」与「系统补的表演」分开计数。
 */
export function parsePerformanceCell(raw: string): { entries: PerformanceEntry[]; filled: number } {
  const text = String(raw ?? '').trim()
  if (!text) return { entries: [], filled: 0 }
  const entries: PerformanceEntry[] = []
  let filled = 0
  for (const part of text.split(new RegExp(CELL_BREAK, 'gi'))) {
    const one = parsePerformanceLineDetail(part)
    if (!one.entry) continue
    if (one.filled) filled++
    entries.push(one.entry)
  }
  return { entries, filled }
}

// ------------------------------------------------------------------ 选角与参考

export function renderCastCell(cast?: string[]): string {
  const names = (cast ?? []).map((x) => escField(x)).filter(Boolean)
  return names.join(NAME_SEP)
}

/** 去重保序，插入顺序即用户书写顺序 */
function uniq(list: string[]): string[] {
  return Array.from(new Set(list))
}

export function parseCastCell(raw: string): string[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  // 去重保序：重复写同一个角色会让画布把它排两次，表演校验也会以为缺了谁
  return uniq(
    text
      .split(/[、,，]/)
      .map((x) => unescField(x.trim()))
      .filter(Boolean),
  )
}

export type RefGroups = { characters: string[]; assets: string[] }

/** 参考列：`角色:a、b;素材:c`；某一类为空时省略该类 */
export function renderRefCell(groups: RefGroups): string {
  const parts: string[] = []
  const chars = (groups.characters ?? []).map((x) => escField(x)).filter(Boolean)
  const assets = (groups.assets ?? []).map((x) => escField(x)).filter(Boolean)
  if (chars.length) parts.push(`${REF_KIND_LABEL.character}${REF_KIND_SEP}${chars.join(NAME_SEP)}`)
  if (assets.length) parts.push(`${REF_KIND_LABEL.asset}${REF_KIND_SEP}${assets.join(NAME_SEP)}`)
  return parts.join(REF_GROUP_SEP)
}

/** 参考列解析：认不出的段落忽略，不猜类别 */
export function parseRefCell(raw: string): RefGroups {
  const text = String(raw ?? '').trim()
  if (!text) return { characters: [], assets: [] }
  const out: RefGroups = { characters: [], assets: [] }
  for (const part of text.split(/[;；]/)) {
    const seg = part.trim()
    if (!seg) continue
    const at = seg.search(/[:：]/)
    if (at <= 0) continue
    const kind = seg.slice(0, at).trim()
    const names = seg
      .slice(at + 1)
      .split(/[、,，]/)
      .map((x) => unescField(x.trim()))
      .filter(Boolean)
    if (kind === REF_KIND_LABEL.character) out.characters.push(...names)
    else if (kind === REF_KIND_LABEL.asset) out.assets.push(...names)
  }
  // 同名重复只连一次：refIds 里重复的 token 会画出两条重叠的连线
  out.characters = uniq(out.characters)
  out.assets = uniq(out.assets)
  return out
}
