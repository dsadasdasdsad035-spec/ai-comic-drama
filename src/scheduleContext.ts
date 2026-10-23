import type { CharacterSheet } from './characters'
import type { DesignSheet, ProjectAsset, ProjectEpisode } from './api'
import type { Mark, SceneLayout, ShotBlocking } from './types'
import { markBounds } from './scheduleGeometry'

/**
 * 给 3D 布局模型看的上下文。只拼文本，不把参考图像素送进模型。
 * 所有字段都有预算：当前场次/镜头最重要，长文只截断，不丢字段名。
 */
export type SceneContextInput = {
  episode?: ProjectEpisode
  scene?: {
    no?: number
    slug?: string
    place?: string
    time?: string
    beats?: string
    characters?: string[]
    intensity?: number
    tone?: string
  }
  sceneNo: number
  shots: {
    no?: string
    size?: string
    move?: string
    seconds?: number
    prompt?: string
    videoPrompt?: string
    cast?: string[]
    dialogue?: string | { speaker: string; text: string }[]
  }[]
  designs?: DesignSheet[]
  designId?: string
  layout?: SceneLayout
}

export type SceneContextResult = { text: string; design?: DesignSheet; sceneLabel: string }

export type BlockingContextInput = {
  episode?: ProjectEpisode
  scene: SceneLayout
  shot: {
    no?: string
    seconds?: number
    size?: string
    move?: string
    cast?: string[]
    dialogue?: string | { speaker: string; text: string }[]
    prompt?: string
    videoPrompt?: string
    refIds?: string[]
    refExtras?: string[]
    refImage?: string
    candidates?: string[]
    activeIdx?: number
  }
  characters?: CharacterSheet[]
  designs?: DesignSheet[]
  linkedAssets?: { title?: string; kind?: string; designId?: string; url?: string }[]
  marks?: Mark[]
  aspect?: string
  /** 当前视觉 brief 的文本版；由编排层提供，避免 context 依赖视觉模块 */
  visualBriefText?: string
}

const MAX_TEXT = 12000

const text = (v: unknown, max = 240): string => {
  let s = String(v ?? '')
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '[图片已省略]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''
  if (s.length > max) s = s.slice(0, max) + '…'
  return s
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

const dialogueLines = (dialogue: unknown): { speaker: string; text: string }[] => {
  if (!dialogue) return []
  if (Array.isArray(dialogue)) {
    return dialogue
      .map((x: any) => {
        if (typeof x === 'string') return parseLine(x)
        return { speaker: String(x?.speaker ?? '').trim(), text: String(x?.text ?? '').trim() }
      })
      .filter((x) => x.text)
  }
  return String(dialogue)
    .split('\n')
    .map((s) => parseLine(s))
    .filter((x) => x.text)
}

const parseLine = (line: string): { speaker: string; text: string } => {
  const m = String(line || '').trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/)
  return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: '', text: String(line || '').trim() }
}

const dialogueText = (dialogue: unknown): string =>
  dialogueLines(dialogue)
    .map((d) => (d.speaker ? `${d.speaker}：${d.text}` : d.text))
    .join('；')

const speakerNames = (dialogue: unknown): string[] =>
  [...new Set(dialogueLines(dialogue).map((d) => d.speaker).filter(Boolean))]

export function sceneDesignFor(input: {
  designs?: DesignSheet[]
  scene?: { slug?: string; place?: string }
  designId?: string
}): DesignSheet | undefined {
  const designs = (input.designs ?? []).filter((d) => d.kind === 'scene')
  if (input.designId) {
    const exact = designs.find((d) => d.id === input.designId)
    if (exact) return exact
  }
  const keys = [input.scene?.slug, input.scene?.place].map(norm).filter(Boolean)
  if (!keys.length) return undefined
  return designs.find((d) => {
    const n = norm(d.name)
    return keys.some((k) => n === k || n.includes(k) || k.includes(n))
  })
}

