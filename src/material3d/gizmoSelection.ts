import type { AbstractMesh, Node, Scene } from '@babylonjs/core'
import { MATERIAL3D_OBJECT_META, type Material3dTransform } from './material3dTypes'

export function readMaterial3dObjectId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const id = (metadata as Record<string, unknown>)[MATERIAL3D_OBJECT_META]
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function nodeToTransform(node: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scaling: { x: number; y: number; z: number } }): Material3dTransform {
  return {
    position: { x: node.position.x, y: node.position.y, z: node.position.z },
    rotation: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
    scale: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
  }
}

export function findNodeForObjectId(scene: Scene, objectId: string): Node | null {
  const gltfRoot = scene.getTransformNodeByName(`gltf-${objectId}`)
  if (gltfRoot) return gltfRoot
  const mesh = scene.meshes.find((m) => readMaterial3dObjectId(m.metadata) === objectId)
  return mesh ?? null
}

/**
 * 点击拾取。精确 pick 打不中时，退一步找「屏幕投影离点击点最近」的对象。
 *
 * 为什么需要兜底：动物模型是真实物理尺寸（小猫 0.37m 宽），在常规观察
 * 距离下只占几十像素；小物件、细长物件（台灯、花瓶）用精确 raycast 很难
 * 点中，用户感觉是「这个模型坏了，选不了」。
 *
 * 容差按画布短边的一个比例给，不用固定像素 —— 高分屏与窄画布下才不会失效。
 */
const PICK_TOLERANCE_RATIO = 0.05

/**
 * @param BABYLON 已加载的 Babylon 命名空间。调用方（createGizmoSelection）本就
 *   在 async 环境里 import 过它，从这里再 import 一次既多余又让本函数变异步。
 */
export function pickObjectIdAt(
  scene: Scene,
  x: number,
  y: number,
  BABYLON: typeof import('@babylonjs/core'),
): string | null {
  const precise = scene.pick(x, y, (mesh) => !!readMaterial3dObjectId(mesh.metadata))
  if (precise?.hit && precise.pickedMesh) {
    return readMaterial3dObjectId(precise.pickedMesh.metadata)
  }
  return pickNearestByProjection(scene, x, y, BABYLON)
}

/** 精确 pick 失败时的兜底：按屏幕投影距离找最近的候选对象 */
function pickNearestByProjection(
  scene: Scene,
  x: number,
  y: number,
  BABYLON: typeof import('@babylonjs/core'),
): string | null {
  const engine = scene.getEngine()
  const w = engine.getRenderWidth()
  const h = engine.getRenderHeight()
  if (w <= 0 || h <= 0) return null
  const tolerance = Math.min(w, h) * PICK_TOLERANCE_RATIO
  if (!Number.isFinite(tolerance) || tolerance <= 0) return null

  const identity = BABYLON.Matrix.Identity()
  let bestId: string | null = null
  let bestDist2 = tolerance * tolerance
  for (const mesh of scene.meshes) {
    const id = readMaterial3dObjectId(mesh.metadata)
    if (!id) continue
    if (!mesh.isEnabled() || !mesh.isVisible) continue
    // 包围盒中心作为代表点：比逐顶点投影便宜，对小物件足够准
    const center = mesh.getBoundingInfo().boundingBox.centerWorld
    const projected = BABYLON.Vector3.Project(center, identity, scene.getTransformMatrix(), scene.activeCamera!.viewport.toGlobal(w, h))
    // 点在相机背后时 Project 会给出镜像坐标，用 z 判断可见性
    if (projected.z < 0 || projected.z > 1) continue
    const dx = projected.x - x
    const dy = projected.y - y
    const dist2 = dx * dx + dy * dy
    if (dist2 <= bestDist2) {
      bestDist2 = dist2
      bestId = id
    }
  }
  return bestId
}

export type GizmoSelectionController = {
  selectById: (objectId: string | null) => void
  dispose: () => void
}

export async function createGizmoSelection(
  scene: Scene,
  callbacks: {
    onSelect: (objectId: string | null) => void
    onTransformEnd: (objectId: string, transform: Material3dTransform) => void
    isLocked?: (objectId: string) => boolean
  },
): Promise<GizmoSelectionController> {
  const BABYLON = await import('@babylonjs/core')
  /**
   * 显式给 GizmoManager 自己的 utility layer / keepDepth layer。
   *
   * 默认构造走 `UtilityLayerRenderer.DefaultUtilityLayer`，它读全局的
   * `EngineStore.LastCreatedScene`。工作台重建引擎的那一瞬间（旧场景已 dispose、新场景
   * 刚建）这个全局值可能是 null，于是 `new UtilityLayerRenderer(null)` 抛
   * 「Cannot read properties of null (reading 'getEngine')」，Gizmo 整体不可用。
   * 显式传本场景的 layer 既绕开全局单例，也避免和画布其它 Babylon 场景共享 gizmo 层。
   */
  const utilityLayer = new BABYLON.UtilityLayerRenderer(scene)
  const keepDepthLayer = new BABYLON.UtilityLayerRenderer(scene)
  const gizmoManager = new BABYLON.GizmoManager(scene, 1, utilityLayer, keepDepthLayer)
  gizmoManager.positionGizmoEnabled = true
  gizmoManager.rotationGizmoEnabled = true
  gizmoManager.scaleGizmoEnabled = true
  gizmoManager.usePointerToAttachGizmos = false

  let attachedId: string | null = null

  const emitTransform = () => {
    if (!attachedId) return
    const node = findNodeForObjectId(scene, attachedId)
    if (!node || !('position' in node)) return
    callbacks.onTransformEnd(attachedId, nodeToTransform(node as AbstractMesh))
  }

  const dragHandles: { remove: () => void }[] = []
  for (const gizmo of [
    gizmoManager.gizmos.positionGizmo,
    gizmoManager.gizmos.rotationGizmo,
    gizmoManager.gizmos.scaleGizmo,
  ]) {
    if (!gizmo) continue
    const obs = gizmo.onDragEndObservable.add(emitTransform)
    dragHandles.push({ remove: () => gizmo.onDragEndObservable.remove(obs) })
  }

  const attachToId = (objectId: string | null) => {
    attachedId = objectId
    if (!objectId) {
      gizmoManager.attachToMesh(null)
      return
    }
    if (callbacks.isLocked?.(objectId)) {
      gizmoManager.attachToMesh(null)
      return
    }
    const node = findNodeForObjectId(scene, objectId)
    if (!node) {
      gizmoManager.attachToMesh(null)
      return
    }
    if (node instanceof BABYLON.AbstractMesh) gizmoManager.attachToMesh(node)
    else gizmoManager.attachToNode(node)
  }

  const pointerObs = scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return
    const evt = pointerInfo.event
    if (evt.button !== 0) return
    const id = pickObjectIdAt(scene, scene.pointerX, scene.pointerY, BABYLON)
    callbacks.onSelect(id)
    attachToId(id)
  })

  return {
    selectById: (objectId: string | null) => {
      attachedId = objectId
      attachToId(objectId)
    },
    dispose: () => {
      scene.onPointerObservable.remove(pointerObs)
      for (const h of dragHandles) h.remove()
      gizmoManager.dispose()
    },
  }
}