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

export const MATERIAL3D_PRESETS: Material3dPreset[] = [
  {
    id: 'one-bedroom-modern',
    title: '一室一厅一卫 · 现代精装',
    summary: '6.8 × 8.4m；木地板 + 浅色墙 + 客厅/餐厨/卧室/卫浴分区，含 5 个预设机位',
    footprint: { width: 6.8, depth: 8.4 },
    build: buildOneBedroomApartment,
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
