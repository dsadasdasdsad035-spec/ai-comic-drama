import type { AbstractMesh, Scene, TransformNode } from '@babylonjs/core'
import { findNodeForObjectId } from './gizmoSelection'
import type { Material3dTransform } from './material3dTypes'

type Transformable = AbstractMesh | TransformNode

function asTransformable(node: unknown): Transformable | null {
  if (!node || typeof node !== 'object') return null
  if (!('position' in node) || !('rotation' in node)) return null
  return node as Transformable
}

export function applyTransformToLiveNode(scene: Scene, objectId: string, transform: Material3dTransform): boolean {
  const node = asTransformable(findNodeForObjectId(scene, objectId))
  if (!node) return false
  node.position.set(transform.position.x, transform.position.y, transform.position.z)
  node.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z)
  node.scaling.set(transform.scale.x, transform.scale.y, transform.scale.z)
  return true
}