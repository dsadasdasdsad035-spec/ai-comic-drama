/** 台词/锚点等纯文本工具；提示词正文已迁到 skills/ 与 skills/legacyPrompts.ts。 */
import type { DialogueDelivery } from './types'

/** 台词数组 ⇄ 表格里的多行文本 */
export function dialogueToText(d: unknown): string {
  if (!d) return ''
  if (typeof d === 'string') return d
  if (!Array.isArray(d)) return ''
  return d
    .map((x: any) => (x && x.speaker ? `${x.speaker}：${x.text ?? ''}` : String(x?.text ?? '')))
    .join('\n')
}

export function parseDialogue(text: string): { speaker: string; text: string }[] {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
      return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: '', text: line }
    })
}

/**
 * 文本行改动后保留台词表演。
 * 先按完全相同的 speaker+text 匹配（同一句换位置也能跟过去），
 * 再按行下标兜底（只改了一个字时不丢情绪）。
 */
export function reconcileDialogueDelivery(
  oldLines: { speaker: string; text: string }[],
  oldDelivery: DialogueDelivery[] | undefined,
  newLines: { speaker: string; text: string }[],
): { delivery: DialogueDelivery[]; dropped: number } {
  const old = oldLines.map((line, i) => ({
    speaker: line.speaker,
    text: line.text,
    delivery: oldDelivery?.[i],
  }))
  const used = new Set<number>()
  const delivery: DialogueDelivery[] = new Array(newLines.length).fill(null).map(() => ({}))

  for (let i = 0; i < newLines.length; i++) {
    const hit = old.findIndex(
      (x, oi) =>
        !used.has(oi) &&
        x.delivery &&
        x.speaker === newLines[i].speaker &&
        x.text === newLines[i].text,
    )
    if (hit >= 0) {
      used.add(hit)
      delivery[i] = { ...(old[hit].delivery as DialogueDelivery) }
    }
  }

  for (let i = 0; i < newLines.length; i++) {
    if (Object.keys(delivery[i]).length > 0) continue
    const sameIndex = old[i]
    if (!sameIndex?.delivery || used.has(i)) continue
    if (sameIndex.speaker && newLines[i].speaker && sameIndex.speaker !== newLines[i].speaker) continue
    used.add(i)
    delivery[i] = { ...sameIndex.delivery }
  }

  const dropped = old.filter((x, i) => x.delivery && !used.has(i)).length
  return { delivery, dropped }
}

/** 给提示词/配音用的带表演台词；旧数据 delivery 缺失时返回空对象。 */
export function dialogueWithDelivery(
  dialogue: { speaker: string; text: string }[],
  delivery: DialogueDelivery[] | undefined,
): ({ speaker: string; text: string } & DialogueDelivery)[] {
  return dialogue.map((line, i) => ({ ...line, ...(delivery?.[i] ?? {}) }))
}

/** 规范化一行台词表演；只保留枚举内/范围内的值。 */
export function normalizeDialogueDelivery(input: DialogueDelivery | undefined): DialogueDelivery {
  const out: DialogueDelivery = {}
  if (!input) return out
  if (input.emotion && ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].includes(input.emotion)) {
    out.emotion = input.emotion
  }
  if (typeof input.intensity === 'number' && Number.isFinite(input.intensity)) {
    out.intensity = Math.max(0, Math.min(5, Math.round(input.intensity)))
  }
  if (input.pace && ['slow', 'normal', 'fast'].includes(input.pace)) out.pace = input.pace
  if (input.volume && ['whisper', 'soft', 'normal', 'loud', 'shout'].includes(input.volume)) out.volume = input.volume
  if (input.emphasis?.trim()) out.emphasis = input.emphasis.trim().slice(0, 80)
  return out
}

/**
 * 把 {{角色名}} 占位符替换回角色的 look_en 原文。
 *
 * 为什么要有这个：实测 15 镜的 keyframe_prompt 里 80% 的字符是同一段 look_en 被重复输出
 * （9974 字符里有 7996 是锚点原文），而生成速度受输出长度主导（约 40 字符/秒）。
 * 让模型只写占位符、由我们替换回来，输出量掉到 1/3，落盘结果与原文逐字一致。
 */
export function expandAnchors(text: string, chars: { name: string; lookEn: string }[]): string {
  let out = String(text || '')
  if (!out.includes('{{')) return out
  for (const c of chars) {
    if (!c.name || !c.lookEn) continue
    const keys = [`{{${c.name}}}`, `{{${c.name}.look_en}}`, `{{${c.name}.lookEn}}`, `{{${c.name} look_en}}`]
    for (const k of keys) out = out.split(k).join(c.lookEn)
  }
  return out
}

/** 是否还有没替换掉的占位符（模型写错了名字时会残留） */
export function hasUnresolvedAnchor(text: string): boolean {
  return /\{\{[^}]{1,20}\}\}/.test(text || '')
}

/** 按 max 个元素切成若干批 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
