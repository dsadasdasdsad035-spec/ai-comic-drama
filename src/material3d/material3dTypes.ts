/** 三维素材工作台：项目级场景 JSON，与 Blender 成片管线无关 */

/** Babylon 网格 metadata 键：关联 material3dScenes.objects[].id */
export const MATERIAL3D_OBJECT_META = 'material3dObjectId'

export type Material3dVec3 = { x: number; y: number; z: number }

export type Material3dTransform = {
  position: Material3dVec3
  rotation: Material3dVec3
  scale: Material3dVec3
}

export const DEFAULT_TRANSFORM: Material3dTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

export type Material3dBillboardSize = { width: number; height: number }

export const DEFAULT_BILLBOARD_SIZE: Material3dBillboardSize = { width: 3.2, height: 1.8 }

export type Material3dGroundEnv = {
  size?: number
  color?: string
  visible?: boolean
}

export type Material3dLightEnv = {
  ambient?: number
  directional?: number
}

export type Material3dEnvironment = {
  background?: string
  ground?: Material3dGroundEnv
  light?: Material3dLightEnv
}

export const DEFAULT_MATERIAL3D_ENVIRONMENT: {
  background: string
  ground: Required<Material3dGroundEnv>
  light: Required<Material3dLightEnv>
} = {
  background: '#12171c',
  ground: { size: 24, color: '#24292e', visible: true },
  light: { ambient: 1, directional: 0.6 },
}

export type Material3dObjectBase = {
  id: string
  label?: string
  locked?: boolean
  transform: Material3dTransform
}

export type Material3dBillboardObject = Material3dObjectBase & {
  kind: 'billboard'
  designId: string
  billboardSize?: Material3dBillboardSize
}

export type Material3dGltfObject = Material3dObjectBase & {
  kind: 'gltf'
  assetUrl: string
}

/**
 * 硬装面：墙、地板、天花、踢脚线这类由程序生成的长方体。
 * 与 gltf/billboard 并列存进场景文档，因此预设户型能整套复用，
 * 也能像其它对象一样被选中、拖动、改色、删除。
 *
 * 用 box 而不是导入模型：墙体尺寸随户型变，纯色材质也够——分镜布景
 * 真正要看的是空间关系与主光，墙面纹理不是这一层的事。
 */
export type Material3dArchKind = 'floor' | 'wall' | 'ceiling' | 'baseboard'

export type Material3dArchObject = Material3dObjectBase & {
  kind: 'arch'
  archKind: Material3dArchKind
  /** 长方体尺寸（米）；墙体默认厚度 0.12 */
  size: Material3dVec3
  /** #rrggbb 漫反射色 */
  color: string
  /** 0-1；墙与地板用 0.9 左右，避免塑料感 */
  roughness?: number
  /** false 时不渲染但保留在文档里；天花用它在俯视时让开视线 */
  visible?: boolean
}

export type Material3dObject =
  | Material3dBillboardObject
  | Material3dGltfObject
  | Material3dArchObject

/** 按 archKind 给出默认厚度，避免每处手写 0.12 */
export const ARCH_DEFAULT_THICKNESS = 0.12

export function isArchObject(o: Material3dObject): o is Material3dArchObject {
  return o.kind === 'arch'
}

export type Material3dBookmark = {
  id: string
  label: string
  alpha: number
  beta: number
  radius: number
  target: Material3dVec3
}

export type Material3dScene = {
  id: string
  name: string
  designRefs: string[]
  objects: Material3dObject[]
  cameras: Material3dBookmark[]
  environment?: Material3dEnvironment
  updatedAt: string
}

export function resolveBillboardSize(obj: Material3dBillboardObject): Material3dBillboardSize {
  const w = obj.billboardSize?.width ?? DEFAULT_BILLBOARD_SIZE.width
  const h = obj.billboardSize?.height ?? DEFAULT_BILLBOARD_SIZE.height
  return { width: w, height: h }
}

export function mergeMaterial3dEnvironment(env?: Material3dEnvironment): typeof DEFAULT_MATERIAL3D_ENVIRONMENT {
  return {
    background: env?.background?.trim() || DEFAULT_MATERIAL3D_ENVIRONMENT.background,
    ground: {
      size: env?.ground?.size ?? DEFAULT_MATERIAL3D_ENVIRONMENT.ground.size,
      color: env?.ground?.color?.trim() || DEFAULT_MATERIAL3D_ENVIRONMENT.ground.color,
      visible: env?.ground?.visible ?? DEFAULT_MATERIAL3D_ENVIRONMENT.ground.visible,
    },
    light: {
      ambient: env?.light?.ambient ?? DEFAULT_MATERIAL3D_ENVIRONMENT.light.ambient,
      directional: env?.light?.directional ?? DEFAULT_MATERIAL3D_ENVIRONMENT.light.directional,
    },
  }
}

export function newMaterial3dScene(name?: string): Material3dScene {
  const stamp = Date.now()
  return {
    id: `m3d-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
    name: name?.trim() || `场景 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    designRefs: [],
    objects: [],
    cameras: [],
    updatedAt: new Date().toISOString(),
  }
}

export function newMaterial3dObjectId(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function newBookmarkId(): string {
  return `cam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}