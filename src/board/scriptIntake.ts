import type { ProjectEpisode } from '../api'
import { mergeScriptDraft } from '../agent/drafts'
import { parseScriptMarkdown } from '../intake/scriptMarkdown'
import { validateContract } from '../skills/contracts'

const pad3 = (n: number) => String(Math.max(1, Math.floor(n))).padStart(3, '0')

function sceneTag(epNo: number, scNo: number): string {
  return `EP${pad3(epNo)}-SC${pad3(scNo)}`
}

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

/** 大纲导入：占位补全后以 script-v1 落库，不因契约挡预览 */
export function episodesForScriptImport(episodes: ProjectEpisode[]): ProjectEpisode[] {
  if (!episodes.length) throw new Error('没有可导入的分集')
  const normalized = episodes.map((ep) => {
    const epNo = Number(ep.no)
    if (!Number.isFinite(epNo) || epNo <= 0) throw new Error('分集号无效')
    const scenes = Array.isArray(ep.scenes) ? ep.scenes : []
    if (!scenes.length) throw new Error(`第 ${epNo} 集没有场次`)
    return {
      ...ep,
      no: epNo,
      title: String(ep.title ?? '').trim() || `第 ${epNo} 集`,
      scenes: scenes.map((sc, i) => {
        const scNo = Number((sc as { no?: unknown }).no) || i + 1
        const spaceRaw = String((sc as { space?: unknown }).space ?? '').trim()
        const space = spaceRaw === '外' || spaceRaw === '内外' ? spaceRaw : '内'
        return {
          ...sc,
          no: scNo,
          slug: String((sc as { slug?: unknown }).slug ?? '').trim() || sceneTag(epNo, scNo),
          space,
          place: String((sc as { place?: unknown }).place ?? '').trim() || '未命名地点',
          time: String((sc as { time?: unknown }).time ?? '').trim() || '未注明时间',
          beats: String((sc as { beats?: unknown }).beats ?? ''),
        }
      }),
    }
  })
  const checked = validateContract('script-v1', { episodes: normalized })
  if (!checked.ok) throw new Error(`不符合分集剧本契约：${checked.errors.join('；')}`)
  return normalized as ProjectEpisode[]
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
  const incoming = episodesForScriptImport(parsed.episodes)
  const plan = planScriptImport(current, incoming)
  const bits = [`更新 ${plan.updated} 集`]
  if (plan.added) bits.unshift(`新增 ${plan.added} 集`)
  return { episodes: plan.episodes, summary: `已写回剧本：${bits.join(' · ')}` }
}
