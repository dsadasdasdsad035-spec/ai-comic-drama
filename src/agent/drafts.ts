import type { ProjectEpisode } from '../api'

export type MergeMode = 'merge' | 'replace'

/**
 * 剧本草稿合并：按集号更新/新增，保留本次没有返回的集。
 * 纯函数，便于在聊天写草稿前做原子校验与单测。
 *
 * mode 只表达调用方意图：聊天与生成（replace）允许整集覆盖，
 * 导入（merge）要求只动文件里出现的集。两者在按集号合并这一点上一致，
 * 差别由上层对「场次增删」的处理决定，这里只把意图透传出去。
 */
export function mergeScriptDraft(
  current: ProjectEpisode[],
  incoming: ProjectEpisode[],
  mode: MergeMode = 'replace',
): { episodes: ProjectEpisode[]; added: number; updated: number; kept: number; mode: MergeMode } {
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
  return { episodes, added, updated, kept: Math.max(0, current.length - updated), mode }
}