export function marksSummary(marks: Mark[] | undefined): string {
  const list = (marks ?? []).filter(Boolean)
  if (!list.length) return '无画面标注'
  const b = markBounds(list)
  if (!b) return `画面标注 ${list.length} 个，但没有可用坐标`
  const percent = (v: number) => Math.round(v * 100)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const hx = cx < 0.4 ? '左' : cx > 0.6 ? '右' : '中'
  const hy = cy < 0.4 ? '上' : cy > 0.6 ? '下' : '中'
  let maxArea = 0
  for (const m of list) {
    if (m.kind === 'rect') maxArea = Math.max(maxArea, Math.abs(Number(m.w) * Number(m.h)))
    if (m.kind === 'pen' && m.points?.length) {
      const bb = markBounds([m])
      if (bb) maxArea = Math.max(maxArea, bb.w * bb.h)
    }
  }
  return (
    `画面标注 ${list.length} 个：总覆盖 x ${percent(b.x)}%-${percent(b.x + b.w)}%、` +
    `y ${percent(b.y)}%-${percent(b.y + b.h)}%，重心偏${hx}${hy}；` +
    `最大标注约占画面 ${percent(Math.min(1, maxArea))}%`
  )
}

/** 场景布局生成的上下文：场次剧本 + 同场镜头 + 场景卡 + 已有布局 */
export function buildSceneContext(input: SceneContextInput): SceneContextResult {
  const ep = input.episode
  const sc = input.scene
  const sceneNo = Number(sc?.no ?? input.sceneNo) || input.sceneNo || 1
  const design = sceneDesignFor({ designs: input.designs, scene: sc, designId: input.designId })
  const sceneLabel = `E${String(ep?.no ?? 1).padStart(2, '0')}-SC${String(sceneNo).padStart(2, '0')}`
  const lines: string[] = []
  lines.push(`【集】E${String(ep?.no ?? 1).padStart(2, '0')}${ep?.title ? `《${text(ep.title, 60)}》` : ''}`)
  if (ep?.hook) lines.push(`【集尾钩子】${text(ep.hook, 200)}`)
  lines.push(
    `【场次】${sceneLabel}｜${text(sc?.slug || '未命名场次', 40)}｜地点：${text(sc?.place || '未注明', 80)}｜` +
      `时间/光线：${text(sc?.time || '未注明', 80)}`,
  )
  if (sc?.characters?.length) lines.push(`【场次在场】${sc.characters.map((s) => text(s, 24)).join('、')}`)
  if (sc?.intensity != null) lines.push(`【冲突强度】${Number(sc.intensity)}/10`)
  if (sc?.tone) lines.push(`【情绪基调】${text(sc.tone, 20)}`)
  if (sc?.beats) lines.push(`【场次内容】${text(sc.beats, 800)}`)

  const shots = (input.shots ?? []).slice(0, 30)
  if (shots.length) {
    lines.push('【同场镜头】')
    for (const s of shots) {
      const bits = [
        text(s.no, 20),
        s.size ? `景别 ${text(s.size, 12)}` : '',
        s.move ? `运镜 ${text(s.move, 12)}` : '',
        s.seconds != null ? `${Number(s.seconds).toFixed(1)}s` : '',
        s.cast?.length ? `出场 ${s.cast.map((x) => text(x, 16)).join('、')}` : '',
        s.prompt ? `画面：${text(s.prompt, 160)}` : '',
        s.videoPrompt ? `运动：${text(s.videoPrompt, 100)}` : '',
        dialogueText(s.dialogue) ? `台词：${text(dialogueText(s.dialogue), 140)}` : '',
      ].filter(Boolean)
      if (bits.length) lines.push(`- ${bits.join('｜')}`)
    }
  }
  if (design) {
    lines.push(
      `【场景设定卡】${text(design.name, 40)}｜摘要：${text(design.summaryCn, 500)}｜` +
        `英文锚点：${text(design.promptEn, 700)}｜关键词：${(design.keywords ?? []).map((k) => text(k, 24)).join('、')}`,
    )
  } else {
    lines.push('【场景设定卡】未找到关联场景卡；仍按场次文本与镜头推断空间')
  }
  if (input.layout) {
    lines.push(`【已有布局】${JSON.stringify(input.layout).slice(0, 6000)}`)
    lines.push('已有布局是用户/上一轮结果：除非明确要求重新生成，应保留其空间结构与尺寸。')
  }
  return { text: lines.join('\n').slice(0, MAX_TEXT), design, sceneLabel }
}

