import type { ProjectData, ProjectEpisode } from './api'

/** 分集缺少 targetSeconds 时仅用于展示与 Agent 输入，不写盘。 */
export const DEFAULT_EPISODE_TARGET_SECONDS = 60

export function resolveProjectStyle(project: Pick<ProjectData, 'style'> | null | undefined): string | null {
  const s = String(project?.style ?? '').trim()
  return s || null
}

export function requireProjectStyle(project: Pick<ProjectData, 'style'> | null | undefined): string {
  const style = resolveProjectStyle(project)
  if (!style) {
    throw new Error('项目尚未设置画风，请在项目管理 → 制作参数中补全后再发送。')
  }
  return style
}

export function resolveEpisodeTarget(
  episodes: ProjectEpisode[] | null | undefined,
  epNo: number,
): number {
  const ep = episodes?.find((x) => Number(x?.no) === Number(epNo))
  const raw = ep?.targetSeconds
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_EPISODE_TARGET_SECONDS
}

/** 更新某一集的 targetSeconds（返回新数组，不 mutate） */
export function setEpisodeTargetSeconds(
  episodes: ProjectEpisode[],
  epNo: number,
  targetSeconds: number,
): ProjectEpisode[] {
  const sec = Math.max(10, Math.round(Number(targetSeconds) || DEFAULT_EPISODE_TARGET_SECONDS))
  let found = false
  const next = episodes.map((ep) => {
    if (Number(ep.no) !== Number(epNo)) return ep
    found = true
    return { ...ep, targetSeconds: sec }
  })
  if (!found) {
    next.push({ no: epNo, scenes: [], targetSeconds: sec })
    next.sort((a, b) => Number(a.no) - Number(b.no))
  }
  return next
}
