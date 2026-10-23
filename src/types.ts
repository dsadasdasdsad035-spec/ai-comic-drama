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
  /** 旧版调度坐标：仅用于迁移；新数据写 shotBlocking */
  layout?: ShotLayout
  /** 所属场次（1 起）。同集同场共享 SceneLayout */
  sceneNo?: number
  sceneSlug?: string
  /** 本镜独立 3D 空间（每镜一份，不与其他镜头共享） */
  shotScene?: ShotScene
  /** 生成时使用的上一镜 shot.id */
  shotSceneSeed?: string
  /** 视觉模型输出的感知 brief */
  visualBrief?: VisualBrief
  /** brief 的资源指纹/模型/是否真的用了视觉 */
  visualBriefMeta?: VisualBriefMeta
  /** 镜头级走位与机位关键帧 */
  shotBlocking?: ShotBlocking
  /** 代码优先 3D：每镜一段 Three.js 代码 */
  sceneCode?: SceneCode
  /** 代码渲染的输入指纹与输出参数 */
  sceneCodeMeta?: SceneCodeMeta
  /** 代码优先 3D 的参考内容选择 */
  shot3DContext?: Shot3DContext
  /** 最近一次成功渲染的输入指纹与输出参数 */
  scheduleMeta?: ScheduleMeta
  /** 3D 调度动画（webm/mp4，本地路径）：给人审运镜与走位 */
  scheduleVideo?: string
  /** 从调度视频抽出的关键帧（可作结构性参考，白模会污染画风，默认不传） */
  scheduleFrames?: string[]
  /** 从 3D 调度推出来的运镜/走位描述，出片时拼进 prompt */
  motionNote?: string
  /** 出片时是否把调度关键帧当参考图（白模风格可能污染画面，默认关） */
  useScheduleFrames?: boolean
  /** 出片时是否把调度视频本身当 reference_video（需 Seedance 2.0+，默认关） */
  useScheduleVideoRef?: boolean
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

/** 俯视调度：人物站位 + 机位，全部归一化到 0~1，渲染时乘画布尺寸 */
export type LayoutActor = { name: string; x: number; y: number; face: number }
export type LayoutCamera = { x: number; y: number; lookX: number; lookY: number }
export type ShotLayout = {
  actors: LayoutActor[]
  camera: LayoutCamera
  /** 场地尺寸（米），仅用于显示比例 */
  w?: number
  h?: number
  /** 轴线说明（默认取前两名演员连线） */
  axisNote?: string
}

export const DEFAULT_LAYOUT: ShotLayout = {
  actors: [],
  camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5 },
  w: 10,
  h: 8,
}

// ---------------------------------------------------------------- 场景级 3D 调度

export type SceneWallOpening = {
  /** 从墙起点沿墙方向的偏移（米） */
  at: number
  width: number
  height: number
  kind: 'door' | 'window'
  /** 窗台高度（米）；门默认 0 */
  sill?: number
}

export type SceneWall = {
  id: string
  /** 场地左上为原点，x 向右、z 向下，单位米 */
  x1: number
  z1: number
  x2: number
  z2: number
  height: number
  thickness: number
  openings?: SceneWallOpening[]
}

export type SceneProp = {
  id: string
  name: string
  designId?: string
  shape: 'box' | 'cylinder'
  /** 中心点，米 */
  x: number
  z: number
  w: number
  d: number
  h: number
  rotation: number
}

export type SceneZone = {
  id: string
  name: string
  kind: 'floor' | 'blocked' | 'action'
  x: number
  z: number
  w: number
  d: number
  color?: string
}

export type SceneAxis = {
  a: { x: number; z: number }
  b: { x: number; z: number }
  label?: string
}

export type VisualBriefSubject = {
  name?: string
  screen: 'left' | 'center' | 'right'
  depth: 'near' | 'mid' | 'far'
  occludedBy?: string
  facing?: 'camera' | 'away' | 'left' | 'right'
}

export type VisualBrief = {
  version: 1
  usedVision: boolean
  subjects: VisualBriefSubject[]
  visible: {
    kind: 'wall' | 'door' | 'window' | 'prop' | 'floor'
    side?: 'left' | 'right' | 'back' | 'front'
    description: string
  }[]
  shotSize?: string
  cameraHint?: { height?: 'low' | 'eye' | 'high'; angle?: string; notes?: string }
  composition?: string
  confidence?: number
}

