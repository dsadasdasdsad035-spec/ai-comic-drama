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

export function pickObjectIdAt(scene: Scene, x: number, y: number): string | null {
  const pick = scene.pick(x, y, (mesh) => !!readMaterial3dObjectId(mesh.metadata))
  if (!pick?.hit || !pick.pickedMesh) return null
  return readMaterial3dObjectId(pick.pickedMesh.metadata)
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
  const gizmoManager = new BABYLON.GizmoManager(scene)
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
    const id = pickObjectIdAt(scene, scene.pointerX, scene.pointerY)
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