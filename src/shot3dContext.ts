import type { Shot3DContext, Shot3DContextText } from './types'
import { shortHash } from './scheduleGeometry'

export type DialogueLine = { index: number; speaker: string; text: string }

export const TEXT_CONTEXT_OFF: Shot3DContextText = {
  prompt: false,
  videoPrompt: false,
  dialogue: [],
  cast: false,
  marks: false,
  sizeMove: false,
}

export const TEXT_CONTEXT_ON: Shot3DContextText = {
  prompt: true,
  videoPrompt: true,
  dialogue: 'all',
  cast: true,
  marks: true,
  sizeMove: true,
}

const MAX_ITEMS = 64

export function parseDialogueLines(dialogue: unknown): DialogueLine[] {
  const rows: DialogueLine[] = []
  const push = (speaker: string, text: string) => {
    const t = String(text || '').trim()
    if (!t) return
    rows.push({ index: rows.length, speaker: String(speaker || '').trim(), text: t })
  }
  if (Array.isArray(dialogue)) {
    for (const raw of dialogue) {
      if (typeof raw === 'string') {
        const m = raw.trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/)
        m ? push(m[1], m[2]) : push('', raw)
      } else if (raw && typeof raw === 'object') {
        const o = raw as { speaker?: unknown; text?: unknown }
        push(String(o.speaker || ''), String(o.text || ''))
      }
    }
    return rows
  }
  for (const line of String(dialogue || '').split('\n')) {
    const m = line.trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/)
    m ? push(m[1], m[2]) : push('', line)
  }
  return rows
}

export function dialogueHashOf(dialogue: unknown): string {
  return shortHash(JSON.stringify(parseDialogueLines(dialogue).map((x) => [x.speaker, x.text])))
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const s = String(item ?? '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function dialogueSelection(raw: unknown): 'all' | number[] {
  if (raw === 'all') return 'all'
  if (!Array.isArray(raw)) return []
  const out = [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v < 500),
    ),
  ].sort((a, b) => a - b)
  return out.slice(0, 200)
}

function sanitizeText(raw: unknown): Shot3DContextText {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    prompt: Boolean(o.prompt),
    videoPrompt: Boolean(o.videoPrompt),
    dialogue: dialogueSelection(o.dialogue),
    cast: Boolean(o.cast),
    marks: Boolean(o.marks),
    sizeMove: Boolean(o.sizeMove),
  }
}

/** 读旧项目/缺字段时的安全归一化；不替用户补默认选择。 */
export function sanitizeShot3DContext(raw: unknown): Shot3DContext {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    version: 1,
    characterIds: strings(o.characterIds),
    designIds: strings(o.designIds),
    assetUrls: strings(o.assetUrls),
    imageUrls: strings(o.imageUrls),
    videoUrls: strings(o.videoUrls),
    sceneKeys: strings(o.sceneKeys),
    text: sanitizeText(o.text),
    ...(typeof o.dialogueHash === 'string' && o.dialogueHash ? { dialogueHash: o.dialogueHash } : {}),
    ...(typeof o.updatedAt === 'string' && o.updatedAt ? { updatedAt: o.updatedAt } : {}),
  }
}

export type DefaultContextInput = {
  characterIds?: string[]
  designIds?: string[]
  assetUrls?: string[]
  imageUrls?: string[]
  videoUrls?: string[]
  sceneKeys?: string[]
  dialogueHash?: string
}

/** 首次打开镜头时的默认选择：本镜相关资源 + 全部镜头文本。 */
export function defaultShot3DContext(input: DefaultContextInput = {}): Shot3DContext {
  return sanitizeShot3DContext({
    version: 1,
    characterIds: input.characterIds ?? [],
    designIds: input.designIds ?? [],
    assetUrls: input.assetUrls ?? [],
    imageUrls: input.imageUrls ?? [],
    videoUrls: input.videoUrls ?? [],
    sceneKeys: input.sceneKeys ?? [],
    text: TEXT_CONTEXT_ON,
    dialogueHash: input.dialogueHash,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 沿用上一镜：资源选择照搬，文本开关保留，但台词行索引只在台词未变化时保留。
 * 当前镜自己的 prompt/videoPrompt 始终由当前镜头数据提供，不会复制上一镜文本。
 */
export function inheritShot3DContext(previous: Shot3DContext, currentDialogueHash: string): Shot3DContext {
  const next = sanitizeShot3DContext(previous)
  if (next.dialogueHash && next.dialogueHash !== currentDialogueHash && next.text.dialogue !== 'all') {
    next.text.dialogue = 'all'
  }
  next.dialogueHash = currentDialogueHash
  next.updatedAt = new Date().toISOString()
  return next
}

export function contextFingerprint(ctx: Shot3DContext): string {
  return shortHash(
    JSON.stringify({
      characters: ctx.characterIds,
      designs: ctx.designIds,
      assets: ctx.assetUrls,
      images: ctx.imageUrls,
      videos: ctx.videoUrls,
      scenes: ctx.sceneKeys,
      text: ctx.text,
      dialogueHash: ctx.dialogueHash || '',
    }),
  )
}

export function sameShot3DContext(a: Shot3DContext, b: Shot3DContext): boolean {
  return contextFingerprint(a) === contextFingerprint(b)
}

export function contextCount(ctx: Shot3DContext): number {
  const text =
    Number(ctx.text.prompt) +
    Number(ctx.text.videoPrompt) +
    Number(ctx.text.cast) +
    Number(ctx.text.marks) +
    Number(ctx.text.sizeMove) +
    (ctx.text.dialogue === 'all' ? 1 : ctx.text.dialogue.length)
  return (
    ctx.characterIds.length +
    ctx.designIds.length +
    ctx.assetUrls.length +
    ctx.imageUrls.length +
    ctx.videoUrls.length +
    ctx.sceneKeys.length +
    text
  )
}

export function hasShot3DContext(ctx: Shot3DContext): boolean {
  return contextCount(ctx) > 0
}

export function selectedDialogue(ctx: Shot3DContext, dialogue: unknown): DialogueLine[] {
  const lines = parseDialogueLines(dialogue)
  if (ctx.text.dialogue === 'all') return lines
  const wanted = new Set(ctx.text.dialogue)
  return lines.filter((line) => wanted.has(line.index))
}

/** 选择被删资源时仍保留在数组里，界面负责显示缺失；这里只做本地路径判断。 */
export function isProjectLocalUrl(url: string): boolean {
  const u = String(url || '').trim()
  if (!u) return false
  if (u.startsWith('data:')) return false
  if (u.startsWith('/')) return true
  try {
    const parsed = new URL(u, typeof location !== 'undefined' ? location.origin : 'http://localhost')
    return typeof location !== 'undefined' && parsed.origin === location.origin
  } catch {
    return false
  }
}
