import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  getProject,
  mergeProjectShots,
  type AppSettings,
  type ProjectAsset,
  type ProjectShot,
  type Stage,
} from './api'
import { toSheet, type ProjectChar } from './charMap'
import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import { StageModelSelect, type StagePick } from './ModelSelect'
import { dialogueToText } from './prompts'
import { shotToData } from './shotSync'
import { shot3DRenderPatch, shot3DSavePatch } from './shot3dPatch'
import ShotPicker from './ShotPicker'
import WorkbenchBar from './WorkbenchBar'
import { resolveShotSchedule } from './scheduleStatus'
import type { SceneLayout, ShotData } from './types'
import type { CodeEditorRendered, CodeEditorSave } from './SceneCodeWorkbench'

const LazySceneCodeWorkbench = lazy(() => import('./SceneCodeWorkbench'))

function baseShotData(s: ProjectShot): ShotData {
  return {
    no: s.no ?? '',
    seconds: Number(s.seconds) || 3,
    size: s.size ?? '中景',
    move: s.move ?? '固定',
    dialogue:
      typeof s.dialogue === 'string' ? s.dialogue : dialogueToText(s.dialogue),
    prompt: s.keyframe_prompt || s.desc || '',
    marks: [],
  }
}

function codeShortLabel(s: ProjectShot): string {
  const hash =
    s.scene_code_meta?.codeHash ??
    (s.scene_code_meta as { code_hash?: string } | undefined)?.code_hash ??
    s.scene_code?.codeHash ??
    (s.scene_code as { code_hash?: string } | undefined)?.code_hash
  if (hash) return hash.length > 8 ? hash.slice(0, 8) : hash
  if (s.scene_code?.code?.trim()) return '已保存'
  return '无代码'
}

function motionLabel(s: ProjectShot): string {
  const note = (s.motion_note ?? s.scene_code?.motionNote ?? '').trim()
  return note || '—'
}

function sortShotsByNo(shots: ProjectShot[]): ProjectShot[] {
  return [...shots].sort((a, b) => {
    const na = (a.no ?? '').trim()
    const nb = (b.no ?? '').trim()
    if (na && nb) return na.localeCompare(nb, undefined, { numeric: true })
    return a.id.localeCompare(b.id)
  })
}

function projectShotNode(s: ProjectShot, existing?: ShotNodeType): ShotNodeType {
  const base = existing?.data ?? baseShotData(s)
  return {
    id: existing?.id ?? s.id,
    type: 'shot',
    position: existing?.position ?? { x: 0, y: 0 },
    data: shotToData(s, base),
  }
}

type Props = {
  projectName: string
  onCanvas: Set<string>
  toast: (m: string) => void
  epNo: number
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  canvasNodes: ShotNodeType[]
  assets: ProjectAsset[]
  sceneLayouts: SceneLayout[]
  projectAspect: string
  onEditorDirtyChange?: (dirty: boolean) => void
}

