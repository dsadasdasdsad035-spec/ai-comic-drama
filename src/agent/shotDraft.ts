import type { ProjectEpisode, ProjectShot } from '../api'
import type { DialogueDelivery, PerformanceEmotion, PerformanceEntry } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

const EMOTIONS: PerformanceEmotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
]

const text = (v: unknown) => String(v ?? '').trim()

function emotionOf(v: unknown): PerformanceEmotion {
  return EMOTIONS.includes(v as PerformanceEmotion) ? (v as PerformanceEmotion) : 'neutral'
}

function intensityOf(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 3
}

function performanceOf(raw: unknown): PerformanceEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((x) => {
      const item = (x || {}) as Record<string, unknown>
      const character = text(item.character ?? item.name)
      if (!character) return null
      const entry: PerformanceEntry = {
        character,
        emotion: emotionOf(item.emotion),
        intensity: intensityOf(item.intensity),
      }
      if (text(item.action)) entry.action = text(item.action)
      if (text(item.gaze)) entry.gaze = text(item.gaze)
      if (typeof item.speaks === 'boolean') entry.speaks = item.speaks
      return entry
    })
    .filter((x): x is PerformanceEntry => Boolean(x))
}

function deliveryOf(item: Record<string, unknown>): DialogueDelivery {
  const out: DialogueDelivery = {}
  if (EMOTIONS.includes(item.emotion as PerformanceEmotion)) out.emotion = item.emotion as PerformanceEmotion
  if (item.intensity !== undefined) out.intensity = intensityOf(item.intensity)
  if (['slow', 'normal', 'fast'].includes(String(item.pace))) out.pace = item.pace as DialogueDelivery['pace']
  if (['whisper', 'soft', 'normal', 'loud', 'shout'].includes(String(item.volume))) {
    out.volume = item.volume as DialogueDelivery['volume']
  }
  if (text(item.emphasis)) out.emphasis = text(item.emphasis)
  return out
}

function splitDialogue(raw: unknown): {
  dialogue: { speaker: string; text: string }[]
  delivery?: DialogueDelivery[]
} {
  if (!Array.isArray(raw)) return { dialogue: [] }
  const dialogue: { speaker: string; text: string }[] = []
  const delivery: DialogueDelivery[] = []
  let hasDelivery = false
  for (const x of raw) {
    const item = (x || {}) as Record<string, unknown>
    dialogue.push({ speaker: text(item.speaker), text: String(item.text ?? '') })
    const d = deliveryOf(item)
    if (Object.keys(d).length) hasDelivery = true
    delivery.push(d)
  }
  return { dialogue, delivery: hasDelivery ? delivery : undefined }
}

/**
 * 模型返回的镜头 → 项目镜头。按 shot.id 定位，场次号/简称回退到当前集。
 * 生成按钮和聊天共用，避免两套映射。
 */
export function buildShotsFromModel(
  got: unknown[],
  episodes: ProjectEpisode[],
  epNo: number,
): { shots: ProjectShot[]; sceneFallback: number; fallbackSceneNo: number } {
  const curEp = episodes.find((x) => Number(x?.no) === epNo)
  const known = new Map<number, string>()
  for (const [si, sc] of (curEp?.scenes ?? []).entries()) {
    const no = Number((sc as { no?: unknown })?.no) || si + 1
    known.set(no, String((sc as { slug?: unknown })?.slug || ''))
  }
  const fallbackSceneNo = known.keys().next().value ?? 1
  const fallbackSceneSlug = known.get(fallbackSceneNo) ?? ''
  let sceneFallback = 0
  const shots: ProjectShot[] = got.map((raw, i) => {
    const s = (raw || {}) as Record<string, unknown>
    const no = String(s.no || `S${pad(i + 1)}`)
    const rawScene = Number(s.scene_no ?? s.sceneNo ?? s.scene)
    const sceneOk = Number.isFinite(rawScene) && known.has(rawScene)
    if (!sceneOk) sceneFallback++
    const sceneNo = sceneOk ? rawScene : fallbackSceneNo
    const sceneSlug =
      (sceneOk ? known.get(sceneNo) : fallbackSceneSlug) ||
      String(s.scene_slug ?? s.sceneSlug ?? '').trim()
    const dialogue = splitDialogue(s.dialogue)
    const performance = performanceOf(s.performance)
    return {
      id: `E${pad(epNo)}-${no}`,
      episode: epNo,
      no,
      scene_no: sceneNo,
      ...(sceneSlug ? { scene_slug: sceneSlug } : {}),
      seconds: Number(s.seconds) || 3,
      size: String(s.size || '中景'),
      move: String(s.move || '固定'),
      desc: String(s.desc || ''),
      dialogue: dialogue.dialogue,
      ...(dialogue.delivery ? { dialogue_delivery: dialogue.delivery } : {}),
      ...(performance ? { performance } : {}),
      cast: Array.isArray(s.cast) ? (s.cast as unknown[]).map(String) : undefined,
    }
  })
  for (const shot of shots) {
    if (!shot.performance) continue
    const speakers = Array.from(
      new Set(
        (Array.isArray(shot.dialogue) ? shot.dialogue : [])
          .filter((d) => d?.speaker && String(d.text ?? '').trim())
          .map((d) => d.speaker),
      ),
    )
    const missing = speakers.filter((name) => !shot.performance?.some((p) => p.character === name))
    if (missing.length) {
      throw new Error(`${shot.no || shot.id} 缺少说话角色表演：${missing.join('、')}`)
    }
  }
  return { shots, sceneFallback, fallbackSceneNo }
}
