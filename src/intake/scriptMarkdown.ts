import type { ProjectEpisode } from '../api'
import { hasShotTable } from './classify'

/** 与 short-drama `creator_markdown_check.FULL_SCENE_HEADING_RE` 对齐 */
export const FULL_SCENE_HEADING_RE =
  /^##[ \t\u3000]+(?<scene>(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,})-SC(?:[0-9]{3}|[1-9][0-9]{3,}))(?:[ \t\u3000]+|[ \t\u3000]*·[ \t\u3000]*)(?<space>内外|内|外)[ \t\u3000]*·[ \t\u3000]*(?<location>[^·\r\n]+?)[ \t\u3000]*·[ \t\u3000]*(?<time>[^·\r\n]+?)[ \t\u3000]*$/

const EP_IN_ID = /EP(?:0*)(\d+)/i
const SC_IN_ID = /SC(?:0*)(\d+)/i

const TITLE_EP_RE =
  /^#[ \t\u3000]+(?:(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,}))?[ \t\u3000]*(?:·[ \t\u3000]*)?(.*?)\r?$/

const LOOKS_LIKE_SCENE_HEAD =
  /^##[ \t\u3000]+(?:(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,})-SC(?:[0-9]{3}|[1-9][0-9]{3,}))/

const SHOT_HEAD = /^(镜头|镜号|shot)$/i

function epNoFromSceneId(sceneId: string): number | null {
  const m = sceneId.match(EP_IN_ID)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function scNoFromSceneId(sceneId: string): number | null {
  const m = sceneId.match(SC_IN_ID)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 文档里是否至少有一个合法 short-drama 场次标题 */
export function hasScriptSceneHeading(text: string): boolean {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trimEnd()
    if (!t.startsWith('##') || t.startsWith('###')) continue
    const m = FULL_SCENE_HEADING_RE.exec(t)
    if (m?.groups?.location?.trim() && m.groups.time?.trim()) return true
  }
  return false
}

function countShotTables(text: string): number {
  if (!hasShotTable(text)) return 0
  let n = 0
  let inTable = false
  let shotHead = false
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t.startsWith('|')) {
      if (!inTable) {
        inTable = true
        const first = t.replace(/^\|/, '').split('|')[0]?.trim().replace(/^`|`$/g, '') ?? ''
        shotHead = SHOT_HEAD.test(first)
      }
    } else if (inTable) {
      if (shotHead) n++
      inTable = false
      shotHead = false
    }
  }
  if (inTable && shotHead) n++
  return n
}

export type ParseScriptMarkdownHints = {
  hintEpNo?: number
}

export type ParseScriptMarkdownResult =
  | { ok: true; episodes: ProjectEpisode[]; warnings: string[] }
  | { ok: false; error: string }

/**
 * short-drama 式剧本 Markdown → 分集结构；场次正文原样写入 beats。
 */
export function parseScriptMarkdown(text: string, hints: ParseScriptMarkdownHints = {}): ParseScriptMarkdownResult {
  const raw = String(text ?? '').replace(/^\uFEFF/, '')
  if (!raw.trim()) return { ok: false, error: '没有内容' }

  const warnings: string[] = []
  const shotTables = countShotTables(raw)
  if (shotTables > 0) {
    warnings.push(`文中含 ${shotTables} 处分镜表，已忽略；分镜请用画布「导入」`)
  }

  const episodeTitles = new Map<number, string>()
  type SceneAcc = {
    no: number
    slug: string
    place: string
    time: string
    beatsLines: string[]
  }
  const episodesByNo = new Map<number, SceneAcc[]>()

  let current: SceneAcc | null = null
  const beatsBuf: string[] = []

  const flushScene = () => {
    if (!current) return
    current.beatsLines = [...beatsBuf]
    beatsBuf.length = 0
    const epNo = epNoFromSceneId(current.slug)
    if (epNo == null) {
      throw new Error(`无法从场次 ID 解析集号：${current.slug}`)
    }
    const list = episodesByNo.get(epNo) ?? []
    list.push(current)
    episodesByNo.set(epNo, list)
    current = null
  }

  try {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trimEnd()
      if (/^#[ \t\u3000]+/.test(trimmed) && !/^##/.test(trimmed)) {
        flushScene()
        const tm = TITLE_EP_RE.exec(trimmed)
        const titleRest = (tm?.[1] ?? trimmed.replace(/^#[ \t\u3000]+/, '')).trim()
        const epMatch = trimmed.match(EP_IN_ID)
        if (epMatch && titleRest) {
          const epNo = Number(epMatch[1])
          if (Number.isFinite(epNo) && epNo > 0) episodeTitles.set(epNo, titleRest)
        }
        continue
      }

      if (trimmed.startsWith('##') && !trimmed.startsWith('###')) {
        if (LOOKS_LIKE_SCENE_HEAD.test(trimmed)) {
          const m = FULL_SCENE_HEADING_RE.exec(trimmed)
          if (!m?.groups?.location?.trim() || !m.groups.time?.trim()) {
            return { ok: false, error: `场次标题格式不对：${trimmed.slice(0, 80)}` }
          }
          flushScene()
          const slug = m.groups.scene
          const scNo = scNoFromSceneId(slug)
          if (scNo == null) return { ok: false, error: `无法解析场号：${slug}` }
          current = {
            no: scNo,
            slug,
            place: m.groups.location.trim(),
            time: m.groups.time.trim(),
            beatsLines: [],
          }
          continue
        }
        return { ok: false, error: `不支持的二级标题（请使用 ## EP001-SC001 内 · 地点 · 时间）：${trimmed.slice(0, 80)}` }
      }

      if (current) beatsBuf.push(line)
    }
    flushScene()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  if (episodesByNo.size === 0) {
    return {
      ok: false,
      error: '没有找到场次标题；请写成 ## EP001-SC001 内 · 地点 · 时间',
    }
  }

  const hintEp = hints.hintEpNo != null ? Math.max(1, Math.floor(Number(hints.hintEpNo) || 1)) : undefined
  if (episodesByNo.size === 1 && hintEp != null) {
    const onlyKey = [...episodesByNo.keys()][0]
    if (onlyKey !== hintEp) {
      warnings.push(`文件中的集号为 EP${String(onlyKey).padStart(3, '0')}，与建议集 E${String(hintEp).padStart(2, '0')} 不一致，以场景 ID 为准`)
    }
  }

  const episodes: ProjectEpisode[] = [...episodesByNo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, scenes]) => {
      const sorted = [...scenes].sort((a, b) => a.no - b.no)
      return {
        no,
        title: episodeTitles.get(no) ?? `第 ${no} 集`,
        scenes: sorted.map((s) => ({
          no: s.no,
          slug: s.slug,
          place: s.place,
          time: s.time,
          beats: s.beatsLines.join('\n').trim(),
        })),
      }
    })

  return { ok: true, episodes, warnings }
}