import type { ProjectEpisode } from '../api'

/**
 * 剧本草稿合并：按集号更新/新增，保留本次没有返回的集。
 * 纯函数，便于在聊天写草稿前做原子校验与单测。
 */
export function mergeScriptDraft(
  current: ProjectEpisode[],
  incoming: ProjectEpisode[],
): { episodes: ProjectEpisode[]; added: number; updated: number; kept: number } {
  const byNo = new Map<number, ProjectEpisode>()
  for (const ep of current) byNo.set(Number(ep.no), ep)
  let added = 0
  let updated = 0
  for (const ep of incoming) {
    const no = Number(ep?.no)
    if (!Number.isFinite(no)) continue
    if (byNo.has(no)) updated++
    else added++
    byNo.set(no, { ...ep, no })
  }
  const episodes = [...byNo.values()].sort((a, b) => Number(a.no) - Number(b.no))
  return { episodes, added, updated, kept: Math.max(0, current.length - updated) }
}
