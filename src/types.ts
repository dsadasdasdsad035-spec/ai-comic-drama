export type Tool = 'none' | 'pen' | 'rect'
export type Relation = 'cut' | 'transition' | 'flashback' | 'branch'

/** 标注坐标统一用 0..1 归一化，卡片宽度随镜头时长变化时不会错位 */
export type Mark = {
  id: string
  kind: 'pen' | 'rect'
  color: string
  /** pen: 扁平坐标 [x,y,x,y,...]，均为 0..1 */
  points?: number[]
  /** rect: 0..1 */
  x?: number
  y?: number
  w?: number
  h?: number
}

export type ShotData = {
  no: string
  seconds: number
  size: string
  move: string
  dialogue: string
  prompt: string
  /** 出片用的运动提示词（Seedance）：只写动作/运镜，不重复静态外观 */
  videoPrompt?: string
  /** 手动附加参考图（场景图/道具图），生成画面时与角色图一起传给 Seedream */
  refExtras?: string[]
  /** 参考连线：连到本镜的角色卡/素材卡节点 id（生成画面时按它取参考图） */
  refIds?: string[]
  /** 稳定业务 ID（E01-S03）。画布节点 id 是随机 uuid，跨会话对不上，同步一律靠它 */
  shotId?: string
  episode?: number
  /** 被人在工作台/画布上手改过的字段名，重新生成时跳过 */
  handEdited?: string[]
  /** project.json 里有、但本次推送没覆盖到 —— 只标灰，不自动删 */
  orphan?: boolean
  /** 该镜画面内的角色名（拆镜产出），时间线角色轨用 */
  cast?: string[]
  /** 时间线布局：配音相对镜头起点的偏移（秒，可负＝提前） */
  voiceOffset?: number
  /** 时间线布局：字幕相对镜头起点的偏移（秒） */
  subOffset?: number
  refImage?: string
  marks: Mark[]
  /** 一镜多候选 */
  candidates?: string[]
  activeIdx?: number
  /** AI 生成状态 */
  genState?: 'idle' | 'running' | 'error'
  genError?: string
  /** 图生视频产物 */
  videoUrl?: string
  vidState?: 'idle' | 'running' | 'error'
  vidError?: string
  /** 提交时间戳，用于计时 */
  vidAt?: number
  /** 台词配音 */
  voiceUrl?: string
  voiceState?: 'idle' | 'running' | 'error'
  voiceError?: string
  voiceName?: string
  voiceRate?: number
  /** 配音实际时长（秒） */
  voiceSeconds?: number
}

export const SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写', '大特写']
export const MOVES = ['固定', '推', '拉', '摇', '移', '跟', '升降', '手持']
export const RATIOS = ['16:9', '9:16', '4:3', '1:1']
export const CANDIDATE_COUNTS = [1, 2, 4]
/** 语速档位（say 的每分钟词数；ElevenLabs 走 voice_settings，此值仅本地生效） */
export const VOICE_RATES = [150, 180, 210]
export const PRICE_PER_IMAGE = 0.22

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)

/** 卡片宽度随时长变化，画面始终保持 16:9 */
export function cardWidth(seconds: number) {
  return Math.round(Math.min(380, Math.max(250, 270 + (seconds - 3) * 22)))
}

/** 旧版绝对坐标（264x148.5）标注 → 归一化 */
export function migrateMarks(marks: Mark[]): Mark[] {
  return (marks ?? []).map((m) => {
    if (m.kind === 'pen') {
      const pts = m.points ?? []
      const legacy = pts.some((v) => v > 1.5)
      return legacy
        ? { ...m, points: pts.map((v, i) => (i % 2 === 0 ? v / 264 : v / 148.5)) }
        : m
    }
    const legacy = (m.w ?? 0) > 1.5 || (m.h ?? 0) > 1.5 || (m.x ?? 0) > 1.5
    return legacy
      ? { ...m, x: (m.x ?? 0) / 264, y: (m.y ?? 0) / 148.5, w: (m.w ?? 0) / 264, h: (m.h ?? 0) / 148.5 }
      : m
  })
}
