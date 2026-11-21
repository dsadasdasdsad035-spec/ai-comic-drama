/**
 * 场景三维预设户型：一次性落地一套装修好的房子。
 *
 * 为什么是程序生成的硬装面而不是导入建模：
 * 墙体、地板、天花的尺寸随户型变化，纯色长方体已经足够表达空间关系与
 * 主光方向——分镜要看的是「人在哪里、镜头朝哪、光从哪来」，墙面纹理
 * 不属于这一层。用 box 还能让用户像其它对象一样拖动、改色、删除。
 *
 * 坐标系：X 向右、Z 向屏幕外、Y 向上。房间地面在 y=0。
 * 家具 GLB 的原点统一在底面中心（已实测），所以 position.y 恒为 0。
 */

import {
  DEFAULT_TRANSFORM,
  newMaterial3dObjectId,
  type Material3dArchKind,
  type Material3dArchObject,
  type Material3dBookmark,
  type Material3dGltfObject,
  type Material3dObject,
  type Material3dScene,
} from './material3dTypes'

/** 一条内置预设户型 */
export type Material3dPreset = {
  id: string
  title: string
  /** 一句话说明：几室几厅、适合什么戏 */
  summary: string
  /** 户型尺寸（米），UI 上作为角标显示 */
  footprint: { width: number; depth: number }
  build: (now: string) => Material3dScene
}

/** 配色：现代精装的常见组合，避免纯白刺眼 */
const PALETTE = {
  wall: '#e8e4dd',
  wallAccent: '#cfd6d3',
  floorWood: '#b9895f',
  floorTile: '#d8d5d0',
  ceiling: '#f4f2ee',
  baseboard: '#efece6',
} as const

/** 办公场地配色：地毯灰 + 冷白墙 + 玻璃隔断的青灰，比住宅更中性 */
const OFFICE_PALETTE = {
  wall: '#e2e5e8',
  wallAccent: '#c8ced4',
  floorCarpet: '#5a6270',
  floorTile: '#cfd4d9',
  floorMeeting: '#4a5563',
  ceiling: '#f2f4f6',
  baseboard: '#dde1e5',
  glass: '#b8ccd4',
} as const

type ArchSpec = {
  kind: Material3dArchKind
  /** 底面中心坐标（米） */
  at: [number, number, number]
  /** 尺寸：宽、高、厚 */
  size: [number, number, number]
  color?: string
  /** 绕 Y 轴旋转（弧度）；墙体用 0 = 沿 X 走向，π/2 = 沿 Z 走向 */
  rotY?: number
  label?: string
  /** false = 登记但不渲染（天花用于此） */
  visible?: boolean
}

function arch(spec: ArchSpec): Material3dArchObject {
  const [w, h, d] = spec.size
  return {
    id: newMaterial3dObjectId(),
    kind: 'arch',
    archKind: spec.kind,
    size: { x: w, y: h, z: d },
    color: spec.color ?? PALETTE.wall,
    roughness: spec.kind === 'floor' ? 0.75 : 0.92,
    ...(spec.visible === false ? { visible: false } : {}),
    ...(spec.label ? { label: spec.label } : {}),
    transform: {
      ...DEFAULT_TRANSFORM,
      position: { x: spec.at[0], y: spec.at[1], z: spec.at[2] },
      rotation: { x: 0, y: spec.rotY ?? 0, z: 0 },
    },
  }
}

type GltfSpec = {
  /** /cc0-props/ 下的相对路径，如 furniture/sofa/sofa.glb */
  asset: string
  at: [number, number, number]
  /** 绕 Y 轴旋转（弧度），让家具朝向房间内部 */
  rotY?: number
  label: string
  scale?: number
}

function gltf(spec: GltfSpec): Material3dGltfObject {
  const s = spec.scale ?? 1
  return {
    id: newMaterial3dObjectId(),
    kind: 'gltf',
    assetUrl: `/cc0-props/${spec.asset}`,
    label: spec.label,
    transform: {
      ...DEFAULT_TRANSFORM,
      position: { x: spec.at[0], y: spec.at[1], z: spec.at[2] },
      rotation: { x: 0, y: spec.rotY ?? 0, z: 0 },
      scale: { x: s, y: s, z: s },
    },
  }
}

type CamSpec = {
  label: string
  /** 机位方位角/仰角/半径与注视点，直接对应 ArcRotateCamera */
  alpha: number
  beta: number
  radius: number
  target: [number, number, number]
}

function cam(spec: CamSpec): Material3dBookmark {
  return {
    id: `cam-preset-${Math.random().toString(36).slice(2, 9)}`,
    label: spec.label,
    alpha: spec.alpha,
    beta: spec.beta,
    radius: spec.radius,
    target: { x: spec.target[0], y: spec.target[1], z: spec.target[2] },
  }
}

/**
 * 一室一厅一卫 · 现代精装
 *
 * 平面（X 向右 7.2m，Z 向内 8.4m）：
 *
 *   z=0  ┌──────────────┬─────────────┐
 *        │              │             │
 *        │   客厅        │   卧室       │
 *        │  4.2 × 4.8   │  2.6 × 4.8  │
 *        │              │             │
 *   z=4.8├──────────────┼─────────────┤
 *        │              │             │
 *        │   餐厅/厨房   │   卫生间      │
 *        │  4.2 × 3.6   │  2.6 × 3.6  │
 *        │              │             │
 *   z=8.4└──────────────┴─────────────┘
 *       x=0            x=4.2          x=6.8
 *
 * 卫生间在右下角单独开门，卧室与客餐厅之间留门洞。
 */
