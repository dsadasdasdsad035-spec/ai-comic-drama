import type { DesignSheet } from '../api'
import { MATERIAL3D_OBJECT_META, resolveBillboardSize, type Material3dScene } from './material3dTypes'
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
  /** 返回 true 时中止同步（场景卸载或新一代 refresh 已启动） */
  isCancelled?: () => boolean
}

function syncAborted(scene: import('@babylonjs/core').Scene, opts?: SyncSceneOptions): boolean {
  return scene.isDisposed || Boolean(opts?.isCancelled?.())
}

/** SceneLoader 需要目录 rootUrl + 文件名，否则 .bin / textures 会打到站点根路径 */
function gltfLoaderParts(assetUrl: string): { rootUrl: string; sceneFilename: string } {
  const u = assetUrl.split('?')[0]
  const slash = u.lastIndexOf('/')
  if (slash < 0) return { rootUrl: '/', sceneFilename: u }
  return { rootUrl: `${u.slice(0, slash + 1)}`, sceneFilename: u.slice(slash + 1) }
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

  if (syncAborted(scene, opts)) {
    return { billboardCount: 0, gltfCount: 0, meshCount: 0 }
  }

  await clearUserMeshes(scene)
  if (syncAborted(scene, opts)) {
    return { billboardCount: 0, gltfCount: 0, meshCount: 0 }
  }

  const designById = new Map(ctx.designs.map((d) => [d.id, d]))
  let billboardCount = 0
  let gltfCount = 0

  for (const obj of doc.objects) {
    if (syncAborted(scene, opts)) break
    if (obj.kind === 'billboard') {
      const design = designById.get(obj.designId)
      if (!design) continue
      const url = resolveDesignBillboardUrl(design, ctx.missing)
      const size = resolveBillboardSize(obj)
      const plane = BABYLON.MeshBuilder.CreatePlane(`bb-${obj.id}`, { width: size.width, height: size.height }, scene)
      plane.metadata = { [MATERIAL3D_OBJECT_META]: obj.id, material3dLocked: Boolean(obj.locked) }
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
      let container: import('@babylonjs/core').AssetContainer
      try {
        const { rootUrl, sceneFilename } = gltfLoaderParts(url)
        container = await BABYLON.SceneLoader.LoadAssetContainerAsync(rootUrl, sceneFilename, scene)
      } catch (e) {
        if (syncAborted(scene, opts)) {
          return { billboardCount, gltfCount, meshCount: 0 }
        }
        throw e
      }
      if (syncAborted(scene, opts)) {
        container.dispose()
        return { billboardCount, gltfCount, meshCount: 0 }
      }
      const root = new BABYLON.TransformNode(`gltf-${obj.id}`, scene)
      root.metadata = { [MATERIAL3D_OBJECT_META]: obj.id, material3dLocked: Boolean(obj.locked) }
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
      // 挂接完成后释放容器壳，避免每次同步累积 AssetContainer（网格留在 scene）
      try {
        container.dispose()
      } catch {
        /* 已释放 */
      }
      gltfCount++
    }
  }

  const meshCount = scene.meshes.filter((m) => m.metadata?.[MATERIAL3D_OBJECT_META]).length
  const result = { billboardCount, gltfCount, meshCount }
  opts?.onAfterSync?.(result)
  return result
}