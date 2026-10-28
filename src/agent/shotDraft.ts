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

/**
 * 导入用的镜头构建：复用 buildShotsFromModel 的字段映射，
 * 但对「有台词角色缺表演条目」放宽为自动补默认表演。
 *
 * 为什么聊天要抛错而导入不抛：模型应该产出表演，缺了是它的失职；
 * 而手写表格几乎不会带表演列，硬失败会让这条路径完全不可用。
 * 补了什么必须回报给预览，不能让人以为表演是文件里写的。
 *
 * 注意补丁必须在调用 buildShotsFromModel 之前打好：它的校验会在
 * 有任何 performance 数组时检查说话角色是否齐全，空数组同样会触发。
 */
export function buildShotsFromImport(
  got: unknown[],
  episodes: ProjectEpisode[],
  epNo: number,
): { shots: ProjectShot[]; sceneFallback: number; fallbackSceneNo: number; filledPerformance: number } {
  let filledPerformance = 0
  const patched = got.map((raw) => {
    const s = (raw || {}) as Record<string, unknown>
    const existing = Array.isArray(s.performance)
      ? (s.performance as { character?: unknown }[]).filter((x) => x && typeof x === 'object')
      : []
    const speakers = Array.from(
      new Set(
        (Array.isArray(s.dialogue) ? s.dialogue : [])
          .map((d) => {
            const line = (d || {}) as { speaker?: unknown; text?: unknown }
            const name = String(line.speaker ?? '').trim()
            return name && String(line.text ?? '').trim() ? name : ''
          })
          .filter(Boolean),
      ),
    )
    const missing = speakers.filter((name) => !existing.some((p) => String(p.character ?? '') === name))
    if (missing.length === 0) {
      // 没有表演需求就把字段去掉，避免留下空数组让下游误判
      if (Array.isArray(s.performance) && existing.length === 0) {
        const next = { ...s }
        delete next.performance
        return next
      }
      return raw
    }
    filledPerformance += missing.length
    return {
      ...s,
      performance: [
        ...existing,
        ...missing.map((name) => ({ character: name, emotion: 'neutral', intensity: 3, speaks: true })),
      ],
    }
  })

  return { ...buildShotsFromModel(patched, episodes, epNo), filledPerformance }
}
