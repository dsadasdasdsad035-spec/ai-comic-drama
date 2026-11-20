import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { getProject, patchProject, type DesignSheet, type ProjectAsset, type ProjectData } from '../api'
import { newMaterial3dScene, type Material3dScene } from './material3dTypes'

const LazyMaterial3dWorkbench = lazy(() => import('./Material3dWorkbench'))

type Props = {
  projectName: string
  designs: DesignSheet[]
  missing: Set<string>
  onScenesCountChange?: (count: number) => void
  toast: (m: string) => void
}

function formatUpdated(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  }, [projectName, toast, onScenesCountChange])

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

  const createAndOpen = () => {
    const s = newMaterial3dScene()
    const next = [...scenes, s]
    setScenes(next)
    setOpenId(s.id)
    void persistScenes(next).catch((e) => toast((e as Error).message || '保存失败'))
  }

  if (!projectName) {
    return <div className="char-empty-board">先在顶栏选择项目，再使用场景三维工作台。</div>
  }

  if (openScene) {
    return (
      <Suspense fallback={<div className="char-empty-board">正在加载三维工作台…</div>}>
        <LazyMaterial3dWorkbench
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
      </Suspense>
    )
  }

  return (
    <div className="m3d-studio" data-material3d-studio>
      <header className="m3d-studio-hero">
        <div>
          <h3 className="m3d-studio-title">场景三维</h3>
          <p className="board-hint m3d-studio-lede">
            浏览器内摆放设定立板与 GLB，保存机位书签；导出 PNG 可作分镜参考，成片仍在 Blender 三维专家。
          </p>
          <ol className="m3d-studio-steps">
            <li>① 新建场景</li>
            <li>② 素材库摆放</li>
            <li>③ 分镜机位导出</li>
          </ol>
        </div>
        <button type="button" className="btn primary" data-m3d-new-scene disabled={!ready} onClick={createAndOpen}>
          新建三维场景
        </button>
      </header>

      {scenes.length === 0 ? (
        <button type="button" className="m3d-studio-empty" disabled={!ready} onClick={createAndOpen}>
          <strong>还没有三维场景</strong>
          <span>创建后从「素材库」加入立板、人形或家具，再在「分镜」保存机位</span>
        </button>
      ) : (
        <ul className="m3d-scene-grid">
          {scenes.map((s) => (
            <li key={s.id}>
              <article
                className="m3d-scene-card"
                data-m3d-scene-card={s.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenId(s.id)
                  }
                }}
              >
                <div className="m3d-scene-card-top">
                  <input
                    className="m3d-scene-card-name"
                    value={s.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateScene(s.id, { ...s, name: e.target.value, updatedAt: new Date().toISOString() })
                    }
                  />
                  {formatUpdated(s.updatedAt) ? (
                    <time className="m3d-scene-card-time">{formatUpdated(s.updatedAt)}</time>
                  ) : null}
                </div>
                <p className="m3d-scene-card-stats">
                  <span>{s.objects.length} 对象</span>
                  <span>{s.cameras.length} 机位</span>
                </p>
                <div className="m3d-card-actions" onClick={(e) => e.stopPropagation()}>
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
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}