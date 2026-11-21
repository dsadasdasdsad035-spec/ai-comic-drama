import type { DesignSheet } from '../api'
import {
  MATERIAL3D_OBJECT_META,
  resolveBillboardSize,
  type Material3dArchObject,
  type Material3dScene,
} from './material3dTypes'
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

/** #rrggbb → 0-1 分量；非法值退回中性灰，避免整面墙变黑 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = String(hex || '').replace('#', '').trim()
  if (h.length !== 6) return { r: 0.8, g: 0.8, b: 0.78 }
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
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
  archCount: number
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
    return { billboardCount: 0, gltfCount: 0, archCount: 0, meshCount: 0 }
  }

  await clearUserMeshes(scene)
  if (syncAborted(scene, opts)) {
    return { billboardCount: 0, gltfCount: 0, archCount: 0, meshCount: 0 }
  }

  const designById = new Map(ctx.designs.map((d) => [d.id, d]))
  let billboardCount = 0
  let gltfCount = 0
  let archCount = 0

  for (const obj of doc.objects) {
    if (syncAborted(scene, opts)) break
    if (obj.kind === 'arch') {
      // 硬装面：尺寸来自文档，材质用纯色 StandardMaterial。
      // 与其它对象一样打 metadata，clearUserMeshes 才能在下次同步时清掉它。
      //
      // 尺寸走 mesh 的 boundingInfo 而不是 scaling：applyTransform 会把
      // scaling 重置成对象的 scale，若先 scaling 再 applyTransform 就全变
      // 1×1×1 立方体（实测所有墙都成了方块）。这里用 CreateBox 的 width/
      // height/depth 直接定尺寸，scaling 只承载对象自身的缩放。
      const box = BABYLON.MeshBuilder.CreateBox(
        `arch-${obj.id}`,
        { width: obj.size.x, height: obj.size.y, depth: obj.size.z },
        scene,
      )
      box.metadata = { [MATERIAL3D_OBJECT_META]: obj.id, material3dLocked: Boolean(obj.locked) }
      applyTransform(box, obj.transform)
      // 天花这类面可以只登记不渲染：俯视机位要靠它让开视线
      if (obj.visible === false) box.setEnabled(false)
      const mat = new BABYLON.StandardMaterial(`arch-mat-${obj.id}`, scene)
      const c = hexToRgb(obj.color)
      mat.diffuseColor = new BABYLON.Color3(c.r, c.g, c.b)
      mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02)
      mat.emissiveColor = new BABYLON.Color3(c.r * 0.08, c.g * 0.08, c.b * 0.08)
      box.material = mat
      box.isPickable = true
      // 天花从下方看：关掉背面剔除会让它盖住整个画面，保持剔除
      archCount++
      continue
    }
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
          return { billboardCount, gltfCount, archCount, meshCount: 0 }
        }
        throw e
      }
      if (syncAborted(scene, opts)) {
        container.dispose()
        return { billboardCount, gltfCount, archCount, meshCount: 0 }
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
      // 不要 container.dispose()：Babylon 的 AssetContainer.dispose() 会连同
      // 容器内的网格一起销毁，即使已经 addAllToScene —— 实测表现为每个模型
      // 只剩一个空 root，画面里是一堆立方体占位。网格已经挂在 root 下，
      // 由 clearUserMeshes 靠 metadata 统一回收，不需要容器壳。
      gltfCount++
    }
  }

  const meshCount = scene.meshes.filter((m) => m.metadata?.[MATERIAL3D_OBJECT_META]).length
  const result = { billboardCount, gltfCount, archCount, meshCount }
  opts?.onAfterSync?.(result)
  return result
}