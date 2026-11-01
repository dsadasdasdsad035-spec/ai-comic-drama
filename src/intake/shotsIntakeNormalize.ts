import type { ProjectEpisode } from '../api'
import { normalizeMove, normalizeSize, parseDuration } from './normalize'

/**
 * 整理技能允许省略缺列，但 shots-v1 契约要求可生产字段必填。
 * 在 assertSkillOutput 前补全占位，与 buildShotsFromImport 默认一致；预览仍会提示系统补值。
 */
export function normalizeShotsIntakeOutput(
  raw: unknown,
  epNo: number,
  episodes: ProjectEpisode[],
): { shots: Record<string, unknown>[] } {
  const j = (raw && typeof raw === 'object' ? raw : {}) as { shots?: unknown }
  const list = Array.isArray(j.shots) ? j.shots : []
  if (list.length === 0) throw new Error('整理结果里没有镜头条目')

  const curEp = episodes.find((x) => Number(x?.no) === epNo)
  const known = new Map<number, string>()
  for (const [si, sc] of (curEp?.scenes ?? []).entries()) {
    const no = Number((sc as { no?: unknown })?.no) || si + 1
    known.set(no, String((sc as { slug?: unknown })?.slug || ''))
  }
  const fallbackSceneNo = known.keys().next().value ?? 1
  const fallbackSceneSlug = known.get(fallbackSceneNo) ?? ''

  const pad = (n: number) => String(n).padStart(2, '0')

  const shots = list.map((item, i) => {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    let no = String(s.no ?? '').trim()
    if (!no) no = `S${pad(i + 1)}`

    const rawScene = s.scene_no ?? s.sceneNo ?? s.scene
    let sceneNo = Number(rawScene)
    if (!Number.isFinite(sceneNo) || (known.size > 0 && !known.has(sceneNo))) {
      sceneNo = fallbackSceneNo
    }

    let sceneSlug = String(s.scene_slug ?? s.sceneSlug ?? '').trim()
    if (!sceneSlug) sceneSlug = known.get(sceneNo) ?? fallbackSceneSlug

    let seconds: number
    if (typeof s.seconds === 'number' && Number.isFinite(s.seconds) && s.seconds > 0) {
      seconds = s.seconds
    } else {
      const parsed = parseDuration(s.seconds)
      seconds = parsed != null && parsed > 0 ? parsed : 3
    }

    const rawSize = s.size
    let size: string
    if (rawSize !== undefined && rawSize !== null && String(rawSize).trim()) {
      const norm = normalizeSize(rawSize)
      size = norm.size || String(rawSize).trim()
    } else {
      size = '中景'
    }

    const move = normalizeMove(s.move) ?? '固定'
    const desc = String(s.desc ?? s.description ?? '').trim()

    const out: Record<string, unknown> = {
      no,
      scene_no: sceneNo,
      scene_slug: sceneSlug,
      seconds,
      size,
      move,
      desc,
    }
    if (s.dialogue !== undefined) out.dialogue = s.dialogue
    if (s.performance !== undefined) out.performance = s.performance
    if (s.cast !== undefined) out.cast = s.cast
    return out
  })

  return { shots }
}
