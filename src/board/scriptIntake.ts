import type { ProjectEpisode } from '../api'
import { mergeScriptDraft } from '../agent/drafts'
import { parseScriptMarkdown } from '../intake/scriptMarkdown'
import { validateContract } from '../skills/contracts'

export function episodesFromScriptJson(raw: unknown): ProjectEpisode[] {
  const result = validateContract('script-v1', raw)
  if (!result.ok) throw new Error(`不符合分集剧本契约：${result.errors.join('；')}`)
  const j = result.value as { episodes?: unknown[] }
  const list = Array.isArray(j.episodes) ? j.episodes : []
  return list
    .map((e) => {
      const ep = e as ProjectEpisode
      const no = Number(ep.no)
      if (!Number.isFinite(no) || no <= 0) return null
      return {
        ...ep,
        no,
        scenes: Array.isArray(ep.scenes) ? ep.scenes : [],
      }
    })
    .filter(Boolean) as ProjectEpisode[]
}

export function planScriptImport(
  current: ProjectEpisode[],
  incoming: ProjectEpisode[],
): { episodes: ProjectEpisode[]; summary: string; added: number; updated: number } {
  if (!incoming.length) throw new Error('没有可导入的分集')
  const merged = mergeScriptDraft(current, incoming, 'merge')
  return {
    episodes: merged.episodes,
    added: merged.added,
    updated: merged.updated,
    summary: `导入分集：新增 ${merged.added} 集 · 更新 ${merged.updated} 集`,
  }
}

/** 详情页源码编辑写回：解析 Markdown 并合并到当前 episodes */
export function applyEpisodeScriptMarkdownFromText(
  current: ProjectEpisode[],
  raw: string,
  hintEpNo?: number,
): { episodes: ProjectEpisode[]; summary: string } {
  const parsed = parseScriptMarkdown(raw, { hintEpNo })
  if (!parsed.ok) throw new Error(parsed.error)
  const incoming = episodesFromScriptJson({ episodes: parsed.episodes })
  const plan = planScriptImport(current, incoming)
  const bits = [`更新 ${plan.updated} 集`]
  if (plan.added) bits.unshift(`新增 ${plan.added} 集`)
  return { episodes: plan.episodes, summary: `已写回剧本：${bits.join(' · ')}` }
}
