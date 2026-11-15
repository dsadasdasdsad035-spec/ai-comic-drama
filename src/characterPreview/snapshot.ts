import {
  EXPRESSION_SHEET_EMOTIONS,
  identityFingerprint,
  isVoiceSampleUsable,
  orbitIdentityFingerprint,
  type CharacterSheet,
} from '../characters'
import { isSheetUsable } from '../expressionSheet'
import type { PerformanceEmotion } from '../types'

/**
 * 预览快照版本。导出的单文件会比应用活得久，所以格式必须自带版本号；
 * viewer 对未知字段容错、对缺失字段降级，旧文件永远不该白屏。
 */
export const PREVIEW_SCHEMA_VERSION = 1

export type PreviewOrbitFrame = {
  /** 水平视角（度），0 为正面 */
  angle: number
  url: string
}

export type PreviewEmotion = {
  emotion: PerformanceEmotion
  url: string
}

export type PreviewSnapshot = {
  schemaVersion: number
  /** 派生时间；导出文件用它告诉人"这张卡是什么时候的样子" */
  generatedAt: string
  /** 身份锚点指纹；角色外观改动后与当前角色不一致，据此判定文件过期 */
  identityFingerprint: string
  character: {
    name: string
    role: string
    age?: string
    /** 中文外观描述，人读的主文案 */
    desc: string
  }
  look: {
    palette: string
    keywords: string[]
    turnaroundUrl?: string
  }
  /** 只有八帧齐全且对应当前外观时才给出；缺帧即降级为静态卡 */
  orbit?: {
    frames: PreviewOrbitFrame[]
    createdAt?: string
  }
  /** 有转盘总图，但它对应的已不是当前外观；预览据此显示「需重新生成」 */
  orbitStale: boolean
  emotions: PreviewEmotion[]
  /** 只有可用试音才给出；没有就不渲染播放入口 */
  voice?: {
    url: string
    text: string
    seconds: number
  }
  /** 有试音样本但已不可用；预览要说明"需重新生成"而不是静默消失 */
  voiceStale: boolean
  /**
   * 真 3D 网格的位置，留给后续增量扩展。
   * 本版本不产生该字段，也不消费它——有值才启用 model-viewer 分支。
   */
  glbUrl?: string
}

/**
 * 角色卡 → 预览快照。纯函数：只读入参，不碰 store、不调接口、不改角色。
 *
 * 降级链在这里一次定死：八帧齐全 → 转盘；否则静态卡；连图都没有 → 文字卡。
 */
export function buildPreviewSnapshot(
  character: CharacterSheet,
  options: { now?: Date } = {},
): PreviewSnapshot {
  const now = options.now ?? new Date()
  const identity = identityFingerprint(character)
  const orbitIdentity = orbitIdentityFingerprint(character)

  const orbitSheet = character.orbitSheet
  const orbitCurrent = Boolean(orbitSheet) && orbitSheet!.fingerprint === orbitIdentity
  const orbitFrames = orbitUsableFrames(character, orbitIdentity)

  const emotions: PreviewEmotion[] = []
  if (isSheetUsable(character.expressionSheet, identity)) {
    for (const emotion of EXPRESSION_SHEET_EMOTIONS) {
      const cell = character.expressionSheet!.cells.find((item) => item.emotion === emotion)
      if (cell?.cropUrl) emotions.push({ emotion, url: cell.cropUrl })
    }
  }

  const sample = character.voiceSample
  const voice = isVoiceSampleUsable(sample)
    ? { url: sample!.url, text: sample!.text, seconds: sample!.seconds }
    : undefined

  const turnaroundUrl = character.image || undefined

  return {
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    identityFingerprint: identity,
    character: {
      name: character.name || '',
      role: character.role || '',
      ...(character.age ? { age: character.age } : {}),
      desc: character.lookCn || '',
    },
    look: {
      palette: character.palette || '',
      keywords: [...(character.keywords ?? [])],
      ...(turnaroundUrl ? { turnaroundUrl } : {}),
    },
    ...(orbitFrames.length
      ? {
          orbit: {
            frames: orbitFrames,
            ...(character.orbitSheet?.createdAt ? { createdAt: character.orbitSheet.createdAt } : {}),
          },
        }
      : {}),
    orbitStale: Boolean(orbitSheet) && !orbitCurrent,
    emotions,
    ...(voice ? { voice } : {}),
    voiceStale: Boolean(sample) && !voice,
  }
}

/**
 * 转盘可渲染帧。要求：对应当前外观、八格齐全、每格都有裁好的单帧。
 * 差一格就整张降级——半张转盘比静态卡更让人困惑。
 */
function orbitUsableFrames(character: CharacterSheet, orbitIdentity: string): PreviewOrbitFrame[] {
  const sheet = character.orbitSheet
  if (!sheet || sheet.stale) return []
  if (sheet.fingerprint !== orbitIdentity) return []
  if (!sheet.image) return []
  const frames: PreviewOrbitFrame[] = []
  for (const cell of sheet.cells ?? []) {
    if (!cell.cropUrl) return []
    frames.push({ angle: cell.angle, url: cell.cropUrl })
  }
  return frames
}