function buildOneBedroomApartment(now: string): Material3dScene {
  const W = 6.8
  const D = 8.4
  const H = 2.7
  const T = 0.12
  const splitX = 4.2
  const splitZ = 4.8

  const objects: Material3dObject[] = [
    // ---------------- 硬装：地面与天花 ----------------
    // 客厅木地板
    arch({ kind: 'floor', at: [splitX / 2, -0.02, splitZ / 2], size: [splitX, 0.04, splitZ], color: PALETTE.floorWood, label: '客厅木地板' }),
    // 餐厅厨房浅色砖
    arch({ kind: 'floor', at: [splitX / 2, -0.02, splitZ + (D - splitZ) / 2], size: [splitX, 0.04, D - splitZ], color: PALETTE.floorTile, label: '餐厨地砖' }),
    // 卧室木地板
    arch({ kind: 'floor', at: [splitX + (W - splitX) / 2, -0.02, splitZ / 2], size: [W - splitX, 0.04, splitZ], color: '#c19a76', label: '卧室木地板' }),
    // 卫生间地砖
    arch({ kind: 'floor', at: [splitX + (W - splitX) / 2, -0.02, splitZ + (D - splitZ) / 2], size: [W - splitX, 0.04, D - splitZ], color: '#cdd3d4', label: '卫生间地砖' }),
    // 天花
    arch({ kind: 'ceiling', at: [W / 2, H, D / 2], size: [W, 0.06, D], color: PALETTE.ceiling, label: '天花', visible: false }),

    // ---------------- 硬装：外墙 ----------------
    arch({ kind: 'wall', at: [W / 2, H / 2, 0], size: [W + T, H, T], label: '北墙' }),
    arch({ kind: 'wall', at: [W / 2, H / 2, D], size: [W + T, H, T], label: '南墙' }),
    arch({ kind: 'wall', at: [0, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, label: '西墙' }),
    arch({ kind: 'wall', at: [W, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, label: '东墙' }),

    // ---------------- 硬装：内隔墙 ----------------
    // 客厅/卧室 分隔墙（留 1.0m 门洞，洞在 z=3.9..4.9）
    arch({ kind: 'wall', at: [splitX, H / 2, 1.95], size: [splitZ / 2 - 0.5, H, T], rotY: Math.PI / 2, label: '卧室隔墙·北段' }),
    arch({ kind: 'wall', at: [splitX, H / 2, splitZ], size: [splitZ / 2 - 0.1, H, T], rotY: Math.PI / 2, label: '卧室隔墙·南段' }),
    // 客餐厅之间的过梁：只占天花下沿一条，不挡室内视线
    arch({ kind: 'wall', at: [splitX / 2, H - 0.18, splitZ], size: [splitX, 0.36, T], label: '客厅过梁' }),
    // 卫生间墙：横墙留 0.8m 门洞（x=4.6..5.4），竖墙贯通
    arch({ kind: 'wall', at: [splitX + 0.2, H / 2, splitZ], size: [0.4, H, T], label: '卫生间墙·左段' }),
    arch({ kind: 'wall', at: [splitX + (W - splitX) / 2 + 0.7, H / 2, splitZ], size: [W - splitX - 1.4, H, T], label: '卫生间墙·右段' }),
    arch({ kind: 'wall', at: [splitX, H / 2, splitZ + (D - splitZ) / 2], size: [D - splitZ, H, T], rotY: Math.PI / 2, label: '卫生间墙·竖段' }),

    // ---------------- 硬装：踢脚线 ----------------
    arch({ kind: 'baseboard', at: [splitX / 2, 0.05, 0.07], size: [splitX, 0.1, 0.02], color: PALETTE.baseboard, label: '客厅踢脚线' }),
    arch({ kind: 'baseboard', at: [splitX + (W - splitX) / 2, 0.05, 0.07], size: [W - splitX, 0.1, 0.02], color: PALETTE.baseboard, label: '卧室踢脚线' }),

    // ---------------- 客厅 ----------------
    gltf({ asset: 'furniture/rug/rug.glb', at: [1.9, 0, 2.3], label: '客厅地毯' }),
    gltf({ asset: 'furniture/sofa/sofa.glb', at: [1.9, 0, 3.35], rotY: Math.PI, label: '三人沙发' }),
    gltf({ asset: 'furniture/coffee-table/coffee-table.glb', at: [1.9, 0, 2.15], label: '咖啡桌' }),
    gltf({ asset: 'furniture/armchair/armchair.glb', at: [3.3, 0, 2.2], rotY: -Math.PI / 2, label: '休闲扶手椅' }),
    gltf({ asset: 'furniture/pouf/pouf.glb', at: [0.7, 0, 1.75], label: '针织坐墩' }),
    gltf({ asset: 'furniture/tv-stand/tv-stand.glb', at: [1.9, 0, 0.45], label: '电视柜' }),
    gltf({ asset: 'furniture/shelf-unit/shelf-unit-light.glb', at: [3.75, 0, 0.5], rotY: Math.PI, label: '置物架' }),
    gltf({ asset: 'furniture/floor-lamp/floor-lamp.glb', at: [3.45, 0, 3.2], label: '落地灯' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [0.55, 0, 0.6], label: '龟背竹' }),
    gltf({ asset: 'furniture/side-table/side-table.glb', at: [3.45, 0, 2.6], label: '边桌' }),
    gltf({ asset: 'furniture/cushion/cushion.glb', at: [1.9, 0.62, 3.1], label: '沙发抱枕' }),
    gltf({ asset: 'furniture/wall-art/wall-art.glb', at: [1.9, 1.55, 0.09], label: '客厅装饰画' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [1.9, 2.15, 2.3], label: '客厅吸顶灯' }),

    // ---------------- 餐厅 / 厨房 ----------------
    gltf({ asset: 'furniture/dining-table/dining-table.glb', at: [1.85, 0, 6.25], label: '餐桌' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [1.15, 0, 6.25], rotY: Math.PI / 2, label: '餐椅·左' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [2.55, 0, 6.25], rotY: -Math.PI / 2, label: '餐椅·右' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [1.85, 0, 5.55], label: '餐椅·上' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [1.85, 0, 6.95], rotY: Math.PI, label: '餐椅·下' }),
    gltf({ asset: 'furniture/kitchen-island/kitchen-island-light.glb', at: [1.5, 0, 7.7], label: '厨房中岛' }),
    gltf({ asset: 'furniture/refrigerator/refrigerator.glb', at: [3.6, 0, 7.75], rotY: Math.PI, label: '冰箱' }),
    gltf({ asset: 'furniture/kitchen-cabinet/kitchen-cabinet.glb', at: [0.55, 0, 7.9], rotY: Math.PI / 2, label: '橱柜' }),
    gltf({ asset: 'furniture/trash-can/trash-can.glb', at: [3.85, 0, 5.3], label: '垃圾桶' }),
    gltf({ asset: 'furniture/snake-plant/snake-plant.glb', at: [0.35, 0, 5.15], label: '虎尾兰' }),

    // ---------------- 卧室 ----------------
    gltf({ asset: 'furniture/bed/bed.glb', at: [5.5, 0, 2.3], label: '双人床' }),
    gltf({ asset: 'furniture/nightstand/nightstand.glb', at: [4.5, 0, 1.5], label: '床头柜·左' }),
    gltf({ asset: 'furniture/nightstand/nightstand.glb', at: [6.5, 0, 1.5], label: '床头柜·右' }),
    gltf({ asset: 'furniture/table-lamp/table-lamp.glb', at: [4.5, 0.56, 1.5], label: '床头台灯' }),
    gltf({ asset: 'furniture/wardrobe/wardrobe-light.glb', at: [6.35, 0, 3.9], rotY: -Math.PI / 2, label: '衣柜' }),
    gltf({ asset: 'furniture/full-length-mirror/full-length-mirror.glb', at: [4.45, 0, 3.6], rotY: Math.PI / 2, label: '全身镜' }),
    gltf({ asset: 'furniture/curtains/curtains-light.glb', at: [5.5, 1.4, 4.05], label: '卧室窗帘' }),
    gltf({ asset: 'furniture/picture-frame/picture-frame.glb', at: [5.5, 1.6, 0.1], label: '床头挂画' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.5, 2.15, 2.3], label: '卧室吸顶灯' }),

    // ---------------- 卫生间 ----------------
    gltf({ asset: 'furniture/toilet/toilet.glb', at: [6.3, 0, 5.5], rotY: Math.PI, label: '马桶' }),
    gltf({ asset: 'furniture/bathroom-sink/bathroom-sink.glb', at: [4.75, 0, 5.5], rotY: Math.PI, label: '洗手台' }),
    gltf({ asset: 'furniture/shower-cabin/shower-cabin.glb', at: [5.5, 0, 7.75], label: '淋浴房' }),
    gltf({ asset: 'furniture/bathroom-mirror/bathroom-mirror.glb', at: [4.75, 1.5, 5.15], label: '浴室镜' }),
    gltf({ asset: 'furniture/towel-rack/towel-rack.glb', at: [6.65, 1.2, 6.5], rotY: -Math.PI / 2, label: '毛巾架' }),
    gltf({ asset: 'furniture/succulent/succulent.glb', at: [4.75, 0.85, 5.5], label: '多肉' }),
  ]

  /**
   * ArcRotateCamera 公式：cam = target + r·(cos α·sin β, cos β, sin α·sin β)。
   * α = π/2 把机位放在目标的 +Z 侧，α = -π/2 放在 -Z 侧，α = π 放在 -X 侧。
   * β 越小越接近正俯视（0 = 正上方，π/2 = 水平）。
   * 下面每个机位的坐标都是按这个公式算过的，别再凭感觉调。
   */
  const cameras: Material3dBookmark[] = [
    // 客厅：站在客厅南端内侧（z≈4.5、人眼高 1.5m），看向沙发与电视墙
    cam({ label: '客厅全景', alpha: Math.PI / 2, beta: 1.25, radius: 2.0, target: [1.9, 0.9, 2.6] }),
    // 沙发正面：站在北墙前（z≈1.3），平视沙发
    cam({ label: '沙发正面', alpha: -Math.PI / 2, beta: 1.3, radius: 2.0, target: [1.9, 0.7, 3.2] }),
    // 餐厨：站在餐区北端（z≈4.4、略抬高 1.8m），能同时看到餐桌与中岛
    cam({ label: '餐厨视角', alpha: -Math.PI / 2, beta: 1.16, radius: 2.4, target: [1.9, 0.9, 6.6] }),
    // 卧室：站在床南侧（z≈3.9），看向床头与挂画
    cam({ label: '卧室全景', alpha: Math.PI / 2, beta: 1.22, radius: 2.0, target: [5.5, 0.8, 2.0] }),
    // 户型俯视：正上方略偏南，四个分区都在画面里
    cam({ label: '户型俯视', alpha: Math.PI / 2, beta: 0.34, radius: 12, target: [3.4, 0, 4.0] }),
  ]

  return {
    id: `m3d-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '一室一厅一卫 · 现代精装',
    designRefs: [],
    objects,
    cameras,
    environment: {
      background: '#0e1216',
      ground: { size: 30, color: '#1b2026', visible: false },
      light: { ambient: 1.15, directional: 0.5 },
    },
    updatedAt: now,
  }
}

/**
 * 办公场地 · 现代开放式
 *
 * 平面（X 向右 10m，Z 向内 9m）：
 *
 *   z=0  ┌───────────────────────┬──────────────┐
 *        │                       │              │
 *        │   开放办公区           │   会议室      │
 *        │   6.6 × 9.0           │  3.4 × 4.6   │
 *        │   5 组工位 + 协作桌     │  6 人会议桌   │
 *        │                       │              │
 *   z=4.6│                       ├──────────────┤
 *        │                       │   茶水间      │
 *        │                       │  3.4 × 4.4   │
 *   z=9.0└───────────────────────┴──────────────┘
 *       x=0                    x=6.6          x=10
 *
 * 入口在南墙左侧：前台与等候沙发就在门口，开放办公区在北侧，
 * 会议室靠东窗，茶水间在右下。
 */
function buildOfficeStudio(now: string): Material3dScene {
  const W = 10
  const D = 9
  const H = 3
  const T = 0.12
  const splitX = 6.6
  const meetZ = 4.6

  const objects: Material3dObject[] = [
    // ---------------- 硬装：地面与天花 ----------------
    arch({ kind: 'floor', at: [splitX / 2, -0.02, D / 2], size: [splitX, 0.04, D], color: OFFICE_PALETTE.floorCarpet, label: '办公区地毯' }),
    arch({ kind: 'floor', at: [splitX + (W - splitX) / 2, -0.02, meetZ / 2], size: [W - splitX, 0.04, meetZ], color: OFFICE_PALETTE.floorMeeting, label: '会议室地毯' }),
    arch({ kind: 'floor', at: [splitX + (W - splitX) / 2, -0.02, meetZ + (D - meetZ) / 2], size: [W - splitX, 0.04, D - meetZ], color: OFFICE_PALETTE.floorTile, label: '茶水间地砖' }),
    arch({ kind: 'ceiling', at: [W / 2, H, D / 2], size: [W, 0.06, D], color: OFFICE_PALETTE.ceiling, label: '天花', visible: false }),

    // ---------------- 硬装：外墙 ----------------
    arch({ kind: 'wall', at: [W / 2, H / 2, 0], size: [W + T, H, T], color: OFFICE_PALETTE.wall, label: '北墙' }),
    arch({ kind: 'wall', at: [W / 2, H / 2, D], size: [W + T, H, T], color: OFFICE_PALETTE.wall, label: '南墙·入口面' }),
    arch({ kind: 'wall', at: [0, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: OFFICE_PALETTE.wall, label: '西墙' }),
    arch({ kind: 'wall', at: [W, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: OFFICE_PALETTE.wall, label: '东墙' }),

    // ---------------- 硬装：内隔断 ----------------
    // 办公区 / 会议室之间的玻璃隔断，留 1.0m 门洞（z=1.6..2.6）
    arch({ kind: 'wall', at: [splitX, H / 2, 0.8], size: [1.6, H, T], rotY: Math.PI / 2, color: OFFICE_PALETTE.glass, label: '会议隔断·北段' }),
    arch({ kind: 'wall', at: [splitX, H / 2, 3.6], size: [2.0, H, T], rotY: Math.PI / 2, color: OFFICE_PALETTE.glass, label: '会议隔断·南段' }),
    // 会议室 / 茶水间横墙，留 0.9m 门洞（x=7.55..8.45）
    arch({ kind: 'wall', at: [splitX + 0.475, H / 2, meetZ], size: [0.95, H, T], color: OFFICE_PALETTE.wallAccent, label: '茶水间墙·左段' }),
    arch({ kind: 'wall', at: [W - 0.775, H / 2, meetZ], size: [1.55, H, T], color: OFFICE_PALETTE.wallAccent, label: '茶水间墙·右段' }),
    arch({ kind: 'baseboard', at: [splitX / 2, 0.05, 0.07], size: [splitX, 0.1, 0.02], color: OFFICE_PALETTE.baseboard, label: '办公区踢脚线' }),

    // ---------------- 开放办公区：工位 ----------------
    // 两排 × 两列工位（桌 1.6 × 1.02，椅子在桌子南侧朝北）+ 一张站立桌
    gltf({ asset: 'furniture/office-desk/office-desk.glb', at: [1.7, 0, 2.2], label: '工位桌 1' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [1.7, 0, 3.1], rotY: Math.PI, label: '办公椅 1' }),
    gltf({ asset: 'furniture/office-desk/office-desk.glb', at: [4.9, 0, 2.2], label: '工位桌 2' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [4.9, 0, 3.1], rotY: Math.PI, label: '办公椅 2' }),
    gltf({ asset: 'furniture/office-desk/office-desk.glb', at: [1.7, 0, 4.8], label: '工位桌 3' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [1.7, 0, 5.7], rotY: Math.PI, label: '办公椅 3' }),
    gltf({ asset: 'furniture/office-desk/office-desk.glb', at: [4.9, 0, 4.8], label: '工位桌 4' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [4.9, 0, 5.7], rotY: Math.PI, label: '办公椅 4' }),
    gltf({ asset: 'furniture/standing-desk/standing-desk.glb', at: [1.7, 0, 7.2], label: '站立办公桌' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [1.7, 0, 8.0], rotY: Math.PI, label: '办公椅 5' }),
    // 工位之间的矮隔断（1.60 × 1.40 × 0.45，比桌面高一截但不挡全景视线）：
    // 放在左右两组桌的空档（桌1 右缘 2.5、桌2 左缘 4.1），转 90° 后 x 向 0.45
    // 收纳靠西墙：文件柜 0.47 × 0.91（转 90° 后 x 向 0.47），贴 x=0.3 不穿墙
    gltf({ asset: 'furniture/filing-cabinet/filing-cabinet.glb', at: [0.3, 0, 1.2], rotY: Math.PI / 2, label: '文件柜 A' }),
    gltf({ asset: 'furniture/filing-cabinet/filing-cabinet.glb', at: [0.3, 0, 2.3], rotY: Math.PI / 2, label: '文件柜 B' }),
    gltf({ asset: 'furniture/school-locker/school-locker.glb', at: [0.3, 0, 6.2], rotY: Math.PI / 2, label: '员工储物柜' }),
    gltf({ asset: 'furniture/notice-board/notice-board.glb', at: [0.2, 0, 4.2], rotY: Math.PI / 2, label: '公告板' }),
    // 书架贴玻璃隔断内侧（0.31 进深，x=6.3 不穿）
    gltf({ asset: 'furniture/bookshelf/bookshelf.glb', at: [6.3, 0, 3.3], rotY: -Math.PI / 2, label: '办公区书架' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [3.2, 0, 0.7], label: '办公区绿植' }),
    gltf({ asset: 'furniture/snake-plant/snake-plant.glb', at: [6.0, 0, 0.6], label: '窗台植物' }),
    gltf({ asset: 'furniture/trash-can/trash-can.glb', at: [2.6, 0, 4.0], label: '垃圾桶' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [1.8, 2.35, 2.4], label: '办公区灯 A' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [1.8, 2.35, 6.0], label: '办公区灯 B' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.0, 2.35, 2.4], label: '办公区灯 C' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.0, 2.35, 6.0], label: '办公区灯 D' }),

    // ---------------- 会议室（6.6..10 × 0..4.6） ----------------
    // 会议桌 2.4(x) × 1.1(z)，中心 (8.3, 2.2)；椅子两侧各三把
    gltf({ asset: 'furniture/meeting-table/meeting-table.glb', at: [8.3, 0, 2.2], label: '会议桌' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [7.5, 0, 1.05], label: '会议椅 1' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [8.3, 0, 1.05], label: '会议椅 2' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [9.1, 0, 1.05], label: '会议椅 3' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [7.5, 0, 3.35], rotY: Math.PI, label: '会议椅 4' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [8.3, 0, 3.35], rotY: Math.PI, label: '会议椅 5' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [9.1, 0, 3.35], rotY: Math.PI, label: '会议椅 6' }),
    gltf({ asset: 'furniture/whiteboard/whiteboard.glb', at: [8.3, 0, 0.4], label: '白板' }),
    gltf({ asset: 'furniture/projector/projector.glb', at: [8.3, 2.78, 2.2], label: '投影仪' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [8.3, 2.6, 2.2], label: '会议室灯' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [9.5, 0, 4.1], label: '会议室绿植' }),

    // ---------------- 茶水间（6.6..10 × 4.6..9） ----------------
    gltf({ asset: 'furniture/kitchen-island/kitchen-island-light.glb', at: [8.1, 0, 6.6], label: '茶水吧台' }),
    gltf({ asset: 'furniture/coffee-machine/coffee-machine.glb', at: [7.3, 0.94, 6.5], label: '咖啡机' }),
    gltf({ asset: 'furniture/water-cooler/water-cooler.glb', at: [9.6, 0, 5.2], rotY: -Math.PI / 2, label: '饮水机' }),
    gltf({ asset: 'furniture/bar-stool/bar-stool.glb', at: [8.0, 0, 7.4], rotY: Math.PI, label: '吧凳 A' }),
    gltf({ asset: 'furniture/bar-stool/bar-stool.glb', at: [8.5, 0, 7.4], rotY: Math.PI, label: '吧凳 B' }),
    // 微波炉摆在茶水吧台台面上（吧台高 1.12，台面 y≈0.94 是模型自身原点）
    gltf({ asset: 'furniture/microwave/microwave.glb', at: [8.75, 0.94, 6.6], label: '微波炉' }),
    gltf({ asset: 'furniture/trash-can/trash-can.glb', at: [7.0, 0, 8.5], label: '茶水间垃圾桶' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [8.3, 2.6, 6.8], label: '茶水间灯' }),

    // ---------------- 入口 / 接待（南墙左侧） ----------------
    gltf({ asset: 'furniture/bar-counter/bar-counter-light.glb', at: [1.4, 0, 8.5], rotY: Math.PI, label: '前台' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [1.4, 0, 7.8], rotY: Math.PI, label: '前台椅' }),
    gltf({ asset: 'furniture/rug/rug.glb', at: [4.0, 0, 7.9], label: '接待区地毯' }),
    gltf({ asset: 'furniture/sofa/sofa.glb', at: [4.0, 0, 8.4], rotY: Math.PI, label: '等候沙发' }),
    gltf({ asset: 'furniture/coffee-table/coffee-table.glb', at: [4.0, 0, 7.5], label: '等候茶几' }),
    gltf({ asset: 'furniture/houseplant-set/houseplant-set.glb', at: [6.0, 0, 8.5], label: '入口绿植' }),
    gltf({ asset: 'furniture/coat-rack/coat-rack.glb', at: [0.5, 0, 8.4], rotY: Math.PI / 2, label: '衣帽架' }),
    gltf({ asset: 'furniture/wall-art/wall-art.glb', at: [4.0, 1.75, 8.92], rotY: Math.PI, label: '接待区装饰画' }),
    gltf({ asset: 'furniture/wall-clock/wall-clock.glb', at: [1.4, 2.1, 8.92], rotY: Math.PI, label: '前台挂钟' }),
  ]

  /**
   * 机位（ArcRotateCamera）：cam = target + r·(cos α·sin β, cos β, sin α·sin β)
   * 办公区中间全是工位，正对着放机位一定被挡；全部改成站在房间一角、
   * 抬高到 2.5~3.2m 斜看，既避开遮挡又能看到空间纵深。
   */
  const cameras: Material3dBookmark[] = [
    // 办公区全景：东南角上方 3.2m 俯瞰整片工位
    cam({ label: '办公区全景', alpha: (55 * Math.PI) / 180, beta: 1.16, radius: 5.6, target: [2.5, 1.0, 3.5] }),
    // 工位特写：从东南侧 1.6m 高贴近第一排，看桌面与椅背
    cam({ label: '工位特写', alpha: (70 * Math.PI) / 180, beta: 1.28, radius: 2.4, target: [1.7, 0.9, 2.2] }),
    // 会议室：从东南角斜看长桌与白板
    cam({ label: '会议室', alpha: (60 * Math.PI) / 180, beta: 1.26, radius: 2.0, target: [8.3, 0.9, 2.2] }),
    // 接待前台：西北角上方 2.2m 斜看前台、等候沙发与装饰画
    cam({ label: '接待前台', alpha: (-140 * Math.PI) / 180, beta: 1.2, radius: 3.4, target: [3.2, 1.0, 8.0] }),
    // 整层俯视
    cam({ label: '场地俯视', alpha: Math.PI / 2, beta: 0.52, radius: 15, target: [5, 0, 4.5] }),
  ]

  return {
    id: `m3d-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '办公场地 · 现代开放式',
    designRefs: [],
    objects,
    cameras,
    environment: {
      background: '#11151a',
      ground: { size: 40, color: '#1b2026', visible: false },
      // 办公照明更均匀：环境光高、主光弱，避免长投影
      light: { ambient: 1.35, directional: 0.38 },
    },
    updatedAt: now,
  }
}

/**
 * 两居室 · 现代精装
 *
 * 平面（X 向右 8.4m，Z 向内 9.6m）：
 *
 *   z=0  ┌───────────────┬────────────┬────────────┐
 *        │               │            │            │
 *        │   客厅         │   主卧      │   次卧      │
 *        │  4.2 × 5.2    │  2.4 × 5.2 │  1.8 × 5.2 │
 *        │               │            │            │
 *   z=5.2├───────────────┴────────────┴────────────┤
 *        │                                          │
 *        │   餐厅 4.2 × 4.4      卫生间 2.4 × 4.4  │
 *        │                                          │
 *   z=9.6└──────────────────────────────────────────┘
 *       x=0            x=4.2       x=6.6        x=8.4
 *
 * 客厅吃北向采光；两间卧室并排，次卧做儿童房/书房（床更小）；
 * 餐厅与卫生间在南侧，进门左手是餐厅。
 */
function buildTwoBedroomApartment(now: string): Material3dScene {
  const W = 8.4
  const D = 9.6
  const H = 2.7
  const T = 0.12
  const splitZ = 5.2
  const bed1X = 4.2
  const bed2X = 6.6

  const objects: Material3dObject[] = [
    // ---------------- 硬装：地面与天花 ----------------
    arch({ kind: 'floor', at: [2.1, -0.02, 2.6], size: [4.2, 0.04, 5.2], color: PALETTE.floorWood, label: '客厅木地板' }),
    arch({ kind: 'floor', at: [5.4, -0.02, 2.6], size: [2.4, 0.04, 5.2], color: PALETTE.floorWood, label: '主卧木地板' }),
    arch({ kind: 'floor', at: [7.5, -0.02, 2.6], size: [1.8, 0.04, 5.2], color: '#c8a882', label: '次卧木地板' }),
    arch({ kind: 'floor', at: [2.1, -0.02, splitZ + 2.2], size: [4.2, 0.04, 4.4], color: PALETTE.floorTile, label: '餐厅地砖' }),
    arch({ kind: 'floor', at: [6.75, -0.02, splitZ + 2.2], size: [3.3, 0.04, 4.4], color: '#d3d8d9', label: '卫浴地砖' }),
    arch({ kind: 'ceiling', at: [W / 2, H, D / 2], size: [W, 0.06, D], color: PALETTE.ceiling, label: '天花', visible: false }),

    // ---------------- 硬装：外墙 ----------------
    arch({ kind: 'wall', at: [W / 2, H / 2, 0], size: [W + T, H, T], label: '北墙' }),
    arch({ kind: 'wall', at: [W / 2, H / 2, D], size: [W + T, H, T], label: '南墙' }),
    arch({ kind: 'wall', at: [0, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, label: '西墙' }),
    arch({ kind: 'wall', at: [W, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, label: '东墙' }),

    // ---------------- 硬装：内隔墙 ----------------
    // 客厅 / 主卧（留 0.9m 门洞，z=4.0..4.9）
    arch({ kind: 'wall', at: [bed1X, H / 2, 2.0], size: [4.0, H, T], rotY: Math.PI / 2, label: '主卧隔墙·北段' }),
    arch({ kind: 'wall', at: [bed1X, H / 2, 5.05], size: [0.3, H, T], rotY: Math.PI / 2, label: '主卧隔墙·南段' }),
    // 主卧 / 次卧（留 0.8m 门洞，z=4.0..4.8）
    arch({ kind: 'wall', at: [bed2X, H / 2, 2.0], size: [4.0, H, T], rotY: Math.PI / 2, label: '次卧隔墙·北段' }),
    arch({ kind: 'wall', at: [bed2X, H / 2, 5.0], size: [0.4, H, T], rotY: Math.PI / 2, label: '次卧隔墙·南段' }),
    // 客卧区 / 南半区横墙（餐厅侧留 1.2m 门洞 x=2.4..3.6）
    arch({ kind: 'wall', at: [1.2, H / 2, splitZ], size: [2.4, H, T], label: '南北分隔·西段' }),
    arch({ kind: 'wall', at: [5.4, H / 2, splitZ], size: [3.6, H, T], label: '南北分隔·中段' }),
    arch({ kind: 'wall', at: [7.5, H / 2, splitZ], size: [1.8, H, T], label: '南北分隔·东段' }),
    // 餐厅 / 卫生间（留 0.8m 门洞，x=5.0..5.8）
    arch({ kind: 'wall', at: [4.6, H / 2, splitZ + 2.2], size: [2.0, H, T], rotY: Math.PI / 2, label: '卫生间隔墙·北段' }),
    arch({ kind: 'wall', at: [4.6, H / 2, splitZ + 3.9], size: [1.4, H, T], rotY: Math.PI / 2, label: '卫生间隔墙·南段' }),

    // ---------------- 硬装：踢脚线 ----------------
    arch({ kind: 'baseboard', at: [2.1, 0.05, 0.07], size: [4.2, 0.1, 0.02], color: PALETTE.baseboard, label: '客厅踢脚线' }),
    arch({ kind: 'baseboard', at: [5.4, 0.05, 0.07], size: [2.4, 0.1, 0.02], color: PALETTE.baseboard, label: '主卧踢脚线' }),

    // ---------------- 客厅 ----------------
    gltf({ asset: 'furniture/rug/rug.glb', at: [2.1, 0, 2.6], label: '客厅地毯' }),
    gltf({ asset: 'furniture/sofa/sofa.glb', at: [2.1, 0, 3.9], rotY: Math.PI, label: '三人沙发' }),
    gltf({ asset: 'furniture/coffee-table/coffee-table.glb', at: [2.1, 0, 2.55], label: '咖啡桌' }),
    gltf({ asset: 'furniture/armchair/armchair.glb', at: [3.5, 0, 2.4], rotY: -Math.PI / 2, label: '单人扶手椅' }),
    gltf({ asset: 'furniture/tv-stand/tv-stand.glb', at: [2.1, 0, 0.45], label: '电视柜' }),
    gltf({ asset: 'furniture/shelf-unit/shelf-unit-light.glb', at: [3.85, 0, 0.5], rotY: Math.PI, label: '置物架' }),
    gltf({ asset: 'furniture/floor-lamp/floor-lamp.glb', at: [3.6, 0, 3.7], label: '落地灯' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [0.6, 0, 0.7], label: '龟背竹' }),
    gltf({ asset: 'furniture/cushion/cushion.glb', at: [2.1, 0.62, 3.65], label: '沙发抱枕' }),
    gltf({ asset: 'furniture/wall-art/wall-art.glb', at: [2.1, 1.6, 0.09], rotY: 0, label: '客厅装饰画' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.1, 2.15, 2.6], label: '客厅吸顶灯' }),

    // ---------------- 餐厅（4.2 × 4.4，南半区西侧） ----------------
    gltf({ asset: 'furniture/dining-table/dining-table.glb', at: [2.1, 0, 7.3], label: '餐桌' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [1.4, 0, 7.3], rotY: Math.PI / 2, label: '餐椅·左' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [2.8, 0, 7.3], rotY: -Math.PI / 2, label: '餐椅·右' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [2.1, 0, 6.6], label: '餐椅·上' }),
    gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [2.1, 0, 8.0], rotY: Math.PI, label: '餐椅·下' }),
    gltf({ asset: 'furniture/table-setting/table-setting.glb', at: [2.1, 0.76, 7.3], label: '餐桌摆设' }),
    gltf({ asset: 'furniture/kitchen-island/kitchen-island-light.glb', at: [2.1, 0, 9.0], label: '餐边岛台' }),
    gltf({ asset: 'furniture/refrigerator/refrigerator.glb', at: [0.55, 0, 8.9], rotY: Math.PI / 2, label: '冰箱' }),
    gltf({ asset: 'furniture/kitchen-cabinet/kitchen-cabinet.glb', at: [3.9, 0, 9.15], rotY: Math.PI, label: '餐边柜' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.1, 2.15, 7.3], label: '餐厅吊灯' }),

    // ---------------- 主卧（2.4 × 5.2） ----------------
    gltf({ asset: 'furniture/bed/bed.glb', at: [5.4, 0, 2.5], label: '双人床' }),
    gltf({ asset: 'furniture/nightstand/nightstand.glb', at: [4.55, 0, 1.6], label: '床头柜·左' }),
    gltf({ asset: 'furniture/nightstand/nightstand.glb', at: [6.25, 0, 1.6], label: '床头柜·右' }),
    gltf({ asset: 'furniture/table-lamp/table-lamp.glb', at: [4.55, 0.56, 1.6], label: '床头台灯' }),
    gltf({ asset: 'furniture/wardrobe/wardrobe-light.glb', at: [6.3, 0, 4.4], rotY: -Math.PI / 2, label: '主卧衣柜' }),
    gltf({ asset: 'furniture/curtains/curtains-light.glb', at: [5.4, 1.45, 0.12], label: '主卧窗帘' }),
    gltf({ asset: 'furniture/picture-frame/picture-frame.glb', at: [5.4, 1.65, 0.1], label: '床头挂画' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.4, 2.15, 2.5], label: '主卧吸顶灯' }),

    // ---------------- 次卧 / 儿童房（1.8 × 5.2） ----------------
    gltf({ asset: 'furniture/single-bed/single-bed-light.glb', at: [7.5, 0, 2.2], label: '单人床' }),
    gltf({ asset: 'furniture/nightstand/nightstand.glb', at: [6.85, 0, 1.4], label: '次卧床头柜' }),
    gltf({ asset: 'furniture/table-lamp/table-lamp.glb', at: [6.85, 0.56, 1.4], label: '次卧台灯' }),
    gltf({ asset: 'furniture/office-desk/office-desk.glb', at: [7.5, 0, 4.3], rotY: Math.PI, label: '次卧书桌' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [7.5, 0, 3.7], label: '次卧书桌椅' }),
    gltf({ asset: 'furniture/bookshelf/bookshelf.glb', at: [8.2, 0, 2.9], rotY: -Math.PI / 2, label: '次卧书架' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [7.5, 2.15, 2.6], label: '次卧吸顶灯' }),

    // ---------------- 卫生间（3.3 × 4.4，南半区东侧） ----------------
    gltf({ asset: 'furniture/toilet/toilet.glb', at: [6.4, 0, 6.1], rotY: Math.PI, label: '马桶' }),
    gltf({ asset: 'furniture/bathroom-sink/bathroom-sink.glb', at: [7.6, 0, 6.1], rotY: Math.PI, label: '洗手台' }),
    gltf({ asset: 'furniture/shower-cabin/shower-cabin.glb', at: [7.6, 0, 8.5], label: '淋浴房' }),
    gltf({ asset: 'furniture/bathroom-mirror/bathroom-mirror.glb', at: [7.6, 1.5, 5.75], label: '浴室镜' }),
    gltf({ asset: 'furniture/towel-rack/towel-rack.glb', at: [8.25, 1.2, 7.2], rotY: -Math.PI / 2, label: '毛巾架' }),
    gltf({ asset: 'furniture/washing-machine/washing-machine.glb', at: [5.15, 0, 9.1], rotY: Math.PI, label: '洗衣机' }),
    gltf({ asset: 'furniture/succulent/succulent.glb', at: [7.6, 0.85, 6.1], label: '多肉' }),
  ]

  const cameras: Material3dBookmark[] = [
    // 客厅：从南端（z≈5.0）往北看沙发与电视墙
    cam({ label: '客厅全景', alpha: Math.PI / 2, beta: 1.24, radius: 2.2, target: [2.1, 0.85, 2.5] }),
    // 餐厅：从北侧（z≈5.6）看向餐桌
    cam({ label: '餐厅视角', alpha: -Math.PI / 2, beta: 1.24, radius: 2.2, target: [2.1, 0.85, 7.3] }),
    // 主卧：从床南侧（z≈4.6）看向床头
    cam({ label: '主卧全景', alpha: Math.PI / 2, beta: 1.24, radius: 2.2, target: [5.4, 0.85, 1.9] }),
    // 次卧：从南侧（z≈4.8）看向床与书桌
    cam({ label: '次卧全景', alpha: Math.PI / 2, beta: 1.24, radius: 2.0, target: [7.5, 0.85, 2.3] }),
    // 整户俯视
    cam({ label: '户型俯视', alpha: Math.PI / 2, beta: 0.38, radius: 14, target: [4.2, 0, 4.8] }),
  ]

  return {
    id: `m3d-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '两居室 · 现代精装',
    designRefs: [],
    objects,
    cameras,
    environment: {
      background: '#0e1216',
      ground: { size: 34, color: '#1b2026', visible: false },
      light: { ambient: 1.15, directional: 0.5 },
    },
    updatedAt: now,
  }
}

/**
 * 餐厅 · 现代简约
 *
 * 平面（X 向右 12m，Z 向内 10m）：
 *
 *   z=0  ┌──────────────────────────────────────┐
 *        │              吧台 / 开放厨房          │
 *        ├───────────────┬──────────────────────┤
 *        │               │                      │
 *        │   卡座区       │    散座区            │
 *        │  4.4 × 7.0    │   7.6 × 7.0         │
 *        │               │    8 张四人桌         │
 *        │               │                      │
 *   z=10 └───────────────┴──────────────────────┘
 *       x=0            x=4.4                  x=12
 *
 * 进门在南侧中间，先看到整片散座区；左侧卡座靠墙更私密，
 * 北侧沿吧台是开放式厨房，收银与菜单板在入口右手。
 */
function buildRestaurant(now: string): Material3dScene {
  const W = 12
  const D = 10
  const H = 3.2
  const T = 0.12
  const boothX = 4.4
  const barZ = 2.2

  const FLOOR_A = '#a8836a'
  const FLOOR_B = '#c9b49f'
  const WALL = '#e6dfd4'

  const objects: Material3dObject[] = [
    // ---------------- 硬装 ----------------
    arch({ kind: 'floor', at: [W / 2, -0.02, (barZ + D) / 2], size: [W, 0.04, D - barZ], color: FLOOR_A, label: '餐厅木地板' }),
    arch({ kind: 'floor', at: [W / 2, -0.02, barZ / 2], size: [W, 0.04, barZ], color: FLOOR_B, label: '厨房地砖' }),
    arch({ kind: 'ceiling', at: [W / 2, H, D / 2], size: [W, 0.06, D], color: '#f4f1ec', label: '天花', visible: false }),
    arch({ kind: 'wall', at: [W / 2, H / 2, 0], size: [W + T, H, T], color: WALL, label: '北墙' }),
    arch({ kind: 'wall', at: [W / 2, H / 2, D], size: [W + T, H, T], color: WALL, label: '南墙·入口面' }),
    arch({ kind: 'wall', at: [0, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: WALL, label: '西墙' }),
    arch({ kind: 'wall', at: [W, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: WALL, label: '东墙' }),
    // 厨房与餐区之间的矮隔断（吧台背墙，留两侧通道）
    arch({ kind: 'wall', at: [W / 2, 0.55, barZ], size: [W - 3.0, 1.1, T], color: '#d8cfc2', label: '吧台矮墙' }),
    // 卡座区隔断（沿 Z 走，从吧台到南墙，留 1.4m 通道）
    arch({ kind: 'wall', at: [boothX, H / 2, (barZ + D) / 2 + 0.7], size: [(D - barZ) / 2 - 1.4, H, T], rotY: Math.PI / 2, color: '#ded5c8', label: '卡座隔断' }),

    // ---------------- 吧台 / 开放厨房 ----------------
    gltf({ asset: 'furniture/diner-counter/diner-counter-light.glb', at: [3.4, 0, 1.0], label: '吧台' }),
    gltf({ asset: 'furniture/bar-stool/bar-stool.glb', at: [2.4, 0, 1.85], rotY: Math.PI, label: '吧凳 1' }),
    gltf({ asset: 'furniture/bar-stool/bar-stool.glb', at: [3.2, 0, 1.85], rotY: Math.PI, label: '吧凳 2' }),
    gltf({ asset: 'furniture/bar-stool/bar-stool.glb', at: [4.0, 0, 1.85], rotY: Math.PI, label: '吧凳 3' }),
    gltf({ asset: 'furniture/kitchen-island/kitchen-island-light.glb', at: [7.0, 0, 1.0], label: '厨房操作台' }),
    gltf({ asset: 'furniture/range-hood/range-hood.glb', at: [7.0, 0, 0.3], label: '抽油烟机' }),
    gltf({ asset: 'furniture/refrigerator/refrigerator.glb', at: [9.5, 0, 0.55], label: '冰箱' }),
    gltf({ asset: 'furniture/coffee-machine/coffee-machine.glb', at: [4.5, 0.94, 0.45], label: '咖啡机' }),
    gltf({ asset: 'furniture/water-cooler/water-cooler.glb', at: [11.4, 0, 1.0], rotY: -Math.PI / 2, label: '饮水机' }),

    // ---------------- 卡座区（4.4 × 7.0） ----------------
    gltf({ asset: 'furniture/diner-booth/diner-booth-light.glb', at: [2.1, 0, 3.6], rotY: -Math.PI / 2, label: '卡座 A' }),
    gltf({ asset: 'furniture/diner-booth/diner-booth-light.glb', at: [2.1, 0, 6.1], rotY: -Math.PI / 2, label: '卡座 B' }),
    gltf({ asset: 'furniture/diner-booth/diner-booth-light.glb', at: [2.1, 0, 8.6], rotY: -Math.PI / 2, label: '卡座 C' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.1, 2.75, 3.6], label: '卡座灯 A' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.1, 2.75, 6.1], label: '卡座灯 B' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.1, 2.75, 8.6], label: '卡座灯 C' }),

    // ---------------- 散座区（7.6 × 7.0）：8 张四人桌 ----------------
    // 两列 × 四排，桌 1.61 × 0.90，椅在两侧
    ...(() => {
      const out: Material3dObject[] = []
      const cols = [6.2, 9.8]
      const rows = [3.4, 5.1, 6.8, 8.5]
      let n = 1
      for (const x of cols) {
        for (const z of rows) {
          out.push(gltf({ asset: 'furniture/dining-table/dining-table.glb', at: [x, 0, z], label: `餐台 ${n}` }))
          out.push(gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [x - 0.55, 0, z - 0.75], rotY: Math.PI, label: `餐椅 ${n}A` }))
          out.push(gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [x + 0.55, 0, z - 0.75], rotY: Math.PI, label: `餐椅 ${n}B` }))
          out.push(gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [x - 0.55, 0, z + 0.75], label: `餐椅 ${n}C` }))
          out.push(gltf({ asset: 'furniture/dining-chair/dining-chair.glb', at: [x + 0.55, 0, z + 0.75], label: `餐椅 ${n}D` }))
          out.push(gltf({ asset: 'furniture/table-setting/table-setting.glb', at: [x, 0.76, z], label: `餐具 ${n}` }))
          n++
        }
      }
      return out
    })(),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [6.2, 2.75, 5.9], label: '散座灯 A' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [9.8, 2.75, 5.9], label: '散座灯 B' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [5.0, 0, 3.2], label: '餐区绿植' }),
    gltf({ asset: 'furniture/snake-plant/snake-plant.glb', at: [11.2, 0, 9.3], label: '角落植物' }),

    // ---------------- 入口 / 收银 ----------------
    gltf({ asset: 'furniture/checkout-counter/checkout-counter.glb', at: [9.4, 0, 9.3], rotY: Math.PI, label: '收银台' }),
    gltf({ asset: 'furniture/cash-register/cash-register.glb', at: [9.4, 0.9, 9.3], label: '收银机' }),
    gltf({ asset: 'furniture/menu-board/menu-board.glb', at: [11.3, 1.7, 7.6], rotY: -Math.PI / 2, label: '菜单板' }),
    gltf({ asset: 'furniture/coat-rack/coat-rack.glb', at: [0.5, 0, 9.2], rotY: Math.PI / 2, label: '衣帽架' }),
    gltf({ asset: 'furniture/notice-board/notice-board.glb', at: [0.2, 0, 6.5], rotY: Math.PI / 2, label: '公告板' }),
    gltf({ asset: 'furniture/wall-clock/wall-clock.glb', at: [7.0, 2.3, 9.92], rotY: Math.PI, label: '挂钟' }),
  ]

  const cameras: Material3dBookmark[] = [
    // 散座区：从东南角斜看整片餐桌
    cam({ label: '散座全景', alpha: (50 * Math.PI) / 180, beta: 1.2, radius: 4.5, target: [6.5, 1.0, 5.5] }),
    // 卡座：从东侧斜看三组卡座
    cam({ label: '卡座区', alpha: (70 * Math.PI) / 180, beta: 1.24, radius: 3.4, target: [2.0, 0.9, 6.0] }),
    // 吧台：从南侧看向吧台与开放厨房
    cam({ label: '吧台', alpha: Math.PI / 2, beta: 1.26, radius: 3.2, target: [3.4, 1.0, 1.2] }),
    // 入口视角：站在门口看整个餐厅
    cam({ label: '入口视角', alpha: -Math.PI / 2, beta: 1.3, radius: 3.6, target: [7.0, 1.1, 8.0] }),
    // 整店俯视
    cam({ label: '店面俯视', alpha: Math.PI / 2, beta: 0.4, radius: 18, target: [6, 0, 5.5] }),
  ]

  return {
    id: `m3d-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '餐厅 · 现代简约',
    designRefs: [],
    objects,
    cameras,
    environment: {
      background: '#0f1216',
      ground: { size: 44, color: '#1b2026', visible: false },
      // 餐厅照明偏暖、略暗，营造氛围
      light: { ambient: 1.1, directional: 0.42 },
    },
    updatedAt: now,
  }
}

