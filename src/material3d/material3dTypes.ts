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

export type Material3dBookmark = {
  id: string
  label: string
  alpha: number
  beta: number
  radius: number
  target: Material3dVec3
}

export type Material3dBillboardObject = {
  id: string
  kind: 'billboard'
  designId: string
  transform: Material3dTransform
}

export type Material3dGltfObject = {
  id: string
  kind: 'gltf'
  assetUrl: string
  transform: Material3dTransform
}

export type Material3dObject = Material3dBillboardObject | Material3dGltfObject

export type Material3dScene = {
  id: string
  name: string
  designRefs: string[]
  objects: Material3dObject[]
  cameras: Material3dBookmark[]
  updatedAt: string
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