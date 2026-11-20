import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cc0PropEntry, DesignSheet, ProjectAsset } from '../api'
import { fetchCc0PropsManifest, importCc0PropToProject, patchProject } from '../api'
import { isGltfAssetUrl } from './isGltfAssetUrl'
import { uploadImageFile } from '../mediaUpload'
import { createBillboardObject, resolveDesignBillboardUrl } from './billboardFromDesign'
import { captureViewportPng, blobToDataUrl } from './captureViewport'
import { createBabylonHost, type BabylonHost } from './createEngine'
import { createGizmoSelection, type GizmoSelectionController } from './gizmoSelection'
import { hideInspector, showEmbeddedInspector, syncInspectorSelection } from './inspectorPane'
import { syncSceneFromDoc } from './syncSceneFromDoc'
import {
  DEFAULT_TRANSFORM,
  newBookmarkId,
  newMaterial3dObjectId,
  type Material3dBookmark,
  type Material3dGltfObject,
  type Material3dScene,
  type Material3dTransform,
} from './material3dTypes'

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
  const [cc0Props, setCc0Props] = useState<Cc0PropEntry[]>([])
  const [cc0Filter, setCc0Filter] = useState('')
  const [samplesReady, setSamplesReady] = useState(false)
  const [importingProp, setImportingProp] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
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
    void fetchCc0PropsManifest()
      .then((cc0) => {
        if (!alive) return
        setCc0Props(cc0.samples ?? [])
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
        },
      })
    } catch (e) {
      if (isCancelled()) return
      toast((e as Error).message || '同步场景失败')
    }
  }, [sceneDoc, designs, missing, toast])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let alive = true
    setReady(false)
    void createBabylonHost(canvas).then((host) => {
      if (!alive) {
        host.dispose()
        return
      }
      hostRef.current = host
      setReady(true)
    })
    return () => {
      alive = false
      meshSyncGenRef.current += 1
      void hideInspector()
      gizmoRef.current?.dispose()
      gizmoRef.current = null
      hostRef.current?.dispose()
      hostRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!ready || !host) return
    let disposed = false
    void createGizmoSelection(host.scene, {
      onSelect: (id) => {
        if (!disposed) setSelectedId(id)
      },
      onTransformEnd: (id, transform) => applyObjectTransform(id, transform),
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
  }, [ready, applyObjectTransform])

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
      void showEmbeddedInspector(host.scene, hostEl).then(() => {
        if (!cancelled) void syncInspectorSelection(host.scene, selectedIdRef.current)
      })
    }
    mountInspector()
    return () => {
      cancelled = true
    }
  }, [ready, inspectorOpen])

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
      toast('仅支持项目素材或 CC0 道具')
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
  }

  const cc0Filtered = useMemo(() => {
    const q = cc0Filter.trim().toLowerCase()
    if (!q) return cc0Props
    return cc0Props.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.categories || []).some((c) => c.toLowerCase().includes(q)),
    )
  }, [cc0Props, cc0Filter])

  const importCc0ToAssets = async (prop: Cc0PropEntry) => {
    if (!projectName) return
    setImportingProp(true)
    try {
      toast('正在下载并写入项目素材（Poly Haven CC0）…')
      const row = await importCc0PropToProject({
        project: projectName,
        url: prop.url,
        title: prop.title,
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
    <div className="m3d-workbench">
      <div className="m3d-toolbar board-hint">
        <span>
          <b>{sceneDoc.name}</b> · 编排/机位在此；成片 MP4 请用创意 → Blender 三维专家
        </span>
        <span className="m3d-toolbar-actions">
          <button type="button" className="btn-ghost" disabled={!ready || savingShot} onClick={() => void exportScreenshot()}>
            {savingShot ? '导出中…' : '导出视口 PNG'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            返回列表
          </button>
        </span>
      </div>
      <div className="m3d-body">
        <aside className="m3d-side">
          <h4>设定立板</h4>
          <select
            className="wb-field"
            data-m3d-design-select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              addBillboard(v)
              e.target.value = ''
            }}
          >
            <option value="">选择场景/道具卡…</option>
            {designOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.kind === 'scene' ? '场景' : '道具'} · {d.name}
              </option>
            ))}
          </select>
          <h4>GLB / glTF</h4>
          <select
            className="wb-field"
            data-m3d-gltf-select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              addGltf(v)
              e.target.value = ''
            }}
          >
            <option value="">从项目素材选择…</option>
            {gltfAssets.map((a, i) => (
              <option key={`${a.url}-${i}`} value={a.url}>
                {a.title || a.url.split('/').pop()}
              </option>
            ))}
          </select>
          <h4>CC0 道具库（Poly Haven）</h4>
          <p className="board-hint m3d-hint">
            {!samplesReady
              ? '加载目录…'
              : cc0Props.length
                ? `${cc0Props.length} 个家具/道具 · CC0 · 首次加入场景会拉取 glTF 包`
                : '无目录：npm run sync:cc0-props'}
          </p>
          <input
            className="wb-field"
            type="search"
            placeholder="搜索椅子、桌子…"
            value={cc0Filter}
            onChange={(e) => setCc0Filter(e.target.value)}
            disabled={!cc0Props.length}
          />
          <select
            className="wb-field"
            data-m3d-cc0-select
            defaultValue=""
            disabled={!cc0Filtered.length}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              addGltf(v)
              e.target.value = ''
            }}
          >
            <option value="">选 CC0 道具加入场景…</option>
            {cc0Filtered.map((p) => (
              <option key={p.id} value={p.url}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            className="wb-field"
            data-m3d-cc0-import-select
            defaultValue=""
            disabled={!cc0Filtered.length || importingProp}
            onChange={(e) => {
              const id = e.target.value
              e.target.value = ''
              if (!id) return
              const prop = cc0Props.find((p) => p.id === id)
              if (prop) void importCc0ToAssets(prop)
            }}
          >
            <option value="">复制到项目素材…</option>
            {cc0Filtered.map((p) => (
              <option key={`import-cc0-${p.id}`} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <h4>对象 ({sceneDoc.objects.length})</h4>
          <p className="board-hint m3d-hint">点选视口或列表中的对象，用 Gizmo 拖动；位移会写入场景数据。</p>
          <ul className="m3d-list" data-m3d-object-list>
            {sceneDoc.objects.map((o) => (
              <li key={o.id} className={selectedId === o.id ? 'm3d-list-selected' : undefined}>
                <button
                  type="button"
                  className="m3d-object-pick"
                  data-m3d-object-item={o.id}
                  onClick={() => selectObject(o.id)}
                >
                  {o.kind === 'billboard' ? `立板 ${o.designId}` : `模型 ${o.assetUrl.split('/').pop()}`}
                </button>
                <button type="button" className="btn-mini ghost" onClick={() => removeObject(o.id)}>
                  删
                </button>
              </li>
            ))}
          </ul>
          <h4>检视器</h4>
          <button
            type="button"
            className="btn-ghost"
            data-m3d-inspector-toggle
            onClick={() => setInspectorOpen((v) => !v)}
          >
            {inspectorOpen ? '收起属性检视' : '打开属性检视'}
          </button>
          <div
            ref={inspectorHostRef}
            className="m3d-inspector-host"
            data-m3d-inspector-host
            style={{ display: inspectorOpen ? 'block' : 'none' }}
          />
          <h4>机位书签</h4>
          <div className="m3d-bookmark-row">
            <input
              className="wb-field"
              value={bookmarkLabel}
              onChange={(e) => setBookmarkLabel(e.target.value)}
              placeholder="机位名称"
              data-m3d-bookmark-label
            />
            <button type="button" className="btn-ghost" data-m3d-save-bookmark onClick={saveBookmark}>
              保存当前机位
            </button>
          </div>
          <ul className="m3d-list" data-m3d-bookmark-list>
            {sceneDoc.cameras.map((c) => (
              <li key={c.id}>
                <button type="button" className="btn-mini" onClick={() => restoreBookmark(c.id)}>
                  {c.label}
                </button>
                <button type="button" className="btn-mini ghost" onClick={() => removeBookmark(c.id)}>
                  删
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <canvas ref={canvasRef} className="m3d-canvas" data-m3d-canvas />
      </div>
    </div>
  )
}