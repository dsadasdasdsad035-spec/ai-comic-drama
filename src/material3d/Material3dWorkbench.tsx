import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cc0PropEntry, DesignSheet, ItchPropEntry, ProjectAsset } from '../api'
import {
  fetchCc0PropsManifest,
  fetchItchPropsManifest,
  importCc0PropToProject,
  importItchPropToProject,
  patchProject,
} from '../api'
import { cc0PropDisplayTitle, cc0PropSearchHaystack } from './cc0PropDisplayTitle'
import { isGltfAssetUrl } from './isGltfAssetUrl'
import { uploadImageFile } from '../mediaUpload'
import { createBillboardObject, resolveDesignBillboardUrl } from './billboardFromDesign'
import { captureViewportPng, blobToDataUrl } from './captureViewport'
import { createBabylonHost, type BabylonHost } from './createEngine'
import { createGizmoSelection, type GizmoSelectionController } from './gizmoSelection'
import { DebugLayerTab } from '@babylonjs/core/Debug/debugLayer'
import {
  hideInspector,
  popupFullInspector,
  showEmbeddedInspector,
  syncInspectorSelection,
} from './inspectorPane'
import { applyTransformToLiveNode } from './applyObjectToNode'
import { buildStoryboardMarkdown, downloadStoryboardJson } from './exportStoryboard'
import { applyMaterial3dEnvironment } from './sceneEnvironment'
import { syncSceneFromDoc } from './syncSceneFromDoc'
import {
  DEFAULT_TRANSFORM,
  MATERIAL3D_OBJECT_META,
  newBookmarkId,
  newMaterial3dObjectId,
  type Material3dBookmark,
  type Material3dEnvironment,
  type Material3dGltfObject,
  type Material3dObject,
  type Material3dScene,
  type Material3dTransform,
} from './material3dTypes'
import Material3dAddPanel, { type PropSource } from './Material3dAddPanel'
import Material3dDebugPanel from './Material3dDebugPanel'
import Material3dHierarchyPanel from './Material3dHierarchyPanel'
import Material3dShotPanel from './Material3dShotPanel'
import type { OrbitSliderKey } from './Material3dCameraPanel'
import { applyCameraPose, readCameraPose, setRadiusLimits, type OrbitPose } from './createEngine'
import { FIT_BETA, FIT_MIN_DIAGONAL, degToRad, fitDistanceForBox, poseNearlyEqual } from './orbitPose'

export type Material3dRailTab = 'library' | 'compose' | 'shot' | 'debug'

type Props = {
  projectName: string
  sceneDoc: Material3dScene
  designs: DesignSheet[]
  assets: ProjectAsset[]
  missing: Set<string>
  onSceneChange: (next: Material3dScene) => void
  onClose: () => void
  onAssetsAppended?: (assets: ProjectAsset[]) => void
  toast: (m: string) => void
}

function snapshotCamera(host: BabylonHost): Omit<Material3dBookmark, 'id' | 'label'> {
  const c = host.camera
  return {
    alpha: c.alpha,
    beta: c.beta,
    radius: c.radius,
    target: { x: c.target.x, y: c.target.y, z: c.target.z },
  }
}

function applyBookmark(host: BabylonHost, b: Material3dBookmark) {
  const c = host.camera
  c.alpha = b.alpha
  c.beta = b.beta
  c.radius = b.radius
  c.target.x = b.target.x
  c.target.y = b.target.y
  c.target.z = b.target.z
}

