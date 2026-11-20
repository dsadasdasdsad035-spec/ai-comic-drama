import type { DesignSheet } from '../api'
import { MATERIAL3D_OBJECT_META, type Material3dScene } from './material3dTypes'
import { resolveDesignBillboardUrl } from './billboardFromDesign'

export type SyncSceneContext = {
  designs: DesignSheet[]
  missing: Set<string>
}

/** 清空上次同步的用户网格（保留宿主地面/灯光/相机） */
export async function clearUserMeshes(scene: import('@babylonjs/core').Scene): Promise<void> {
  const toDispose = scene.meshes.filter((m) => m.metadata?.[MATERIAL3D_OBJECT_META])
  for (const m of toDispose) m.dispose()
  const roots = scene.rootNodes.filter(
    (n) => n.metadata?.[MATERIAL3D_OBJECT_META] && !scene.meshes.includes(n as import('@babylonjs/core').Mesh),
  )
  for (const r of roots) r.dispose()
}

function applyTransform(
  node: import('@babylonjs/core').TransformNode,
  t: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } },
) {
  node.position.set(t.position.x, t.position.y, t.position.z)
  node.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
  node.scaling.set(t.scale.x, t.scale.y, t.scale.z)
}

export type SyncSceneResult = {
  billboardCount: number
  gltfCount: number
  meshCount: number
}

export type SyncSceneOptions = {
  onAfterSync?: (result: SyncSceneResult) => void
}

/** 将文档对象同步到 Babylon 场景 */
export async function syncSceneFromDoc(
  scene: import('@babylonjs/core').Scene,
  doc: Material3dScene,
  ctx: SyncSceneContext,
  opts?: SyncSceneOptions,
): Promise<SyncSceneResult> {
  const BABYLON = await import('@babylonjs/core')
  await import('@babylonjs/loaders')

  await clearUserMeshes(scene)

  const designById = new Map(ctx.designs.map((d) => [d.id, d]))
  let billboardCount = 0
  let gltfCount = 0

  for (const obj of doc.objects) {
    if (obj.kind === 'billboard') {
      const design = designById.get(obj.designId)
      if (!design) continue
      const url = resolveDesignBillboardUrl(design, ctx.missing)
      const plane = BABYLON.MeshBuilder.CreatePlane(`bb-${obj.id}`, { width: 3.2, height: 1.8 }, scene)
      plane.metadata = { [MATERIAL3D_OBJECT_META]: obj.id }
      applyTransform(plane, obj.transform)
      const mat = new BABYLON.StandardMaterial(`bb-mat-${obj.id}`, scene)
      mat.diffuseTexture = new BABYLON.Texture(url, scene)
      mat.backFaceCulling = false
      mat.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15)
      plane.material = mat
      plane.position.y = Math.max(plane.position.y, 0.9)
      billboardCount++
      continue
    }
    if (obj.kind === 'gltf') {
      const url = String(obj.assetUrl || '').split('?')[0]
      if (!url.startsWith('/')) continue
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(url, '', scene)
      const root = new BABYLON.TransformNode(`gltf-${obj.id}`, scene)
      root.metadata = { [MATERIAL3D_OBJECT_META]: obj.id }
      container.addAllToScene()
      for (const m of container.meshes) {
        if (!m.parent) m.setParent(root)
        m.metadata = { ...(m.metadata || {}), [MATERIAL3D_OBJECT_META]: obj.id }
      }
      for (const t of container.transformNodes) {
        if (!t.parent) t.setParent(root)
        t.metadata = { ...(t.metadata || {}), [MATERIAL3D_OBJECT_META]: obj.id }
      }
      applyTransform(root, obj.transform)
      gltfCount++
    }
  }

  const meshCount = scene.meshes.filter((m) => m.metadata?.[MATERIAL3D_OBJECT_META]).length
  const result = { billboardCount, gltfCount, meshCount }
  opts?.onAfterSync?.(result)
  return result
}