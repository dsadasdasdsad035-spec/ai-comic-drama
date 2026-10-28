import { shortHash } from './scheduleGeometry'
import type { PerformanceEmotion } from './types'

export type CharacterExpression = {
  image?: string
  candidates?: string[]
  activeIdx?: number
  source?: 'generated' | 'uploaded'
  /** 生成时的身份锚点指纹；lookEn 等变化后标 stale */
  fingerprint?: string
  stale?: boolean
}

/** 总图固定 4 列 × 2 行；格子坐标用 0..1 归一化，按实际图片尺寸换算。 */
export const EXPRESSION_SHEET_COLUMNS = 4 as const
export const EXPRESSION_SHEET_ROWS = 2 as const
export const EXPRESSION_SHEET_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
] as const satisfies readonly PerformanceEmotion[]

export type ExpressionSheetCell = {
  emotion: PerformanceEmotion
  x: number
  y: number
  w: number
  h: number
  /** 裁出的单格；只有它允许进入分镜参考，总图本身不发送 */
  cropUrl?: string
  cropFingerprint?: string
}

export type CharacterExpressionSheet = {
  image: string
  columns: typeof EXPRESSION_SHEET_COLUMNS
  rows: typeof EXPRESSION_SHEET_ROWS
  cells: ExpressionSheetCell[]
  source: 'generated' | 'uploaded'
  /** 生成时的身份锚点指纹；lookEn / palette / keywords 变化后标 stale */
  fingerprint: string
  stale?: boolean
  modelKey?: string
  createdAt?: string
}

export type VoiceSample = {
  /** 项目媒体路径 /project-assets/... */
  url: string
  text: string
  seconds: number
  engine: string
  voiceId: string
  modelKey?: string
  fingerprint: string
  stale?: boolean
  createdAt?: string
}

export const DEFAULT_VOICE_SAMPLE_TEXT =
  '这是一段用于确认角色音色的试音。请只参考声音的音色、年龄感和说话方式，不要复制这句话的内容。'

export function voiceSampleFingerprint(input: {
  url?: string
  text: string
  voiceId: string
  modelKey?: string
  engine?: string
}): string {
  return shortHash(
    JSON.stringify({
      url: input.url || '',
      text: input.text.trim(),
      voiceId: input.voiceId,
      modelKey: input.modelKey || '',
      engine: input.engine || '',
    }),
  )
}

export function isVoiceSampleUsable(sample: VoiceSample | undefined): boolean {
  return Boolean(
    sample &&
      sample.url &&
      !sample.stale &&
      Number(sample.seconds) >= 2 &&
      Number(sample.seconds) <= 30,
  )
}

export function markVoiceSampleStale(sample: VoiceSample | undefined): VoiceSample | undefined {
  return sample ? { ...sample, stale: true } : sample
}

export type CharacterSheet = {
  id: string
  name: string
  role: string
  /** 年龄段，project.json 里的 age 原样保留，避免回写时丢字段 */
  age?: string
  /** 该角色的默认音色（TTS voice id）。一镜多说话人时按行取这个 */
  voiceId?: string
  /** 选择音色时记录的渠道 id（用于切换渠道后的校验） */
  voiceProvider?: string
  /** 选择音色时记录的模型键 */
  voiceModelKey?: string
  lookCn: string
  /** 生图锚点：英文短语，所有镜头复用同一段，保证长相一致 */
  lookEn: string
  palette: string
  keywords: string[]
  image?: string
  candidates?: string[]
  activeIdx?: number
  state?: 'idle' | 'running' | 'error'
  error?: string
  /** 可选旧表情参考：按情绪索引；只读兼容，不再新增 */
  expressions?: Partial<Record<PerformanceEmotion, CharacterExpression>>
  /** 一张 4×2 表情总图；优先于旧 expressions，单格裁剪后才进分镜 */
  expressionSheet?: CharacterExpressionSheet
  /** 可选角色音色样本；用于 Seedance 原生音频的参考，不改变 voiceId */
  voiceSample?: VoiceSample
  /**
   * 参考图：作为「生成三视图/表情总图」的身份输入，不进入分镜参考预算。
   * 要让它进分镜，必须先「设为三视图」变成 image。
   */
  referenceImages?: string[]
}

