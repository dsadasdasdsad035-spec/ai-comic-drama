import type { ProjectEpisode } from '../api'
import { episodeHasScript, findEpisode } from './episodeOps'

export type EpisodeScriptUi = {
  hasScript: boolean
  sceneCount: number
  title: string
  /** 集卡与顶栏芯片用的短标签 */
  badge: string
}

export function episodeScriptUi(episodes: ProjectEpisode[], epNo: number): EpisodeScriptUi {
  const ep = findEpisode(episodes, epNo)
  const hasScript = episodeHasScript(episodes, epNo)
  const sceneCount = ep?.scenes?.length ?? 0
  const title = String(ep?.title ?? '').trim()
  let badge = '缺剧本'
  if (hasScript) {
    badge = sceneCount > 0 ? `${sceneCount} 场` : '无场次'
  }
  return { hasScript, sceneCount, title, badge }
}