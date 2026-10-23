import type { VisualBrief, VisualBriefMeta } from './types'
import { shortHash } from './scheduleGeometry'

/**
 * 视觉层只描述“看到了什么”，不产出米制坐标。
 * 参考板是一张带标签的拼图；这里负责提示词、解析和指纹。
 */
export const VISION_SYSTEM = `你是分镜预演的视觉场记。你会看到一张带标签的参考板，可能包含 CURRENT FRAME、SCENE、CHARACTER、PROP。请只描述你在图里真实看到的空间和构图关系，不要编造看不到的墙、门或人物。
只输出 JSON，不要解释。

只允许描述：
- 主体的屏幕位置：left / center / right；depth：near / mid / far；
- 谁挡住谁；人物面向镜头/背向/左/右；
- 可见的墙、门、窗、固定物在画面左/右/后/前；
- 景别、机位高低/角度、构图重心。
禁止输出 x/z 米制坐标、墙高数值或最终 3D 布局。`

export const VISION_OUTPUT = `输出 JSON：
{"version":1,
 "subjects":[{"name":"角色名","screen":"left|center|right","depth":"near|mid|far","occludedBy":"可选","facing":"camera|away|left|right"}],
 "visible":[{"kind":"wall|door|window|prop|floor","side":"left|right|back|front","description":"可见物"}],
 "shotSize":"中景/近景/...",
 "cameraHint":{"height":"low|eye|high","angle":"平视/俯拍/仰拍","notes":"..."},
 "composition":"主体在画面偏左，右侧留白",
 "confidence":0.7}`

export function buildVisionPrompt(manifest: string): string {
  return (
    `参考板资源清单：\n${manifest}\n\n` +
    `请描述当前分镜画面中的空间关系。标签中的 CURRENT FRAME 是当前镜头构图，SCENE 是场景设定，CHARACTER 是角色三视图，PROP 是关键道具。` +
    `如果某个区域是占位或缺失，明确忽略它。\n\n${VISION_OUTPUT}`
  )
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d

/** 解析视觉输出，只保留感知字段；绝对坐标/几何数值一律丢弃 */
export function normalizeVisualBrief(raw: unknown, usedVision = true): VisualBrief {
  const o = asObj(raw) || {}
  const subjectsRaw = Array.isArray(o.subjects) ? o.subjects : []
  const visibleRaw = Array.isArray(o.visible) ? o.visible : []
  const subjects = subjectsRaw
    .map((x) => asObj(x))
    .filter(Boolean)
    .slice(0, 8)
    .map((x) => ({
      ...(x!.name ? { name: String(x!.name).slice(0, 30) } : {}),
      screen: oneOf(x!.screen, ['left', 'center', 'right'] as const, 'center'),
      depth: oneOf(x!.depth, ['near', 'mid', 'far'] as const, 'mid'),
      ...(x!.occludedBy ? { occludedBy: String(x!.occludedBy).slice(0, 30) } : {}),
      ...(x!.facing
        ? { facing: oneOf(x!.facing, ['camera', 'away', 'left', 'right'] as const, 'camera') }
        : {}),
    }))
  const visible = visibleRaw
    .map((x) => asObj(x))
    .filter(Boolean)
    .slice(0, 12)
    .map((x) => ({
      kind: oneOf(x!.kind, ['wall', 'door', 'window', 'prop', 'floor'] as const, 'prop'),
      ...(x!.side ? { side: oneOf(x!.side, ['left', 'right', 'back', 'front'] as const, 'front') } : {}),
      description: String(x!.description || '').slice(0, 120),
    }))
    .filter((x) => x.description)
  const cam = asObj(o.cameraHint) || {}
  return {
    version: 1,
    usedVision,
    subjects,
    visible,
    ...(o.shotSize ? { shotSize: String(o.shotSize).slice(0, 30) } : {}),
    ...(Object.keys(cam).length
      ? {
          cameraHint: {
            ...(cam.height ? { height: oneOf(cam.height, ['low', 'eye', 'high'] as const, 'eye') } : {}),
            ...(cam.angle ? { angle: String(cam.angle).slice(0, 80) } : {}),
            ...(cam.notes ? { notes: String(cam.notes).slice(0, 160) } : {}),
          },
        }
      : {}),
    ...(o.composition ? { composition: String(o.composition).slice(0, 200) } : {}),
    ...(typeof o.confidence === 'number' && Number.isFinite(o.confidence)
      ? { confidence: Math.min(1, Math.max(0, o.confidence)) }
      : {}),
  }
}

export function visualBriefText(brief: VisualBrief | undefined): string {
  if (!brief) return ''
  const sub = brief.subjects
    .map(
      (s) =>
        `${s.name ? `${s.name}：` : ''}${s.screen}/${s.depth}${s.facing ? `，面向${s.facing}` : ''}${
          s.occludedBy ? `，被${s.occludedBy}遮挡` : ''
        }`,
    )
    .join('；')
  const vis = brief.visible.map((v) => `${v.kind}${v.side ? `(${v.side})` : ''}：${v.description}`).join('；')
  return [
    sub ? `主体：${sub}` : '',
    vis ? `可见：${vis}` : '',
    brief.shotSize ? `景别：${brief.shotSize}` : '',
    brief.cameraHint
      ? `机位：${[brief.cameraHint.height, brief.cameraHint.angle, brief.cameraHint.notes].filter(Boolean).join(' / ')}`
      : '',
    brief.composition ? `构图：${brief.composition}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function visualBriefFingerprint(input: {
  resources: string[]
  currentFrame?: string
  manifest: string
}): string {
  return shortHash(JSON.stringify({ resources: input.resources, currentFrame: input.currentFrame || '', manifest: input.manifest }))
}

export function makeVisualBriefMeta(input: {
  fingerprint: string
  usedVision: boolean
  modelKey?: string
}): VisualBriefMeta {
  return {
    version: 1,
    fingerprint: input.fingerprint,
    usedVision: input.usedVision,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    createdAt: new Date().toISOString(),
  }
}
