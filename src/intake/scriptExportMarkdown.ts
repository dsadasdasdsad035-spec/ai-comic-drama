import type { ProjectEpisode } from '../api'

const pad3 = (n: number) => String(Math.max(1, Math.floor(n))).padStart(3, '0')

function epTag(no: number): string {
  return `EP${pad3(no)}`
}

function sceneTag(epNo: number, scNo: number): string {
  return `${epTag(epNo)}-SC${pad3(scNo)}`
}

function sceneSpace(sc: NonNullable<ProjectEpisode['scenes']>[number]): string {
  const s = String((sc as { space?: string }).space ?? '').trim()
  if (s === '内' || s === '外' || s === '内外') return s
  const slug = String(sc.slug ?? '')
  if (/内外/.test(slug)) return '内外'
  return '内'
}

/**
 * 单集 short-drama 剧本 Markdown，与 `parseScriptMarkdown` 互为往返。
 */
export function buildScriptEpisodeMarkdown(episode: ProjectEpisode | null, epNo: number): string {
  if (!episode) {
    return `# ${epTag(epNo)}\n\n（尚未登记分集）\n`
  }
  const no = Number(episode.no) || epNo
  const title = String(episode.title ?? '').trim()
  const hook = String(episode.hook ?? '').trim()
  const lines: string[] = [`# ${epTag(no)}${title ? ` ${title}` : ''}`]
  if (hook) {
    lines.push('', `> ${hook.replace(/\n/g, '\n> ')}`)
  }
  const scenes = [...(episode.scenes ?? [])].sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0))
  if (scenes.length === 0) {
    lines.push('', '_本集尚未填写场次。_')
    return lines.join('\n')
  }
  for (const [i, sc] of scenes.entries()) {
    const scNo = Number(sc.no) || i + 1
    const slug = String(sc.slug ?? '').trim() || sceneTag(no, scNo)
    const place = String(sc.place ?? '').trim() || '未命名地点'
    const time = String(sc.time ?? '').trim() || '未注明时间'
    const space = sceneSpace(sc)
    lines.push('', `## ${slug} ${space} · ${place} · ${time}`)
    const beats = String(sc.beats ?? '').trim()
    if (beats) lines.push('', beats)
  }
  return `${lines.join('\n').trim()}\n`
}