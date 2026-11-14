import type { ProjectEpisode, ProjectShot } from '../api'
import { listBoardEpisodes } from './episodeCover'

/** 下一可用集号：已声明集与镜头中出现过的集号取最大值 +1 */
export function nextEpisodeNo(episodes: ProjectEpisode[], shots: ProjectShot[]): number {
  const rows = listBoardEpisodes(episodes, shots)
  if (!rows.length) return 1
  return Math.max(...rows.map((r) => r.no)) + 1
}

export function blankEpisode(no: number, title?: string): ProjectEpisode {
  const n = Math.max(1, Math.floor(Number(no) || 1))
  const t = String(title ?? '').trim()
  return {
    no: n,
    title: t || `第 ${n} 集`,
    scenes: [],
  }
}