export const EXPRESSION_SUFFIX =
  'head-and-shoulders portrait, same person as the identity anchor, same hairstyle, same outfit, ' +
  'same accessories, same lighting, plain neutral grey seamless studio background, only the facial ' +
  'expression changes, natural skin texture, consistent identity, no text, no watermark'

export const EXPRESSION_PROMPTS: Record<PerformanceEmotion, string> = {
  neutral: 'neutral relaxed expression, lips closed, calm gaze',
  happy: 'happy expression, genuine smile, bright eyes',
  sad: 'sad expression, downturned mouth, glistening eyes',
  angry: 'angry expression, tightened jaw, narrowed eyes',
  fearful: 'fearful expression, widened eyes, tense mouth',
  disgusted: 'disgusted expression, wrinkled nose, pressed lips',
  surprised: 'surprised expression, raised brows, slightly open mouth',
  calm: 'calm composed expression, relaxed face, steady gaze',
}

/** 身份锚点指纹：只由稳定外观决定，不包含镜头表演。 */
export function identityFingerprint(
  c: Pick<CharacterSheet, 'lookEn' | 'palette' | 'keywords'>,
): string {
  return [c.lookEn.trim(), c.palette.trim(), ...(c.keywords ?? [])].join('|')
}

/** 身份锚点变化时保留图片，只标需要重生成。 */
export function markExpressionsStale(
  expressions: CharacterSheet['expressions'],
): CharacterSheet['expressions'] {
  if (!expressions) return expressions
  const next: NonNullable<CharacterSheet['expressions']> = {}
  for (const [key, value] of Object.entries(expressions)) {
    if (!value) continue
    next[key as PerformanceEmotion] = { ...value, stale: true }
  }
  return next
}

export function markExpressionSheetStale(
  sheet: CharacterSheet['expressionSheet'],
): CharacterSheet['expressionSheet'] {
  return sheet ? { ...sheet, stale: true } : sheet
}

/**
 * 三视图提示词尾巴（character-design-sheet 的参考表规范）：
 * 除了「三个角度」，还必须锁定服装/道具/比例 —— 否则三视图彼此不一致，
 * 拿去做参考图反而把错误长相带进每一镜。
 */
export const TURNAROUND_SUFFIX =
  'character turnaround sheet, three views side by side: front view, side view, back view — ' +
  'full body, standing straight, arms relaxed, plain neutral grey seamless studio background, ' +
  'flat even lighting, no dramatic shadows, identical outfit, hairstyle, accessories and body ' +
  'proportions in all views, consistent design across views, no text, no watermark'

export const defaultCharacters: CharacterSheet[] = [
  {
    id: 'chenmo',
    name: '陈默',
    role: '主角 · 义体回收人',
    lookCn: '三十出头，方下颌，寸头，胡碴未刮，精瘦；洗旧的深灰工装外套，去掉指套的手套，左手为黄铜关节外露的机械义肢。',
    lookEn:
      'Chinese man in his early 30s, square jaw, short buzz cut, faint stubble, lean weathered build, ' +
      'worn dark grey work jacket over black shirt, fingerless gloves, mechanical left hand with exposed brass joints, tired eyes',
    palette: '铁灰 + 黄铜',
    keywords: ['左手机械义肢', '寸头', '黄铜关节'],
  },
  {
    id: 'chenxi',
    name: '陈曦',
    role: '妹妹 · 塔内技术员',
    lookCn: '二十七八岁，鹅蛋脸，及肩黑发束起，清瘦；白灰相间的技术员制服，颈侧有金属接口。',
    lookEn:
      'Chinese woman in her late 20s, oval face, shoulder-length black hair tied back, slim build, ' +
      'white and grey technician uniform, metal port implant on the side of her neck, calm but guarded expression',
    palette: '冷白 + 石墨灰',
    keywords: ['颈侧接口', '束发', '技术员制服'],
  },
  {
    id: 'crow',
    name: '鸦',
    role: '引路人 · 黑雨衣女人',
    lookCn: '三十余岁，颧骨锋利，瘦高；黑色连帽雨衣常年滴水，右眼为带刻度环的机械义眼，深红围巾。',
    lookEn:
      'Chinese woman in her 30s, sharp cheekbones, tall and thin, black hooded raincoat dripping wet, ' +
      'mechanical right eye with visible aperture rings, dark red scarf, expression unreadable',
    palette: '墨黑 + 暗红',
    keywords: ['机械义眼', '连帽雨衣', '深红围巾'],
  },
]
