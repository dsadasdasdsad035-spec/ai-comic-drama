import type { DesignKind, DesignSheet, ProjectShot } from './api'
import { digestEpisodes } from './charExtract'
import { uid } from './types'

/** 场景/道具的固定生图约束：空镜和隔离参考表，避免参考图污染镜头 */
export const SCENE_PLATE_SUFFIX =
  'empty scene plate, no people, no main characters, establishing wide shot, ' +
  'clean architecture and environment, 16:9'

export const PROP_SHEET_SUFFIX =
  'prop turnaround sheet, front view, side view, three-quarter view, ' +
  'isolated on neutral grey seamless background, no hands, no characters, ' +
  'consistent material and scale, 1:1'

/** 当前集/全剧的镜头摘要：不过滤无 cast、无台词的镜头，道具线索常在画面描述里 */
export function digestAllShots(shots: ProjectShot[]): string {
  return shots
    .map((s) => {
      const no = `E${String(Number(s.episode) || 1).padStart(2, '0')}-${s.no || s.id}`
      const dialogue = Array.isArray(s.dialogue)
        ? s.dialogue.map((d) => `${d.speaker ? `${d.speaker}：` : ''}${d.text}`).join(' / ')
        : String(s.dialogue ?? '')
      const frame = s.keyframe_prompt || s.desc || ''
      return [
        no,
        s.cast?.length ? `出场：${s.cast.join('、')}` : '',
        dialogue ? `台词：${dialogue.replace(/\s+/g, ' ').slice(0, 90)}` : '',
        frame ? `画面：${frame.replace(/\s+/g, ' ').slice(0, 140)}` : '',
      ]
        .filter(Boolean)
        .join(' ｜ ')
    })
    .join('\n')
}

type RawDesign = {
  name?: unknown
  refs?: unknown
  summary_cn?: unknown
  prompt_en?: unknown
  keywords?: unknown
}

function toDesign(kind: DesignKind, raw: RawDesign): DesignSheet | null {
  const name = String(raw?.name || '').trim()
  if (!name) return null
  const refs = Array.isArray(raw.refs) ? raw.refs.map(String).filter(Boolean) : []
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean) : []
  return {
    id: uid(),
    kind,
    name,
    refs: [...new Set(refs)],
    summaryCn: String(raw.summary_cn || '').trim(),
    promptEn: String(raw.prompt_en || '').trim(),
    keywords,
  }
}

/** 模型可能返回 { scenes, props }，也允许只返回其中一类 */
export function pickExtractedDesigns(json: unknown): DesignSheet[] {
  const j = (json ?? {}) as { scenes?: RawDesign[]; props?: RawDesign[] }
  const scenes = Array.isArray(j.scenes) ? j.scenes : []
  const props = Array.isArray(j.props) ? j.props : []
  return [
    ...scenes.map((raw) => toDesign('scene', raw)),
    ...props.map((raw) => toDesign('prop', raw)),
  ].filter((d): d is DesignSheet => Boolean(d))
}

/** 名称用于合并：忽略空白和英文大小写，中文按原文 */
export function normalizeDesignName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function mergeDesigns(
  cur: DesignSheet[],
  incoming: DesignSheet[],
): { next: DesignSheet[]; added: string[]; updated: string[] } {
  const next = cur.map((d) => ({ ...d }))
  const added: string[] = []
  const updated: string[] = []

  for (const inc of incoming) {
    const idx = next.findIndex(
      (d) => d.kind === inc.kind && normalizeDesignName(d.name) === normalizeDesignName(inc.name),
    )
    if (idx < 0) {
      next.push(inc)
      added.push(inc.name)
      continue
    }
    const old = next[idx]
    next[idx] = {
      ...old,
      refs: [...new Set([...(old.refs ?? []), ...(inc.refs ?? [])])],
      summaryCn: old.summaryCn || inc.summaryCn,
      promptEn: old.promptEn || inc.promptEn,
      keywords: old.keywords?.length ? old.keywords : inc.keywords,
      image: old.image || inc.image,
      candidates: old.candidates?.length ? old.candidates : inc.candidates,
      activeIdx: old.activeIdx ?? inc.activeIdx,
    }
    updated.push(old.name)
  }
  return { next, added, updated }
}

export function designRatio(kind: DesignKind): '16:9' | '1:1' {
  return kind === 'scene' ? '16:9' : '1:1'
}

/** 把英文字段拼成一次生图请求：固定后缀 + 项目画风，都是可复用约束 */
export function buildDesignPrompt(d: DesignSheet, style?: string): string {
  const base = String(d.promptEn || '').trim()
  const suffix = d.kind === 'scene' ? SCENE_PLATE_SUFFIX : PROP_SHEET_SUFFIX
  const styleText = String(style || '').trim()
  const withStyle =
    styleText && !base.toLowerCase().includes(styleText.toLowerCase()) ? styleText : ''
  return [base, suffix, withStyle].filter(Boolean).join(', ')
}

/** 给拆解输入补场景摘要；场景和镜头都为空时返回空串，由调用方报错 */
export function buildDesignContext(opts: {
  scope: 'episode' | 'script'
  epNo: number
  source?: string
  episodes?: Parameters<typeof digestEpisodes>[0]
  shots?: ProjectShot[]
}): { sceneText: string; shotText: string } {
  const eps = opts.episodes ?? []
  const curEp = eps.find((e) => Number(e.no) === opts.epNo)
  const sceneText =
    opts.scope === 'episode'
      ? digestEpisodes(curEp ? [curEp] : [])
      : [opts.source ? `【原著 / 梗概】\n${opts.source}` : '', digestEpisodes(eps)]
          .filter(Boolean)
          .join('\n\n')
  const shots =
    opts.scope === 'episode'
      ? (opts.shots ?? []).filter((s) => (Number(s.episode) || 1) === opts.epNo)
      : (opts.shots ?? [])
  return { sceneText, shotText: digestAllShots(shots) }
}
