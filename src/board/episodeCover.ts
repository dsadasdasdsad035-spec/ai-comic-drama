import type { ProjectEpisode, ProjectShot } from '../api'

export type EpisodeCoverKind = 'keyframe' | 'clip' | 'none'

export type EpisodeCover = {
  kind: EpisodeCoverKind
  /** keyframe / clip 的媒体 URL；`none` 时为 null */
  src: string | null
}

export type BoardEpisodeRow = {
  no: number
  title: string
  targetSeconds?: number
  shotCount: number
  cover: EpisodeCover
}

function noNumber(no: string | undefined): number | null {
  const m = String(no ?? '').match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function sortShotsInEpisode(a: ProjectShot, b: ProjectShot): number {
  const na = noNumber(a.no)
  const nb = noNumber(b.no)
  if (na != null && nb != null) return na - nb
  if (na != null) return -1
  if (nb != null) return 1
  return String(a.no ?? '').localeCompare(String(b.no ?? ''))
}

/** 该集按镜号排序后第一条可用封面：keyframe → clip → 无 */
export function resolveEpisodeCover(shots: ProjectShot[], epNo: number): EpisodeCover {
  const ep = Math.max(1, Math.floor(Number(epNo) || 1))
  const rows = shots
    .filter((s) => (Number(s.episode) || 1) === ep)
    .slice()
    .sort(sortShotsInEpisode)
  for (const s of rows) {
    const kf = String(s.keyframe ?? '').trim()
    if (kf) return { kind: 'keyframe', src: kf }
  }
  for (const s of rows) {
    const clip = String(s.clip ?? '').trim()
    if (clip) return { kind: 'clip', src: clip }
  }
  return { kind: 'none', src: null }
}

/** 与概览一致：`episodes` 与 shots 出现过的集号取并集 */
export function listBoardEpisodes(
  episodes: ProjectEpisode[],
  shots: ProjectShot[],
): BoardEpisodeRow[] {
  const map = new Map<number, number>()
  for (const s of shots) {
    const n = Number(s.episode) || 1
    map.set(n, (map.get(n) ?? 0) + 1)
  }
  const declared = episodes.map((e) => Number(e.no) || 1)
  const all = [...new Set([...declared, ...map.keys()])].filter((n) => n > 0).sort((a, b) => a - b)
  return all.map((no) => ({
    no,
    title: episodes.find((e) => Number(e.no) === no)?.title?.trim() || '',
    targetSeconds: episodes.find((e) => Number(e.no) === no)?.targetSeconds,
    shotCount: map.get(no) ?? 0,
    cover: resolveEpisodeCover(shots, no),
  }))
}
