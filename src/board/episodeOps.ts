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

export function episodeHasScript(episodes: ProjectEpisode[], epNo: number): boolean {
  const n = Math.max(1, Math.floor(Number(epNo) || 1))
  return episodes.some((e) => Number(e.no) === n)
}

export function findEpisode(episodes: ProjectEpisode[], epNo: number): ProjectEpisode | null {
  const n = Math.max(1, Math.floor(Number(epNo) || 1))
  return episodes.find((e) => Number(e.no) === n) ?? null
}

/** 从项目里去掉某一集的剧本元数据（标题、场次等）；不碰 shots */
export function planDeleteEpisodeScript(
  episodes: ProjectEpisode[],
  epNo: number,
): { episodes: ProjectEpisode[]; removed: boolean } {
  const n = Math.max(1, Math.floor(Number(epNo) || 1))
  const next = episodes.filter((e) => Number(e.no) !== n)
  return { episodes: next, removed: next.length < episodes.length }
}
