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

export type Material3dObject = Material3dBillboardObject | Material3dGltfObject

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