export type VisualBriefMeta = {
  version: 1
  fingerprint: string
  usedVision: boolean
  modelKey?: string
  createdAt: string
}

export type ShotScene = SceneLayout & {
  /** 从哪个镜头继承空间（可空） */
  seedFrom?: string
}

export type SceneLayout = {
  /** E01-SC02；项目内稳定键 */
  id: string
  episode: number
  sceneNo: number
  sceneSlug?: string
  /** 关联的 scenes 设定卡 */
  designId?: string
  w: number
  h: number
  walls: SceneWall[]
  props: SceneProp[]
  zones: SceneZone[]
  axis?: SceneAxis
  source: 'ai' | 'manual' | 'legacy' | 'fallback'
  updatedAt?: string
}

export type BlockingActor = { name: string; x: number; y: number; face: number }

export type BlockingCamera = {
  x: number
  y: number
  lookX: number
  lookY: number
  /** 机位高度，米 */
  height: number
  /** 垂直视场角，度 */
  fov: number
}

export type BlockingKey = {
  /** 0~1 */
  t: number
  actors: BlockingActor[]
  camera: BlockingCamera
}

export type ShotBlocking = {
  keys: BlockingKey[]
  notes?: string
  source: 'ai' | 'manual' | 'legacy' | 'fallback'
  updatedAt?: string
}

export type ScheduleMeta = {
  version: 1
  fingerprint: string
  mode: 'clean' | 'review'
  duration: number
  aspect: string
  width: number
  height: number
  renderedAt: string
}

// ---------------------------------------------------------------- 代码优先 3D

export type SceneCodeSource = 'ai' | 'manual' | 'legacy-converted' | 'fallback'

/** 每镜一段 Three.js 代码；代码是场景真相，不再维护结构化空间清单。 */
export type SceneCode = {
  version: 1
  abiVersion: 1
  code: string
  codeHash: string
  source: SceneCodeSource
  title?: string
  /** 代码生成/用户编写的运镜说明；不是从几何自动推导 */
  motionNote?: string
  updatedAt: string
}

export type SceneCodeAssetRef = {
  /** 稳定键，例如 character:chenmo / image:ab12cd34 */
  key: string
  url: string
  kind: 'image' | 'video-frame'
  source: 'character' | 'design' | 'asset' | 'image' | 'video'
  label: string
  contentHash: string
  width?: number
  height?: number
  videoDuration?: number
  frameTime?: number
}

export type SceneCodeMeta = {
  version: 1
  fingerprint: string
  codeHash: string
  abiVersion: 1
  assets: SceneCodeAssetRef[]
  /** 渲染时的参考内容选择指纹；用于判断选择是否变化 */
  selectionFingerprint?: string
  duration: number
  aspect: string
  width: number
  height: number
  fps: 30
  mode: 'clean'
  renderedAt: string
}

export type Shot3DContextText = {
  prompt: boolean
  videoPrompt: boolean
  /** all 或台词行索引；索引按 dialogue 原文顺序 */
  dialogue: 'all' | number[]
  cast: boolean
  marks: boolean
  sizeMove: boolean
}

/** 3D 工作台按镜头保存的参考内容选择。 */
export type Shot3DContext = {
  version: 1
  characterIds: string[]
  designIds: string[]
  /** 手工素材卡的 URL（场景/道具/普通素材） */
  assetUrls: string[]
  imageUrls: string[]
  videoUrls: string[]
  /** 场景元数据键，例如 E01-SC02 */
  sceneKeys: string[]
  text: Shot3DContextText
  /** 选择时的台词指纹；台词变化后逐句选择需要重置 */
  dialogueHash?: string
  updatedAt?: string
}

export const SCENE_LIMITS = { walls: 24, props: 32, zones: 12, keys: 3 } as const
export const SCENE_CODE_LIMITS = {
  codeBytes: 200 * 1024,
  images: 16,
  videos: 4,
  videoFrames: 3,
  imageEdge: 2048,
  totalAssetBytes: 48 * 1024 * 1024,
  initMs: 5000,
  frameMs: 250,
  trialMs: 15000,
} as const

/** 出片与调度共用的有效时长：镜头秒数四舍五入后夹到 2~12 秒 */
export function effectiveSeconds(seconds: number | undefined): number {
  return Math.min(12, Math.max(2, Math.round(Number(seconds) || 0)))
}