export default function Schedule3DBoard({
  projectName,
  onCanvas: _onCanvas,
  toast,
  epNo,
  settings,
  stagePick,
  onPickStage,
  canvasNodes,
  assets,
  sceneLayouts,
  projectAspect,
  onEditorDirtyChange,
}: Props) {
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [chars, setChars] = useState<CharacterSheet[]>([])
  const [loading, setLoading] = useState(false)
  const [editorShotId, setEditorShotId] = useState<string | null>(null)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)

  const load = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    try {
      const p = await getProject(projectName)
      setShots(p.shots ?? [])
      setChars(((p.characters ?? []) as ProjectChar[]).map(toSheet))
      toast(`已加载 ${projectName}：${(p.shots ?? []).length} 镜`)
    } catch (e: unknown) {
      const err = e as Error
      toast(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectName, toast])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  const visible = useMemo(
    () => sortShotsByNo(shots.filter((s) => (Number(s.episode) || 1) === epNo)),
    [shots, epNo],
  )

  const scheduleByShot = useMemo(() => {
    const out = new Map<string, ReturnType<typeof resolveShotSchedule>>()
    for (const s of visible) {
      out.set(
        s.id,
        resolveShotSchedule({
          data: shotToData(s, baseShotData(s)),
          shotId: s.id,
          sceneLayouts,
          projectAspect,
        }),
      )
    }
    return out
  }, [visible, sceneLayouts, projectAspect])

  const schedStat = useMemo(() => {
    let ok = 0
    let stale = 0
    let none = 0
    for (const s of visible) {
      const st = scheduleByShot.get(s.id)?.status
      if (st === '生效') ok++
      else if (st === '已过期' || st === '仅审阅') stale++
      else none++
    }
    return { ok, stale, none, total: visible.length }
  }, [visible, scheduleByShot])

  const pickerItems = useMemo(
    () =>
      visible.map((shot) => ({
        shot,
        status: scheduleByShot.get(shot.id)?.status ?? '未渲染',
      })),
    [visible, scheduleByShot],
  )

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedShotId(null)
      return
    }
    setSelectedShotId((prev) => (prev && visible.some((s) => s.id === prev) ? prev : visible[0].id))
  }, [epNo, visible])

  const selectedShot = selectedShotId
    ? visible.find((s) => s.id === selectedShotId) ?? null
    : null

  const editorShot = editorShotId ? shots.find((s) => s.id === editorShotId) ?? null : null
  const editorNodes = useMemo(() => {
    const canvasShotByProjectId = new Map<string, ShotNodeType>()
    for (const n of canvasNodes) {
      if (n.data.shotId) canvasShotByProjectId.set(n.data.shotId, n)
    }
    const out = canvasNodes.filter(
      (n) => (n as unknown as { type?: string }).type !== 'shot',
    )
    for (const s of visible) out.push(projectShotNode(s, canvasShotByProjectId.get(s.id)))
    return out
  }, [canvasNodes, visible])
  const editorNode = editorShot
    ? editorNodes.find((n) => n.data.shotId === editorShot.id) ?? null
    : null

  const handleEditorDirty = useCallback(
    (dirtyNow: boolean) => {
      setEditorDirty(dirtyNow)
      onEditorDirtyChange?.(dirtyNow)
    },
    [onEditorDirtyChange],
  )

  const close3D = () => {
    setEditorShotId(null)
    handleEditorDirty(false)
  }

  const open3D = (shotId: string) => {
    setEditorShotId(shotId)
    handleEditorDirty(false)
  }

  const pickShot = (shotId: string) => {
    if (shotId === selectedShotId) return
    if (editorShotId && editorDirty) {
      if (
        !window.confirm(
          '3D 工作台有未保存的代码修改，切换镜头会关闭编辑器并丢失未保存内容。继续？',
        )
      ) {
        return
      }
      close3D()
    }
    setSelectedShotId(shotId)
  }

  const persist3D = useCallback(
    async (shotId: string, patch: Partial<ProjectShot>) => {
      if (!projectName) throw new Error('先选择项目')
      const current = await getProject(projectName)
      const full = (current.shots ?? []).map((s) =>
        s.id === shotId ? ({ ...s, ...patch } as ProjectShot) : s,
      )
      if (!full.some((s) => s.id === shotId)) full.push({ id: shotId, ...patch } as ProjectShot)
      await mergeProjectShots(projectName, full)
      setShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, ...patch } : s)))
    },
    [projectName],
  )

  const saveEditor3D = async (input: CodeEditorSave) => {
    if (!editorShot) return
    await persist3D(editorShot.id, shot3DSavePatch(input))
  }

  const renderEditor3D = async (input: CodeEditorRendered) => {
    if (!editorShot) return
    await persist3D(
      editorShot.id,
      shot3DRenderPatch({ ...input, existingMotionNote: editorShot.motion_note }),
    )
  }

  const selectedSchedule = selectedShot ? scheduleByShot.get(selectedShot.id) : null
  const schedTag =
    selectedSchedule?.status === '生效'
      ? 'ok'
      : selectedSchedule?.status === '已过期'
        ? 'bad'
        : selectedSchedule?.status === '仅审阅'
          ? 'orphan'
          : 'off'

  return (
    <main className="wb">
      <WorkbenchBar
        scope={
          <>
            <span className="wb-bar-title">3D 调度</span>
            <ShotPicker items={pickerItems} shotId={selectedShotId} onSelect={pickShot} />
          </>
        }
        scopeDetail={
          <>
            {visible.length} 镜 · 生效 {schedStat.ok} · 待渲/过期{' '}
            <b className={schedStat.stale + schedStat.none > 0 ? 'over' : ''}>
              {schedStat.stale + schedStat.none}
            </b>
          </>
        }
        settings={
          <StageModelSelect
            stage="sceneCode"
            settings={settings}
            pick={stagePick}
            onChange={onPickStage}
            compact
          />
        }
        actions={
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '加载中…' : '重新加载'}
          </button>
        }
      />

      {visible.length === 0 ? (
        <div className="wb-empty">
          {loading ? '加载中…' : `E${String(epNo).padStart(2, '0')} 还没有镜头。先去「镜头表」拆镜，或换个集。`}
        </div>
      ) : selectedShot ? (
        <div className="wb-scroll s3d-card-wrap">
          <article
            className="s3d-card"
            data-shot-id={selectedShot.id}
            aria-label={`镜 ${selectedShot.no || selectedShot.id} 调度摘要`}
          >
            <div className="s3d-card-row">
              <span className="s3d-card-label">状态</span>
              <span className="s3d-card-value s3d-state">
                <em className={`tag ${schedTag}`} title={selectedSchedule?.reason}>
                  {selectedSchedule?.status ?? '未渲染'}
                </em>
              </span>
            </div>
            <div className="s3d-card-row">
              <span className="s3d-card-label">代码</span>
              <span className="s3d-card-value mono s3d-code">{codeShortLabel(selectedShot)}</span>
            </div>
            <div className="s3d-card-row">
              <span className="s3d-card-label">运镜</span>
              <span className="s3d-card-value wb-cast s3d-motion">{motionLabel(selectedShot)}</span>
            </div>
            <div className="s3d-card-row">
              <span className="s3d-card-label">预演</span>
              <span className="s3d-card-value s3d-state">
                {selectedShot.schedule_video ? (
                  <a
                    className="btn-mini"
                    href={selectedShot.schedule_video}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看
                  </a>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="s3d-card-actions">
              <button className="btn" type="button" onClick={() => open3D(selectedShot.id)}>
                打开
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {editorShot && editorNode && (
        <Suspense fallback={<div className="sb-chat-placeholder">正在加载 3D 工作台…</div>}>
          <LazySceneCodeWorkbench
            projectName={projectName}
            node={editorNode}
            nodes={editorNodes}
            characters={chars}
            assets={assets}
            sceneLayouts={sceneLayouts}
            projectAspect={projectAspect}
            settings={settings}
            stagePick={stagePick}
            onPickStageModel={onPickStage}
            onClose={close3D}
            onSave={saveEditor3D}
            onRendered={renderEditor3D}
            onDirtyChange={handleEditorDirty}
            toast={toast}
          />
        </Suspense>
      )}
    </main>
  )
}
