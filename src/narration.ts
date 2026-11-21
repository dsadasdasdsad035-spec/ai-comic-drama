/** 旁白类说话人与画布旁白 TTS 合成（不进连播/导出） */
import { shortHash } from './hash'
import type { DialogueDelivery } from './types'
import { parseDialogue, dialogueToText } from './prompts'

/** 与 intake/normalize 一致：旁白不进 cast */
const NARRATOR_SPEAKER = /^(旁白|画外音|内心独白|os|vo|narrator)$/i

export function isNarratorSpeaker(speaker: string): boolean {
  return NARRATOR_SPEAKER.test(String(speaker || '').trim())
}

export type NarrationLine = { speaker: string; text: string; dialogueIndex: number }

/** 从镜头台词抽出旁白行及在原 dialogue 数组中的下标（文本模式按行号）。 */
export function extractNarrationLines(dialogue: unknown): NarrationLine[] {
  if (Array.isArray(dialogue)) {
    const out: NarrationLine[] = []
    dialogue.forEach((line, i) => {
      const speaker = String((line as { speaker?: string })?.speaker ?? '').trim()
      const text = String((line as { text?: string })?.text ?? '').trim()
      if (!text) return
      if (isNarratorSpeaker(speaker)) out.push({ speaker: speaker || '旁白', text, dialogueIndex: i })
    })
    return out
  }
  const lines = parseDialogue(dialogueToText(dialogue))
  return lines
    .map((line, dialogueIndex) => ({ ...line, dialogueIndex }))
    .filter((line) => line.text && isNarratorSpeaker(line.speaker))
    .map((line) => ({ speaker: line.speaker || '旁白', text: line.text, dialogueIndex: line.dialogueIndex }))
}

export type NarratorVoiceConfig = {
  modelKey: string
  voiceId: string
}

export function narratorConfigFingerprint(cfg: NarratorVoiceConfig | undefined): string {
  if (!cfg?.modelKey || !cfg?.voiceId) return ''
  return shortHash(JSON.stringify({ modelKey: cfg.modelKey, voiceId: cfg.voiceId }))
}

export function voiceFingerprintNarration(
  lines: NarrationLine[],
  delivery: DialogueDelivery[] | undefined,
  narrator: NarratorVoiceConfig,
): string {
  const picked = lines.map((l) => delivery?.[l.dialogueIndex] ?? {})
  return shortHash(
    JSON.stringify({
      scope: 'narration',
      narrator: narratorConfigFingerprint(narrator),
      lines: lines.map((l) => [l.speaker, l.text]),
      delivery: picked,
    }),
  )
}

export function narrationVoiceStale(
  meta: { fingerprint?: string; scope?: string; voice?: string; model?: string } | undefined,
  lines: NarrationLine[],
  delivery: DialogueDelivery[] | undefined,
  narrator: NarratorVoiceConfig | undefined,
): boolean {
  if (!meta?.fingerprint) return false
  if (meta.scope && meta.scope !== 'narration') return true
  if (!narrator?.modelKey || !narrator.voiceId) return true
  if (meta.voice && meta.voice !== narrator.voiceId) return true
  if (meta.model && meta.model !== narrator.modelKey) return true
  return meta.fingerprint !== voiceFingerprintNarration(lines, delivery, narrator)
}

export type NarrationVoicePayload =
  | {
      lines: Array<{ text: string; voice: string; modelKey?: string } & DialogueDelivery>
      modelKey: string
    }
  | { text: string; voice: string; modelKey: string; rate?: number; performance?: DialogueDelivery }

/** 构造旁白 TTS 请求体；无旁白行返回 null。 */
export function buildNarrationPayload(input: {
  dialogue: unknown
  dialogueDelivery?: DialogueDelivery[]
  narrator: NarratorVoiceConfig
  voiceRate?: number
}): NarrationVoicePayload | null {
  const narr = extractNarrationLines(input.dialogue)
  if (!narr.length) return null
  const { modelKey, voiceId } = input.narrator
  if (!modelKey || !voiceId) return null
  const rate = input.voiceRate ?? 180
  if (narr.length === 1) {
    const d = input.dialogueDelivery?.[narr[0].dialogueIndex] ?? {}
    return {
      text: narr[0].text,
      voice: voiceId,
      modelKey,
      rate,
      ...(Object.keys(d).length ? { performance: d } : {}),
    }
  }
  return {
    modelKey,
    lines: narr.map((line) => ({
      text: line.text,
      voice: voiceId,
      modelKey,
      ...(input.dialogueDelivery?.[line.dialogueIndex] ?? {}),
      rate,
    })),
  }
}