export default function Material3dWorkbench({
  projectName,
  sceneDoc,
  designs,
  assets,
  missing,
  onSceneChange,
  onClose,
  onAssetsAppended,
  toast,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<BabylonHost | null>(null)
  const meshSyncGenRef = useRef(0)
  const gizmoRef = useRef<GizmoSelectionController | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const inspectorOpenRef = useRef(false)
  const inspectorHostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  /** 当前相机位姿（面板滑杆的数据源） */
  const [pose, setPose] = useState<OrbitPose | null>(null)
  /**
   * 谁在控制相机：null = 鼠标；非 null = 该滑杆正在拖动。
   * 用 ref 而不是 state —— onBeforeRender 每帧要读它，state 会拿到旧闭包。
   */
  const sliderActiveRef = useRef<OrbitSliderKey | null>(null)
  /** 最近一次由滑杆写入的位姿：回写仲裁用，避免「滑杆写相机 -> 相机回写滑杆」打架 */
  const poseRef = useRef<OrbitPose | null>(null)
  /**
   * fitView 的反向引用：refreshMeshes 的 onAfterSync 里要用它，但把 fitView
   * 放进 refreshMeshes 的依赖会让它每次重建、连带重新灌一遍场景。
   */
  const fitViewRef = useRef<((opts?: { silent?: boolean }) => boolean) | null>(null)
  /** 已经自动取景过的场景签名；避免每次对象增删都重新取景把用户视角踢掉 */
  const autoFitDoneRef = useRef<string>('')
  const [cc0Props, setCc0Props] = useState<Cc0PropEntry[]>([])
  const [itchProps, setItchProps] = useState<ItchPropEntry[]>([])
  const [railTab, setRailTab] = useState<Material3dRailTab>(() => (sceneDoc.objects.length > 0 ? 'compose' : 'library'))
  const [propSource, setPropSource] = useState<PropSource>('characters')
  const [charactersReady, setCharactersReady] = useState(false)
  const [animalsReady, setAnimalsReady] = useState(false)
  const [furnitureReady, setFurnitureReady] = useState(false)
  const [furnitureGroup, setFurnitureGroup] = useState('')
  const [propQuery, setPropQuery] = useState('')
  const [samplesReady, setSamplesReady] = useState(false)
  const [itchVendorReady, setItchVendorReady] = useState(false)
  const [importingProp, setImportingProp] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorShowExplorer, setInspectorShowExplorer] = useState(false)
  const [inspectorTab, setInspectorTab] = useState(DebugLayerTab.Properties)
  const [bookmarkLabel, setBookmarkLabel] = useState('机位 1')
  const [savingShot, setSavingShot] = useState(false)

  selectedIdRef.current = selectedId
  inspectorOpenRef.current = inspectorOpen

  const designOptions = useMemo(
    () => designs.filter((d) => d.image && !missing.has(String(d.image).split('?')[0])),
    [designs, missing],
  )

  const gltfAssets = useMemo(
    () => assets.filter((a) => a.url && isGltfAssetUrl(a.url)),
    [assets],
  )

  useEffect(() => {
    let alive = true
    void Promise.all([fetchCc0PropsManifest(), fetchItchPropsManifest()])
      .then(([cc0, itch]) => {
        if (!alive) return
        setCc0Props(cc0.samples ?? [])
        setItchProps(itch.samples ?? [])
        setItchVendorReady(Boolean(itch.vendorReady))
        setCharactersReady(Boolean(cc0.charactersReady))
        setAnimalsReady(Boolean(cc0.animalsReady))
        setFurnitureReady(Boolean(cc0.furnitureReady))
        setSamplesReady(true)
      })
      .catch(() => {
        if (!alive) return
        setSamplesReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const isObjectLocked = useCallback(
    (objectId: string) => Boolean(sceneDoc.objects.find((o) => o.id === objectId)?.locked),
    [sceneDoc.objects],
  )

  const applyObjectTransform = useCallback(
    (objectId: string, transform: Material3dTransform) => {
      const objects = sceneDoc.objects.map((o) => (o.id === objectId ? { ...o, transform } : o))
      const next: Material3dScene = {
        ...sceneDoc,
        objects,
        updatedAt: new Date().toISOString(),
      }
      onSceneChange(next)
    },
    [sceneDoc, onSceneChange],
  )

  const handleTransformChange = useCallback(
    (objectId: string, transform: Material3dTransform) => {
      const host = hostRef.current
      if (host) applyTransformToLiveNode(host.scene, objectId, transform)
      applyObjectTransform(objectId, transform)
    },
    [applyObjectTransform],
  )

  const selectObject = useCallback(
    (objectId: string | null) => {
      setSelectedId(objectId)
      gizmoRef.current?.selectById(objectId)
      const host = hostRef.current
      if (host && inspectorOpen) void syncInspectorSelection(host.scene, objectId)
    },
    [inspectorOpen],
  )

  const refreshMeshes = useCallback(async () => {
    const host = hostRef.current
    if (!host || host.scene.isDisposed) return
    const gen = ++meshSyncGenRef.current
    const isCancelled = () => gen !== meshSyncGenRef.current || host.scene.isDisposed
    try {
      await syncSceneFromDoc(host.scene, sceneDoc, { designs, missing }, {
        isCancelled,
        onAfterSync: () => {
          if (isCancelled()) return
          const id = selectedIdRef.current
          const still = id && sceneDoc.objects.some((o) => o.id === id) ? id : null
          if (still !== selectedIdRef.current) setSelectedId(still)
          gizmoRef.current?.selectById(still)
          if (inspectorOpenRef.current) void syncInspectorSelection(host.scene, still)
          // 自动取景：场景首次有内容、或切换到另一个场景时取一次。
          // 注意只有 fitView 真的成功（包围盒有效）才记账 —— 首轮同步时每个 GLB
          // 还在异步加载，包围盒是空的；若此时就写 autoFitDoneRef，后续轮次
          // 再也不会重试，自动取景永远不生效。
          const sceneKey = sceneDoc.id
          if (sceneDoc.objects.length > 0 && autoFitDoneRef.current !== sceneKey) {
            if (fitViewRef.current?.({ silent: true })) autoFitDoneRef.current = sceneKey
          }
        },
      })
    } catch (e) {
      if (isCancelled()) return
      toast((e as Error).message || '同步场景失败')
    }
  }, [sceneDoc, designs, missing, toast])

  /**
   * 相机 -> 面板。订阅 onBeforeRender 而不是 onViewMatrixChanged：
   * 后者在「读矩阵」时也会触发，回调里读 alpha/beta 会构成重入（Babylon 类型
   * 声明里明确警告过 reentrance）。onBeforeRender 每帧一跳，与读相机无关。
   */
  useEffect(() => {
    const host = hostRef.current
    if (!ready || !host) return
    const scene = host.scene
    const observer = scene.onBeforeRenderObservable.add(() => {
      // 滑杆正在拖：由滑杆单向写相机，绝不回写，避免两股来源互相覆盖
      if (sliderActiveRef.current) return
      const live = readCameraPose(host)
      const prev = poseRef.current
      if (prev && poseNearlyEqual(prev, live)) return
      poseRef.current = live
      setPose(live)
    })
    // 建好订阅后先取一次初值，避免面板在第一次交互前是空的
    const initial = readCameraPose(host)
    poseRef.current = initial
    setPose(initial)
    return () => {
      scene.onBeforeRenderObservable.remove(observer)
    }
  }, [ready])

  /** 滑杆写入相机（单向，不回写 state —— 下一帧 onBeforeRender 会发现值已相等） */
  const applyPoseFromSlider = useCallback(
    (next: OrbitPose) => {
      const host = hostRef.current
      if (!host) return
      applyCameraPose(host, next)
      poseRef.current = next
      setPose(next)
    },
    [],
  )

  /**
   * 拖动滑杆期间把相机输入摘掉：否则拖滑杆时滚轮/指针仍会改相机，
   * 与滑杆打架。三条结束路径都要恢复（pointerup / pointercancel / blur）。
   */
  const setSliderActive = useCallback((key: OrbitSliderKey | null) => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const wasActive = sliderActiveRef.current !== null
    sliderActiveRef.current = key
    if (!host || !canvas) return
    try {
      if (key && !wasActive) host.camera.detachControl()
      else if (!key && wasActive) host.camera.attachControl(canvas, true)
    } catch {
      /* 相机可能已随引擎释放 */
    }
  }, [])

  /** 场景包围盒（只认带 material3dObjectId 的网格，排除宿主地面与灯光辅助体） */
  const contentBounds = useCallback(
    (): { center: [number, number, number]; diagonal: number; width: number; height: number } | null => {
      const host = hostRef.current
      if (!host) return null
      const ext = host.scene.getWorldExtends(
        (m) => Boolean(m.metadata?.[MATERIAL3D_OBJECT_META]),
      )
      if (!ext?.min || !ext?.max) return null
      const sx = ext.max.x - ext.min.x
      const sy = ext.max.y - ext.min.y
      const sz = ext.max.z - ext.min.z
      const diag = Math.sqrt(sx * sx + sy * sy + sz * sz)
      if (!Number.isFinite(diag) || diag < FIT_MIN_DIAGONAL) return null
      return {
        center: [
          (ext.min.x + ext.max.x) / 2,
          (ext.min.y + ext.max.y) / 2,
          (ext.min.z + ext.max.z) / 2,
        ],
        diagonal: diag,
        // 轨道相机在不同方位角下看到的横向跨度不同，取 X/Z 的较大者最稳
        width: Math.max(sx, sz),
        height: Math.max(sy, 0.4),
      }
    },
    [],
  )

  /**
   * 适应视图：按实际内容包围盒取景。
   * 顺序很重要 —— 先放宽半径 limit 再写 radius，否则会被上一个户型的旧 limit 截断。
   */
  const fitView = useCallback(
    (opts?: { silent?: boolean }) => {
      const host = hostRef.current
      if (!host) return false
      const bounds = contentBounds()
      if (!bounds) {
        if (!opts?.silent) toast('场景里还没有可适配的对象')
        return false
      }
      setRadiusLimits(host, bounds.diagonal)
      // 按真实视场算距离：宽高比从引擎拿，fov 用相机当前值（Babylon 默认 0.8）
      const engine = host.engine
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight())
      const radius = fitDistanceForBox({
        width: bounds.width,
        height: bounds.height,
        fov: host.camera.fov,
        aspect,
        padding: 1.15,
      })
      const next: OrbitPose = {
        alpha: host.camera.alpha,
        beta: FIT_BETA,
        radius,
        target: { x: bounds.center[0], y: bounds.center[1], z: bounds.center[2] },
      }
      applyCameraPose(host, next)
      poseRef.current = next
      setPose(next)
      return true
    },
    [contentBounds, toast],
  )

  /** 俯视：保留当前方位角，只把仰角推到接近正上方 */
  const toTopView = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const cur = readCameraPose(host)
    const next: OrbitPose = { ...cur, beta: degToRad(6) }
    applyCameraPose(host, next)
    poseRef.current = next
    setPose(next)
  }, [])

  /** 正视：仰角回到水平，并转到从 +Z 看向 -Z（面朝北墙，与预设户型朝向一致） */
  const toFrontView = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const cur = readCameraPose(host)
    const next: OrbitPose = { ...cur, alpha: -Math.PI / 2, beta: Math.PI / 2 }
    applyCameraPose(host, next)
    poseRef.current = next
    setPose(next)
  }, [])
  fitViewRef.current = fitView

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let alive = true
    setReady(false)
    void createBabylonHost(canvas)
      .then((host) => {
        if (!alive) {
          host.dispose()
          return
        }
        hostRef.current = host
        setReady(true)
      })
      .catch((e) => {
        if (!alive) return
        toast((e as Error).message || '三维引擎启动失败')
      })
    return () => {
      alive = false
      meshSyncGenRef.current += 1
      void hideInspector().finally(() => {
        gizmoRef.current?.dispose()
        gizmoRef.current = null
        try {
          hostRef.current?.dispose()
        } catch {
          /* 视口可能已失去 WebGL 上下文 */
        }
        hostRef.current = null
        setReady(false)
      })
    }
  }, [toast])

  useEffect(() => {
    const host = hostRef.current
    if (!ready || !host) return
    let disposed = false
    void createGizmoSelection(host.scene, {
      onSelect: (id) => {
        if (!disposed) setSelectedId(id)
      },
      onTransformEnd: (id, transform) => applyObjectTransform(id, transform),
      isLocked: isObjectLocked,
    }).then((ctrl) => {
      if (disposed) {
        ctrl.dispose()
        return
      }
      gizmoRef.current = ctrl
      if (selectedIdRef.current) ctrl.selectById(selectedIdRef.current)
    })
    return () => {
      disposed = true
      gizmoRef.current?.dispose()
      gizmoRef.current = null
    }
  }, [ready, applyObjectTransform, isObjectLocked])

  useEffect(() => {
    const host = hostRef.current
    if (!ready || !host) return
    void applyMaterial3dEnvironment(host.scene, host.envHandles, sceneDoc.environment)
  }, [ready, sceneDoc.environment])


  useEffect(() => {
    if (!inspectorOpen) {
      void hideInspector()
      return
    }
    if (!ready) return
    let cancelled = false
    const mountInspector = () => {
      if (cancelled) return
      const host = hostRef.current
      const hostEl = inspectorHostRef.current
      if (!host || !hostEl) {
        requestAnimationFrame(mountInspector)
        return
      }
      void showEmbeddedInspector(host.scene, hostEl, {
        showExplorer: inspectorShowExplorer,
        initialTab: inspectorTab,
      }).then(() => {
        if (!cancelled) void syncInspectorSelection(host.scene, selectedIdRef.current)
      })
    }
    mountInspector()
    return () => {
      cancelled = true
    }
  }, [ready, inspectorOpen, inspectorShowExplorer, inspectorTab])

  const openInspectorPopup = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    void popupFullInspector(host.scene, {
      showExplorer: inspectorShowExplorer,
      initialTab: inspectorTab,
    })
  }, [inspectorShowExplorer, inspectorTab])

  useEffect(() => {
    if (!ready || !inspectorOpen) return
    const host = hostRef.current
    if (!host) return
    void syncInspectorSelection(host.scene, selectedId)
  }, [ready, inspectorOpen, selectedId])

  useEffect(() => {
    if (!ready) return
    void refreshMeshes()
  }, [ready, refreshMeshes])

  const patchScene = (patch: Partial<Material3dScene>) => {
    const next: Material3dScene = {
      ...sceneDoc,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    onSceneChange(next)
  }

  const patchObject = (objectId: string, patch: Partial<Material3dObject>) => {
    const objects = sceneDoc.objects.map((o) =>
      o.id === objectId ? ({ ...o, ...patch } as Material3dObject) : o,
    )
    patchScene({ objects })
    if ('billboardSize' in patch) void refreshMeshes()
    if ('locked' in patch) gizmoRef.current?.selectById(selectedIdRef.current)
  }

  const addBillboard = (designId: string) => {
    const design = designs.find((d) => d.id === designId)
    if (!design) return
    try {
      const obj = createBillboardObject(design, missing, {
        ...DEFAULT_TRANSFORM,
        position: { x: (sceneDoc.objects.length % 4) * 2 - 3, y: 0, z: (sceneDoc.objects.length % 3) * 2 - 2 },
      })
      const designRefs = sceneDoc.designRefs.includes(designId)
        ? sceneDoc.designRefs
        : [...sceneDoc.designRefs, designId]
      patchScene({ objects: [...sceneDoc.objects, obj], designRefs })
      setRailTab('compose')
      setSelectedId(obj.id)
      try {
        resolveDesignBillboardUrl(design, missing)
      } catch {
        /* 已在 create 校验 */
      }
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const addGltf = (assetUrl: string) => {
    const url = assetUrl.split('?')[0]
    if (!isGltfAssetUrl(url)) {
      toast('仅支持项目素材、CC0 或 itch 本地道具')
      return
    }
    const obj: Material3dGltfObject = {
      id: newMaterial3dObjectId(),
      kind: 'gltf',
      assetUrl: url,
      transform: {
        ...DEFAULT_TRANSFORM,
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }
    patchScene({ objects: [...sceneDoc.objects, obj] })
    setRailTab('compose')
    setSelectedId(obj.id)
  }

  const importItchToAssets = async (prop: ItchPropEntry) => {
    if (!projectName) return
    setImportingProp(true)
    try {
      toast('正在写入项目素材（itch 本地包）…')
      const row = await importItchPropToProject({
        project: projectName,
        url: prop.url,
        title: prop.title,
      })
      const nextAssets: ProjectAsset[] = [
        ...assets,
        { kind: row.kind, title: row.title, url: row.url, note: row.note || 'itch-local-pack' },
      ]
      await patchProject(projectName, { assets: nextAssets })
      onAssetsAppended?.(nextAssets)
      toast(`已加入项目素材：${row.title}`)
    } catch (e) {
      toast((e as Error).message || '导入失败')
    } finally {
      setImportingProp(false)
    }
  }

  const filterProps = useCallback(
    <T extends { id: string; title: string; categories?: string[]; pack?: string }>(list: T[]) => {
      const q = propQuery.trim().toLowerCase()
      if (!q) return list
      return list.filter((p) => {
        if ('pack' in p && String(p.pack || '').toLowerCase().includes(q)) return true
        if (p.id.toLowerCase().includes(q)) return true
        if (p.title.toLowerCase().includes(q)) return true
        if ((p.categories || []).some((c) => c.toLowerCase().includes(q))) return true
        if ('url' in p && 'source' in p && (p as Cc0PropEntry).source === 'polyhaven') {
          return cc0PropSearchHaystack(p as Cc0PropEntry).includes(q)
        }
        return false
      })
    },
    [propQuery],
  )

  const isCharacterProp = useCallback(
    (p: Cc0PropEntry) => (p.categories || []).includes('characters'),
    [],
  )
  const isAnimalProp = useCallback(
    (p: Cc0PropEntry) => (p.categories || []).includes('animals'),
    [],
  )
  const characterProps = useMemo(() => cc0Props.filter(isCharacterProp), [cc0Props, isCharacterProp])
  const animalProps = useMemo(() => cc0Props.filter(isAnimalProp), [cc0Props, isAnimalProp])
  // 家具目录要同时排除人形与动物：两者各有自己的 tab
  const furnitureProps = useMemo(
    () => cc0Props.filter((p) => !isCharacterProp(p) && !isAnimalProp(p)),
    [cc0Props, isCharacterProp, isAnimalProp],
  )
  /** 家具目录里 Grab3D 的补库件（轻量 PBR），与 Poly Haven 写实件分开展示 */
  const furnitureGapFillProps = useMemo(
    () => furnitureProps.filter((p) => p.source === 'grab3d'),
    [furnitureProps],
  )
  const characterFiltered = useMemo(() => filterProps(characterProps), [characterProps, filterProps])
  const animalFiltered = useMemo(() => filterProps(animalProps), [animalProps, filterProps])
  const itchFiltered = useMemo(() => filterProps(itchProps), [itchProps, filterProps])
  /** Poly Haven 没有 group 字段，按品类推导；Grab3D 侧直接用清单里的 group */
  const furnitureGroupOf = useCallback((p: Cc0PropEntry): string => {
    if (p.group) return p.group
    // Poly Haven 的品类偶尔不准：Modern Wooden Cabinet 被标成 table，实际是柜子
    const groups: Record<string, string> = {
      modern_wooden_cabinet: 'storage',
      drawer_cabinet: 'storage',
      CoffeeCart_01: 'kitchen',
      modular_street_seating: 'seat',
    }
    if (groups[p.id]) return groups[p.id]
    const cats = p.categories || []
    if (cats.includes('seating')) return 'seat'
    if (cats.includes('bed')) return 'bed'
    if (cats.includes('table')) return 'table'
    if (cats.includes('shelves')) return 'storage'
    return 'other'
  }, [])
  const furnitureGroupCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of furnitureProps) {
      const g = furnitureGroupOf(p)
      out[g] = (out[g] || 0) + 1
    }
    return out
  }, [furnitureProps, furnitureGroupOf])
  const cc0Filtered = useMemo(() => {
    const scoped = furnitureGroup
      ? furnitureProps.filter((p) => furnitureGroupOf(p) === furnitureGroup)
      : furnitureProps
    return filterProps(scoped)
  }, [furnitureProps, furnitureGroup, furnitureGroupOf, filterProps])

  const importCc0ToAssets = async (prop: Cc0PropEntry) => {
    if (!projectName) return
    setImportingProp(true)
    try {
      toast('正在下载并写入项目素材（Poly Haven CC0）…')
      const displayTitle = cc0PropDisplayTitle(prop)
      const row = await importCc0PropToProject({
        project: projectName,
        url: prop.url,
        title: displayTitle,
      })
      const nextAssets: ProjectAsset[] = [
        ...assets,
        { kind: row.kind, title: row.title, url: row.url, note: row.note || 'cc0-polyhaven' },
      ]
      await patchProject(projectName, { assets: nextAssets })
      onAssetsAppended?.(nextAssets)
      toast(`已加入项目素材：${row.title}`)
    } catch (e) {
      toast((e as Error).message || '导入 CC0 道具失败')
    } finally {
      setImportingProp(false)
    }
  }

  const defaultCameraSnap = (): Omit<Material3dBookmark, 'id' | 'label'> => ({
    alpha: -Math.PI / 2,
    beta: Math.PI / 2.5,
    radius: 10,
    target: { x: 0, y: 1, z: 0 },
  })

  const saveBookmark = () => {
    const host = hostRef.current
    const snap = host ? snapshotCamera(host) : defaultCameraSnap()
    const bookmark: Material3dBookmark = {
      id: newBookmarkId(),
      label: bookmarkLabel.trim() || `机位 ${sceneDoc.cameras.length + 1}`,
      ...snap,
    }
    patchScene({ cameras: [...sceneDoc.cameras, bookmark] })
    toast(`已保存机位「${bookmark.label}」`)
  }

  const removeBookmark = (id: string) => {
    patchScene({ cameras: sceneDoc.cameras.filter((c) => c.id !== id) })
  }

  const restoreBookmark = (id: string) => {
    const host = hostRef.current
    if (!host) return
    const b = sceneDoc.cameras.find((c) => c.id === id)
    if (!b) return
    applyBookmark(host, b)
  }

  const removeObject = (id: string) => {
    patchScene({ objects: sceneDoc.objects.filter((o) => o.id !== id) })
    if (selectedId === id) selectObject(null)
  }

  const copyStoryboardMarkdown = async () => {
    const md = buildStoryboardMarkdown(sceneDoc, designs)
    try {
      await navigator.clipboard.writeText(md)
      toast('分镜说明已复制到剪贴板')
    } catch {
      toast('复制失败，请检查浏览器权限')
    }
  }

  const exportStoryboardJson = () => {
    downloadStoryboardJson(sceneDoc, designs)
    toast('已下载 storyboard JSON')
  }

  const onEnvironmentChange = (environment: Material3dEnvironment) => {
    patchScene({ environment })
  }

  const exportScreenshot = async () => {
    const host = hostRef.current
    if (!host || !projectName) return
    setSavingShot(true)
    try {
      const blob = await captureViewportPng(host.engine, host.camera)
      const dataUrl = await blobToDataUrl(blob)
      const file = new File([blob], `m3d-${Date.now()}.png`, { type: 'image/png' })
      const url = await uploadImageFile(file, { project: projectName, prefix: 'm3d-shot' })
      void dataUrl
      const title = `三维截图 · ${sceneDoc.name}`
      const nextAssets: ProjectAsset[] = [
        ...assets,
        { kind: 'image', title, url, note: 'material3d-viewport' },
      ]
      await patchProject(projectName, { assets: nextAssets })
      onAssetsAppended?.(nextAssets)
      toast('视口截图已写入项目素材（未自动发布画布卡）')
    } catch (e) {
      toast((e as Error).message || '截图失败')
    } finally {
      setSavingShot(false)
    }
  }

  return (
    <div className="m3d-workbench" data-m3d-workbench data-m3d-workbench-ready={ready ? 'true' : undefined}>
      <header className="m3d-command-bar">
        <div className="m3d-command-primary">
          <button type="button" className="m3d-back" onClick={onClose}>
            ← 场景列表
          </button>
          <input
            className="m3d-scene-name"
            aria-label="场景名称"
            value={sceneDoc.name}
            onChange={(e) => patchScene({ name: e.target.value })}
          />
          <div className="m3d-stat-chips" aria-label="场景统计">
            <span className="m3d-chip-stat">{sceneDoc.objects.length} 对象</span>
            <span className="m3d-chip-stat">{sceneDoc.cameras.length} 机位</span>
            {!ready ? <span className="m3d-chip-stat m3d-chip-stat--muted">视口加载中…</span> : null}
          </div>
        </div>
        <nav className="m3d-workflow-steps" aria-label="分镜工作流">
          <button type="button" className={railTab === 'library' ? 'on' : undefined} onClick={() => setRailTab('library')}>
            ① 素材
          </button>
          <button type="button" className={railTab === 'compose' ? 'on' : undefined} onClick={() => setRailTab('compose')}>
            ② 编排
          </button>
          <button type="button" className={railTab === 'shot' ? 'on' : undefined} onClick={() => setRailTab('shot')}>
            ③ 分镜
          </button>
        </nav>
        <div className="m3d-command-actions">
          <button type="button" className="btn-ghost" disabled={!ready || savingShot} onClick={() => void exportScreenshot()}>
            {savingShot ? '导出中…' : '视口截图'}
          </button>
        </div>
      </header>

      <div className="m3d-body">
        <aside className="m3d-rail m3d-rail--split">
          <nav className="m3d-rail-nav" aria-label="侧栏面板">
            <button
              type="button"
              className={railTab === 'library' ? 'on' : undefined}
              data-m3d-rail="library"
              onClick={() => setRailTab('library')}
            >
              <span className="m3d-rail-nav-title">素材库</span>
              <span className="m3d-rail-nav-hint">立板与模型</span>
            </button>
            <button
              type="button"
              className={railTab === 'compose' ? 'on' : undefined}
              data-m3d-rail="compose"
              onClick={() => setRailTab('compose')}
            >
              <span className="m3d-rail-nav-title">编排</span>
              {sceneDoc.objects.length ? <span className="m3d-rail-nav-badge">{sceneDoc.objects.length}</span> : null}
            </button>
            <button
              type="button"
              className={railTab === 'shot' ? 'on' : undefined}
              data-m3d-rail="shot"
              onClick={() => setRailTab('shot')}
            >
              <span className="m3d-rail-nav-title">分镜</span>
              {sceneDoc.cameras.length ? <span className="m3d-rail-nav-badge">{sceneDoc.cameras.length}</span> : null}
            </button>
            <button
              type="button"
              className={railTab === 'debug' ? 'on' : undefined}
              data-m3d-rail="debug"
              onClick={() => setRailTab('debug')}
            >
              <span className="m3d-rail-nav-title">调试</span>
            </button>
          </nav>
          <div className="m3d-rail-body">
            {railTab === 'library' ? (
              <Material3dAddPanel
                designOptions={designOptions}
                gltfAssets={gltfAssets}
                cc0Props={cc0Props}
                itchProps={itchProps}
                cc0Filtered={cc0Filtered}
                characterFiltered={characterFiltered}
                animalFiltered={animalFiltered}
                furnitureGapFillCount={furnitureGapFillProps.length}
                furnitureReady={furnitureReady}
                furnitureGroup={furnitureGroup}
                onFurnitureGroup={setFurnitureGroup}
                furnitureGroupCounts={furnitureGroupCounts}
                itchFiltered={itchFiltered}
                charactersReady={charactersReady}
                animalsReady={animalsReady}
                propSource={propSource}
                onPropSource={setPropSource}
                propQuery={propQuery}
                onPropQuery={setPropQuery}
                samplesReady={samplesReady}
                itchVendorReady={itchVendorReady}
                importingProp={importingProp}
                onAddBillboard={addBillboard}
                onAddGltf={addGltf}
                onImportCc0={(p) => void importCc0ToAssets(p)}
                onImportItch={(p) => void importItchToAssets(p)}
              />
            ) : null}
            {railTab === 'compose' ? (
              <Material3dHierarchyPanel
                objects={sceneDoc.objects}
                designs={designs}
                selectedId={selectedId}
                onSelect={selectObject}
                onRemove={removeObject}
                onPatchObject={patchObject}
                onTransformChange={handleTransformChange}
                onOpenLibrary={() => setRailTab('library')}
                onOpenDebug={() => {
                  setRailTab('debug')
                  setInspectorOpen(true)
                }}
              />
            ) : null}
            {railTab === 'shot' ? (
              <Material3dShotPanel
                environment={sceneDoc.environment}
                cameras={sceneDoc.cameras}
                bookmarkLabel={bookmarkLabel}
                pose={pose}
                onEnvironmentChange={onEnvironmentChange}
                onBookmarkLabel={setBookmarkLabel}
                onPoseChange={applyPoseFromSlider}
                onSliderActive={setSliderActive}
                onFitView={() => {
                  fitView()
                }}
                onTopView={toTopView}
                onFrontView={toFrontView}
                onSave={saveBookmark}
                onRestore={restoreBookmark}
                onRemove={removeBookmark}
                onCopyMarkdown={() => void copyStoryboardMarkdown()}
                onExportJson={exportStoryboardJson}
              />
            ) : null}
            {railTab === 'debug' ? (
              <Material3dDebugPanel
                inspectorOpen={inspectorOpen}
                inspectorShowExplorer={inspectorShowExplorer}
                inspectorTab={inspectorTab}
                onToggleInspector={() => setInspectorOpen((v) => !v)}
                onInspectorShowExplorer={setInspectorShowExplorer}
                onInspectorTab={setInspectorTab}
                onInspectorPopup={openInspectorPopup}
                inspectorHostRef={inspectorHostRef}
              />
            ) : null}
          </div>
        </aside>
        <div className="m3d-stage">
          <canvas ref={canvasRef} className="m3d-canvas" data-m3d-canvas />
          <div className="m3d-viewport-hud" aria-hidden>
            <div className="m3d-viewport-hud-row">
              <span>左键旋转 · 滚轮缩放 · 中键/Ctrl+左键平移 · 点选对象后 Gizmo 移动</span>
            </div>
            {selectedId ? (
              <div className="m3d-viewport-hud-row">
                <span className="m3d-viewport-hud-strong">已选中对象</span>
                <button type="button" className="btn-mini ghost" onClick={() => setRailTab('compose')}>
                  在编排中编辑
                </button>
              </div>
            ) : sceneDoc.objects.length === 0 ? (
              <div className="m3d-viewport-hud-row">
                <span className="m3d-viewport-hud-strong">从「素材库」放入第一个对象</span>
                <button type="button" className="btn-mini primary" onClick={() => setRailTab('library')}>
                  打开素材库
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}