/**
 * 教室 · 现代中小学
 *
 * 平面（X 向右 11m，Z 向内 8.4m）：
 *
 *   z=0  ┌──────────────────────────────────────┐
 *        │        黑板 + 讲台（前墙）             │
 *        ├──────────────────────────────────────┤
 *        │                                      │
 *        │   4 列 × 5 排 课桌（20 座）           │
 *        │                                      │
 *        │                                      │
 *   z=8.4└──────────────────────────────────────┘
 *       x=0                                  x=11
 *
 * 南北向进深 8.4m，讲台在前墙（z=0），课桌从 z=2.4 起排，
 * 后墙留出储物柜与阅读角。
 */
function buildClassroom(now: string): Material3dScene {
  const W = 11
  const D = 8.4
  const H = 3.1
  const T = 0.12
  const WALL = '#e9e6e0'

  const objects: Material3dObject[] = [
    // ---------------- 硬装 ----------------
    arch({ kind: 'floor', at: [W / 2, -0.02, D / 2], size: [W, 0.04, D], color: '#b89a6e', label: '教室木地板' }),
    arch({ kind: 'ceiling', at: [W / 2, H, D / 2], size: [W, 0.06, D], color: '#f5f3ef', label: '天花', visible: false }),
    arch({ kind: 'wall', at: [W / 2, H / 2, 0], size: [W + T, H, T], color: WALL, label: '前墙·黑板墙' }),
    arch({ kind: 'wall', at: [W / 2, H / 2, D], size: [W + T, H, T], color: WALL, label: '后墙' }),
    arch({ kind: 'wall', at: [0, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: WALL, label: '西墙·窗面' }),
    arch({ kind: 'wall', at: [W, H / 2, D / 2], size: [D, H, T], rotY: Math.PI / 2, color: WALL, label: '东墙·窗面' }),
    arch({ kind: 'baseboard', at: [W / 2, 0.05, 0.07], size: [W, 0.1, 0.02], color: '#dcd8d0', label: '前墙踢脚线' }),
    arch({ kind: 'baseboard', at: [W / 2, 0.05, D - 0.07], size: [W, 0.1, 0.02], color: '#dcd8d0', label: '后墙踢脚线' }),

    // ---------------- 前墙：黑板 + 讲台 ----------------
    gltf({ asset: 'furniture/chalkboard/chalkboard.glb', at: [W / 2, 0, 0.35], label: '黑板' }),
    gltf({ asset: 'furniture/podium/podium.glb', at: [W / 2 - 1.6, 0, 1.5], label: '讲台' }),
    gltf({ asset: 'furniture/lectern/lectern.glb', at: [W / 2 + 1.6, 0, 1.5], label: '读经台' }),
    gltf({ asset: 'furniture/office-chair/office-chair.glb', at: [W / 2 - 1.6, 0, 2.1], rotY: Math.PI, label: '讲台椅' }),

    // ---------------- 课桌：4 列 × 5 排 = 20 座 ----------------
    // 课桌 0.74 × 0.51，课椅 0.44 × 0.52；列距 2.2m，排距 1.15m
    ...(() => {
      const out: Material3dObject[] = []
      const cols = [1.9, 4.1, 6.3, 8.5]
      // 排距 1.05、起点 3.0：末排课椅落在 z=7.67，离后墙（8.4）还有余量
      const rows = [3.0, 4.05, 5.1, 6.15, 7.2]
      let n = 1
      for (const z of rows) {
        for (const x of cols) {
          out.push(gltf({ asset: 'furniture/school-desk/school-desk.glb', at: [x, 0, z], label: `课桌 ${n}` }))
          out.push(
            gltf({
              asset: 'furniture/stackable-school-chair/stackable-school-chair.glb',
              at: [x, 0, z + 0.62],
              rotY: Math.PI,
              label: `课椅 ${n}`,
            }),
          )
          n++
        }
      }
      return out
    })(),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.75, 2.6, 4.2], label: '教室灯 A' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.5, 2.6, 4.2], label: '教室灯 B' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [8.25, 2.6, 4.2], label: '教室灯 C' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [2.75, 2.6, 6.9], label: '教室灯 D' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [5.5, 2.6, 6.9], label: '教室灯 E' }),
    gltf({ asset: 'furniture/ceiling-lamp/ceiling-lamp.glb', at: [8.25, 2.6, 6.9], label: '教室灯 F' }),

    // ---------------- 后墙：储物柜、公告板、阅读角 ----------------
    gltf({ asset: 'furniture/school-locker/school-locker.glb', at: [1.0, 0, D - 0.35], rotY: Math.PI, label: '储物柜 A' }),
    gltf({ asset: 'furniture/school-locker/school-locker.glb', at: [2.1, 0, D - 0.35], rotY: Math.PI, label: '储物柜 B' }),
    gltf({ asset: 'furniture/cork-board/cork-board.glb', at: [7.6, 1.55, D - 0.06], rotY: Math.PI, label: '软木公告板' }),
    gltf({ asset: 'furniture/notice-board/notice-board.glb', at: [9.6, 0, D - 0.3], rotY: Math.PI, label: '公告板' }),
    gltf({ asset: 'furniture/bookshelf/bookshelf.glb', at: [10.6, 0, D / 2 + 1.6], rotY: -Math.PI / 2, label: '后墙书架' }),
    gltf({ asset: 'furniture/trash-can/trash-can.glb', at: [W - 0.5, 0, 0.6], label: '垃圾桶' }),
    gltf({ asset: 'furniture/houseplant-set/houseplant-set.glb', at: [0.5, 0, D - 0.6], label: '角落绿植' }),
    gltf({ asset: 'furniture/monstera-plant/monstera-plant.glb', at: [W - 0.6, 0, D - 0.7], label: '后墙绿植' }),
    gltf({ asset: 'furniture/wall-clock/wall-clock.glb', at: [W - 0.9, 2.35, 0.09], label: '挂钟' }),
  ]

  const cameras: Material3dBookmark[] = [
    // 学生视角：站在教室后排（z≈6.2、眼高 2.1m）看黑板
    cam({ label: '学生视角', alpha: Math.PI / 2, beta: 1.46, radius: 5.6, target: [5.5, 1.5, 0.6] }),
    // 教师视角：站在讲台看全班
    cam({ label: '教师视角', alpha: Math.PI / 2, beta: 1.26, radius: 3.2, target: [5.5, 0.9, 5.0] }),
    // 教室全景：从后墙上方斜看
    cam({ label: '教室全景', alpha: Math.PI / 2, beta: 1.2, radius: 4.2, target: [5.5, 1.0, 3.8] }),
    // 侧向视角：从东南角沿排看纵深
    cam({ label: '侧向视角', alpha: (45 * Math.PI) / 180, beta: 1.22, radius: 4.0, target: [5.5, 1.0, 5.0] }),
    // 教室俯视
    cam({ label: '教室俯视', alpha: Math.PI / 2, beta: 0.42, radius: 15, target: [5.5, 0, 4.2] }),
  ]

  return {
    id: `m3d-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '教室 · 现代中小学',
    designRefs: [],
    objects,
    cameras,
    environment: {
      background: '#0f1216',
      ground: { size: 40, color: '#1b2026', visible: false },
      // 教室要亮：环境光拉高，避免课桌之间出现浓重阴影
      light: { ambient: 1.45, directional: 0.35 },
    },
    updatedAt: now,
  }
}

export const MATERIAL3D_PRESETS: Material3dPreset[] = [
  {
    id: 'one-bedroom-modern',
    title: '一室一厅一卫 · 现代精装',
    summary: '6.8 × 8.4m；木地板 + 浅色墙 + 客厅/餐厨/卧室/卫浴分区，含 5 个预设机位',
    footprint: { width: 6.8, depth: 8.4 },
    build: buildOneBedroomApartment,
  },
  {
    id: 'open-office-modern',
    title: '办公场地 · 现代开放式',
    summary: '10 × 9m；5 组工位 + 会议室 + 茶水间 + 接待前台，含 5 个预设机位',
    footprint: { width: 10, depth: 9 },
    build: buildOfficeStudio,
  },
  {
    id: 'two-bedroom-modern',
    title: '两居室 · 现代精装',
    summary: '8.4 × 9.6m；客厅 + 餐厅 + 主卧 + 次卧 + 卫浴，含 5 个预设机位',
    footprint: { width: 8.4, depth: 9.6 },
    build: buildTwoBedroomApartment,
  },
  {
    id: 'restaurant-modern',
    title: '餐厅 · 现代简约',
    summary: '12 × 10m；卡座区 3 组 + 散座 8 桌 + 吧台开放厨房 + 收银，含 5 个预设机位',
    footprint: { width: 12, depth: 10 },
    build: buildRestaurant,
  },
  {
    id: 'classroom-modern',
    title: '教室 · 现代中小学',
    summary: '11 × 8.4m；黑板讲台 + 20 座课桌 + 储物柜阅读角，含 5 个预设机位',
    footprint: { width: 11, depth: 8.4 },
    build: buildClassroom,
  },
]

export function getMaterial3dPreset(id: string): Material3dPreset | undefined {
  return MATERIAL3D_PRESETS.find((p) => p.id === id)
}

/** 预设里有几个 gltf 对象需要 /cc0-props 落地，用于 UI 提示缺失 */
export function presetGltfAssets(preset: Material3dPreset): string[] {
  const scene = preset.build(new Date(0).toISOString())
  return scene.objects
    .filter((o): o is Material3dGltfObject => o.kind === 'gltf')
    .map((o) => o.assetUrl)
}
