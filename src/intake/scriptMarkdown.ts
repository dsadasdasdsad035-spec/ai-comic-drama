import type { ProjectEpisode } from '../api'
import { hasShotTable } from './classify'

/** 与 short-drama `creator_markdown_check.FULL_SCENE_HEADING_RE` 对齐 */
export const FULL_SCENE_HEADING_RE =
  /^##[ \t\u3000]+(?<scene>(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,})-SC(?:[0-9]{3}|[1-9][0-9]{3,}))(?:[ \t\u3000]+|[ \t\u3000]*·[ \t\u3000]*)(?<space>内外|内|外)[ \t\u3000]*·[ \t\u3000]*(?<location>[^·\r\n]+?)[ \t\u3000]*·[ \t\u3000]*(?<time>[^·\r\n]+?)[ \t\u3000]*$/

const EP_IN_ID = /EP(?:0*)(\d+)/i
const SC_IN_ID = /SC(?:0*)(\d+)/i
const SCENE_ID_RE = /((?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,})-SC(?:[0-9]{3}|[1-9][0-9]{3,}))/i

const TITLE_EP_RE =
  /^#[ \t\u3000]+(?:(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,}))?[ \t\u3000]*(?:·[ \t\u3000]*)?(.*?)\r?$/

const LOOKS_LIKE_SCENE_HEAD =
  /^##[ \t\u3000]+(?:(?:[A-Za-z0-9]+-)*?EP(?:[0-9]{3}|[1-9][0-9]{3,})-SC(?:[0-9]{3}|[1-9][0-9]{3,}))/

const SHOT_HEAD = /^(镜头|镜号|shot)$/i

const pad3 = (n: number) => String(Math.max(1, Math.floor(n))).padStart(3, '0')

function sceneTag(epNo: number, scNo: number): string {
  return `EP${pad3(epNo)}-SC${pad3(scNo)}`
}

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