/** 镜头走位生成的上下文：台词、标注、秒数、角色/道具设定 + 场景 JSON */
export function buildBlockingContext(input: BlockingContextInput): string {
  const s = input.shot
  const lines: string[] = []
  lines.push(
    `【镜头】${text(s.no || '未编号', 30)}｜景别 ${text(s.size || '未注明', 16)}｜` +
      `运镜 ${text(s.move || '未注明', 16)}｜秒数 ${Number(s.seconds || 0).toFixed(1)}s｜画幅 ${text(input.aspect || '16:9', 10)}`,
  )
  const speakers = speakerNames(s.dialogue)
  if (speakers.length) lines.push(`【台词说话人】${speakers.map((x) => text(x, 20)).join('、')}`)
  if (s.cast?.length) lines.push(`【画面出场】${s.cast.map((x) => text(x, 20)).join('、')}`)
  if (s.prompt) lines.push(`【画面】${text(s.prompt, 900)}`)
  if (s.videoPrompt) lines.push(`【运动/动作】${text(s.videoPrompt, 700)}`)
  if (input.visualBriefText) lines.push(`【视觉 brief】${text(input.visualBriefText, 1200)}`)
  const dlg = dialogueText(s.dialogue)
  if (dlg) lines.push(`【台词】${text(dlg, 700)}`)
  lines.push(`【标注】${marksSummary(input.marks)}`)

  const roster = [...new Set([...(s.cast ?? []), ...speakers].map((x) => String(x).trim()).filter(Boolean))]
  const chars = (input.characters ?? []).filter((c) => roster.includes(c.name))
  if (chars.length) {
    lines.push('【角色设定】')
    for (const c of chars) {
      lines.push(
        `- ${text(c.name, 20)}｜${text(c.role, 30)}｜外观锚点：${text(c.lookEn, 600)}｜` +
          `配色：${text(c.palette, 80)}｜关键词：${(c.keywords ?? []).map((k) => text(k, 20)).join('、')}`,
      )
    }
  }
  const designIds = new Set<string>(coerceDesignIds(s))
  if (input.scene.designId) designIds.add(input.scene.designId)
  for (const p of input.scene.props) if (p.designId) designIds.add(p.designId)
  for (const a of input.linkedAssets ?? []) if (a.designId) designIds.add(a.designId)
  const designs = (input.designs ?? []).filter((d) => designIds.has(d.id))
  if (designs.length) {
    lines.push('【关联场景/道具设定】')
    for (const d of designs) {
      lines.push(
        `- [${d.kind === 'scene' ? '场景' : '道具'}] ${text(d.name, 30)}｜${text(d.summaryCn, 400)}｜` +
          `英文锚点：${text(d.promptEn, 400)}`,
      )
    }
  }
  const assets = (input.linkedAssets ?? []).filter((a) => a?.title)
  if (assets.length) {
    lines.push(
      `【素材引用】${assets
        .map((a) => `[${text(a.kind || '素材', 10)}] ${text(a.title, 30)}${a.designId ? `（设定 ${text(a.designId, 30)}）` : ''}`)
        .join('；')}`,
    )
  }
  lines.push(`【场景 JSON】${JSON.stringify(input.scene).slice(0, 7000)}`)
  return lines.join('\n').slice(0, MAX_TEXT)
}

function coerceDesignIds(s: { refIds?: string[]; refExtras?: string[] }): string[] {
  return [...(s.refIds ?? []), ...(s.refExtras ?? [])].map(String).filter(Boolean)
}

