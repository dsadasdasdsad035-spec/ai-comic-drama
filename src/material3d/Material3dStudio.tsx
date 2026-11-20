import { useCallback, useEffect, useRef, useState } from 'react'
import { getProject, patchProject, type DesignSheet, type ProjectAsset, type ProjectData } from '../api'
import Material3dWorkbench from './Material3dWorkbench'
import { newMaterial3dScene, type Material3dScene } from './material3dTypes'

type Props = {
  projectName: string
  designs: DesignSheet[]
  missing: Set<string>
  onScenesCountChange?: (count: number) => void
  toast: (m: string) => void
}

export default function Material3dStudio({ projectName, designs, missing, onScenesCountChange, toast }: Props) {
  const [scenes, setScenes] = useState<Material3dScene[]>([])
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [ready, setReady] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const savedSig = useRef('')

  const load = useCallback(async () => {
    if (!projectName) {
      setScenes([])
      setAssets([])
      setReady(false)
      return
    }
    try {
      const p: ProjectData = await getProject(projectName)
      const list = (p.material3dScenes ?? []) as Material3dScene[]
      setScenes(list)
      setAssets(p.assets ?? [])
      savedSig.current = JSON.stringify(list)
      onScenesCountChange?.(list.length)
      setReady(true)
    } catch (e) {
      toast((e as Error).message || '读取三维场景失败')
      setReady(false)
    }
  }, [projectName, toast])

  useEffect(() => {
    setOpenId(null)
    void load()
  }, [load])

  useEffect(() => {
    if (!projectName || !ready) return
    const sig = JSON.stringify(scenes)
    if (sig === savedSig.current) return
    const t = window.setTimeout(() => {
      savedSig.current = sig
      patchProject(projectName, { material3dScenes: scenes }).catch((e) => {
        toast((e as Error).message || '保存三维场景失败')
      })
    }, 600)
    return () => window.clearTimeout(t)
  }, [scenes, projectName, ready, toast])

  useEffect(() => {
    onScenesCountChange?.(scenes.length)
  }, [scenes.length, onScenesCountChange])

  const persistScenes = useCallback(
    (next: Material3dScene[]) => {
      if (!projectName) return Promise.resolve()
      savedSig.current = JSON.stringify(next)
      return patchProject(projectName, { material3dScenes: next })
    },
    [projectName],
  )

  const updateScene = (id: string, next: Material3dScene, opts?: { immediate?: boolean }) => {
    setScenes((prev) => {
      const merged = prev.map((s) => (s.id === id ? next : s))
      if (opts?.immediate) {
        void persistScenes(merged).catch((e) => toast((e as Error).message || '保存三维场景失败'))
      }
      return merged
    })
  }

  const openScene = scenes.find((s) => s.id === openId) ?? null

  if (!projectName) {
    return <div className="char-empty-board">先在顶栏选择项目，再使用场景三维工作台。</div>
  }

  if (openScene) {
    return (
      <Material3dWorkbench
        key={openScene.id}
        projectName={projectName}
        sceneDoc={openScene}
        designs={designs}
        assets={assets}
        missing={missing}
        onSceneChange={(next) => updateScene(openScene.id, next, { immediate: true })}
        onClose={() => setOpenId(null)}
        onAssetsAppended={setAssets}
        toast={toast}
      />
    )
  }

  return (
    <div className="m3d-studio" data-material3d-studio>
      <div className="m3d-studio-head">
        <p className="board-hint">
          浏览器内编排场景/道具参考与 GLB；CC0 道具见工作台侧栏。机位书签保存在项目中。成片渲染仍在创意 Blender 专家。
        </p>
        <button
          type="button"
          className="btn primary"
          data-m3d-new-scene
          disabled={!ready}
          onClick={() => {
            const s = newMaterial3dScene()
            const next = [...scenes, s]
            setScenes(next)
            setOpenId(s.id)
            void persistScenes(next).catch((e) => toast((e as Error).message || '保存失败'))
          }}
        >
          新建三维场景
        </button>
      </div>
      <div className="char-grid">
        {scenes.length === 0 ? (
          <div className="char-empty-board">还没有三维场景，点「新建三维场景」开始。</div>
        ) : (
          scenes.map((s) => (
            <div key={s.id} className="char-card m3d-scene-card" data-m3d-scene-card={s.id}>
              <div className="char-card-head">
                <input
                  className="wb-field"
                  value={s.name}
                  onChange={(e) =>
                    updateScene(s.id, { ...s, name: e.target.value, updatedAt: new Date().toISOString() })
                  }
                />
              </div>
              <p className="board-hint">
                {s.objects.length} 个对象 · {s.cameras.length} 个机位
              </p>
              <div className="m3d-card-actions">
                <button type="button" className="btn primary" onClick={() => setOpenId(s.id)}>
                  打开工作台
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    if (!window.confirm(`删除「${s.name}」？`)) return
                    setScenes((prev) => prev.filter((x) => x.id !== s.id))
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}