function inferSpace(token: string): string {
  const t = token.trim()
  if (/内外/.test(t)) return '内外'
  if (/^外|外景|^EXT\b/i.test(t)) return '外'
  return '内'
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

type SceneAcc = {
  no: number
  slug: string
  space: string
  place: string
  time: string
  beatsLines: string[]
}

function tryStrictSceneHeading(trimmed: string, warnings: string[]): SceneAcc | null {
  if (!LOOKS_LIKE_SCENE_HEAD.test(trimmed)) return null
  const m = FULL_SCENE_HEADING_RE.exec(trimmed)
  if (!m?.groups?.scene) return null
  const slug = m.groups.scene
  const scNo = scNoFromSceneId(slug)
  if (scNo == null) return null
  const place = m.groups.location?.trim() || '未命名地点'
  const time = m.groups.time?.trim() || '未注明时间'
  if (!m.groups.location?.trim() || !m.groups.time?.trim()) {
    warnings.push(`场次「${slug}」标题不完整，已用占位补全地点或时间`)
  }
  return {
    no: scNo,
    slug,
    space: (m.groups.space ?? '内').trim(),
    place,
    time,
    beatsLines: [],
  }
}

function parseLooseSceneHeading(
  trimmed: string,
  activeEpNo: number,
  scSeq: Map<number, number>,
  warnings: string[],
): SceneAcc {
  const body = trimmed.replace(/^##[ \t\u3000]+/, '').trim()
  const idMatch = body.match(SCENE_ID_RE)
  const slugFromId = idMatch?.[1]
  let epNo = slugFromId ? epNoFromSceneId(slugFromId) ?? activeEpNo : activeEpNo
  let scNo = slugFromId ? scNoFromSceneId(slugFromId) ?? nextSceneNo(epNo, scSeq) : nextSceneNo(epNo, scSeq)
  const slug = slugFromId ?? sceneTag(epNo, scNo)
  if (!slugFromId) {
    warnings.push(`场次「${body.slice(0, 48)}${body.length > 48 ? '…' : ''}」已按顺序生成 ${slug}`)
  }

  const parts = body
    .replace(SCENE_ID_RE, '')
    .split(/[·・]/)
    .map((p) => p.trim())
    .filter(Boolean)

  let space = '内'
  let place = '未命名地点'
  let time = '未注明时间'

  if (parts.length >= 3 && /^(内外|内|外|内景|外景|INT|EXT)/i.test(parts[0])) {
    space = inferSpace(parts[0])
    place = parts[1] || place
    time = parts[2] || time
  } else if (parts.length === 2) {
    space = inferSpace(parts[0])
    place = parts[1]
  } else if (parts.length === 1) {
    place = parts[0]
    space = inferSpace(parts[0])
  } else if (body && !slugFromId) {
    place = body.slice(0, 80)
  }

  scSeq.set(epNo, Math.max(scSeq.get(epNo) ?? 0, scNo))
  return { no: scNo, slug, space, place, time, beatsLines: [] }
}

function nextSceneNo(epNo: number, scSeq: Map<number, number>): number {
  const n = (scSeq.get(epNo) ?? 0) + 1
  scSeq.set(epNo, n)
  return n
}

function isSceneH2Line(trimmed: string): boolean {
  if (!trimmed.startsWith('##') || trimmed.startsWith('###')) return false
  if (trimmed.trimStart().startsWith('|')) return false
  return true
}

export type ParseScriptMarkdownHints = {
  hintEpNo?: number
}

export type ParseScriptMarkdownResult =
  | { ok: true; episodes: ProjectEpisode[]; warnings: string[] }
  | { ok: false; error: string }

/**
 * 剧本 Markdown / 纯文本 → 分集结构；场次正文原样写入 beats。非空输入原则上总能解析出场次（零门禁）。
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
  const episodesByNo = new Map<number, SceneAcc[]>()
  const scSeq = new Map<number, number>()

  let activeEpNo = hints.hintEpNo != null ? Math.max(1, Math.floor(Number(hints.hintEpNo) || 1)) : 1
  let current: SceneAcc | null = null
  const beatsBuf: string[] = []

  const flushScene = () => {
    if (!current) return
    current.beatsLines = [...beatsBuf]
    beatsBuf.length = 0
    const epNo = epNoFromSceneId(current.slug) ?? activeEpNo
    activeEpNo = epNo
    const list = episodesByNo.get(epNo) ?? []
    list.push(current)
    episodesByNo.set(epNo, list)
    scSeq.set(epNo, Math.max(scSeq.get(epNo) ?? 0, current.no))
    current = null
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimEnd()

    if (/^#[ \t\u3000]+/.test(trimmed) && !/^##/.test(trimmed)) {
      flushScene()
      const tm = TITLE_EP_RE.exec(trimmed)
      const titleRest = (tm?.[1] ?? trimmed.replace(/^#[ \t\u3000]+/, '')).trim()
      const epMatch = trimmed.match(EP_IN_ID)
      if (epMatch) {
        const epNo = Number(epMatch[1])
        if (Number.isFinite(epNo) && epNo > 0) {
          activeEpNo = epNo
          if (titleRest) episodeTitles.set(epNo, titleRest.replace(/^EP(?:[0-9]{3}|[1-9][0-9]{3,})\s*/i, '').trim())
        }
      }
      continue
    }

    if (isSceneH2Line(trimmed)) {
      flushScene()
      const strict = tryStrictSceneHeading(trimmed, warnings)
      current = strict ?? parseLooseSceneHeading(trimmed, activeEpNo, scSeq, warnings)
      const epFromSlug = epNoFromSceneId(current.slug)
      if (epFromSlug != null) activeEpNo = epFromSlug
      continue
    }

    if (current) beatsBuf.push(line)
  }
  flushScene()

  if (episodesByNo.size === 0) {
    const epNo = activeEpNo
    const beats = raw.trim()
    warnings.push('未识别场标题，全文已作为一场导入')
    episodesByNo.set(epNo, [
      {
        no: 1,
        slug: sceneTag(epNo, 1),
        space: '内',
        place: '未命名地点',
        time: '未注明时间',
        beatsLines: beats.split('\n'),
      },
    ])
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
          space: s.space,
          place: s.place,
          time: s.time,
          beats: s.beatsLines.join('\n').trim(),
        })),
      }
    })

  return { ok: true, episodes, warnings }
}