/** 把画布/素材库的引用解析成标题，给模型提供“镜头里有什么”的线索 */
export function linkedAssetsFor(
  assets: ProjectAsset[] | undefined,
  refs: { refIds?: string[]; refExtras?: string[] } | undefined,
  nodes?: { id: string; data?: object }[],
): { title?: string; kind?: string; designId?: string; url?: string }[] {
  const out: { title?: string; kind?: string; designId?: string; url?: string }[] = []
  const seen = new Set<string>()
  const byUrl = new Map((assets ?? []).map((a) => [a.url, a]))
  for (const id of refs?.refIds ?? []) {
    const node = nodes?.find((n) => n.id === id)
    const d = node?.data as { title?: string; kind?: string; designId?: string; url?: string } | undefined
    if (d?.title) {
      const key = `${d.title}|${d.designId ?? ''}|${d.url ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ title: d.title, kind: d.kind, designId: d.designId, url: d.url })
      }
    }
  }
  for (const url of refs?.refExtras ?? []) {
    const a = byUrl.get(url)
    if (a) {
      const key = `${a.title}|${a.designId ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ title: a.title, kind: a.kind, designId: a.designId, url: a.url })
      }
    }
  }
  return out
}


/** 当前镜头的参考板资源包：图片只用于视觉参考板，manifest 给文本模型 */
export type ShotResourcePack = {
  currentFrame?: string
  characters: { label: string; url?: string; kind: 'character' }[]
  scene?: { label: string; url?: string; kind: 'scene' }
  props: { label: string; url?: string; kind: 'prop' }[]
  manifest: string
  resources: string[]
}

export function buildShotResourcePack(input: {
  shot: BlockingContextInput['shot']
  scene: SceneLayout
  characters?: CharacterSheet[]
  designs?: DesignSheet[]
  linkedAssets?: { title?: string; kind?: string; designId?: string; url?: string }[]
  blocking?: ShotBlocking
  marks?: Mark[]
}): ShotResourcePack {
  const s = input.shot
  const roster = [...new Set([...(s.cast ?? []), ...speakerNames(s.dialogue)].map((x) => String(x).trim()).filter(Boolean))]
  const chars = (input.characters ?? []).filter((c) => roster.includes(c.name))
  const designs = input.designs ?? []
  const sceneDesign = designs.find((d) => d.id === input.scene.designId && d.kind === 'scene')
  const props: ShotResourcePack['props'] = []
  const seenProps = new Set<string>()
  for (const p of input.scene.props) {
    if (!p.designId) continue
    const d = designs.find((x) => x.id === p.designId && x.kind === 'prop')
    if (d && !seenProps.has(d.id)) {
      seenProps.add(d.id)
      props.push({ label: d.name, url: d.image, kind: 'prop' })
    }
  }
  for (const a of input.linkedAssets ?? []) {
    if (a.kind !== 'prop' || !a.title || seenProps.has(a.designId || a.title)) continue
    seenProps.add(a.designId || a.title)
    props.push({ label: a.title, url: a.url, kind: 'prop' })
  }
  const currentFrame = s.refImage || (s.candidates?.length ? s.candidates[Math.max(0, Math.min(s.candidates.length - 1, Number(s.activeIdx) || 0))] : undefined)
  const manifest = [
    `CURRENT FRAME: ${currentFrame || 'missing'}`,
    `SCENE: ${sceneDesign?.name || input.scene.sceneSlug || input.scene.id}${sceneDesign?.image ? ' (image)' : ''}`,
    `CHARACTERS: ${chars.map((c) => `${c.name}${c.image ? ' (image)' : ''}`).join('、') || 'none'}`,
    `PROPS: ${props.map((p) => `${p.label}${p.url ? ' (image)' : ''}`).join('、') || 'none'}`,
    `SHOT TEXT: ${text(s.prompt || '', 500)}`,
    `VIDEO TEXT: ${text(s.videoPrompt || '', 400)}`,
    `DIALOGUE: ${text(dialogueText(s.dialogue), 500)}`,
    `CAST: ${(s.cast ?? []).join('、') || 'none'}`,
    `MARKS: ${marksSummary(input.marks)}`,
  ].join('\n')
  const resources = [
    currentFrame || '',
    sceneDesign?.image || '',
    ...chars.map((c) => c.image || ''),
    ...props.map((p) => p.url || ''),
  ].filter(Boolean)
  return {
    ...(currentFrame ? { currentFrame } : {}),
    characters: chars.map((c) => ({ label: c.name, url: c.image, kind: 'character' })),
    ...(sceneDesign ? { scene: { label: sceneDesign.name, url: sceneDesign.image, kind: 'scene' } } : {}),
    props,
    manifest,
    resources,
  }
}
