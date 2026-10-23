import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterSheet } from './characters'
import type { AppSettings, DesignSheet, ProjectAsset, ProjectData, ProjectEpisode } from './api'
import { askVision, callText, extractFrames, getProject, saveScheduleVideo } from './api'
import { effectiveSeconds, type BlockingCamera, type SceneLayout, type SceneProp, type SceneWall, type SceneZone, type ShotBlocking, type ShotData, type ShotScene, type VisualBrief, type VisualBriefMeta } from './types'
import type { StagePick } from './ModelSelect'
import { stageModelKey } from './ModelSelect'
import {
  actorMeters,
  aspectValue,
  canonicalJson,
  fallbackBlocking,
  interpolateBlocking,
  legacyLayoutToBlocking,
  motionNoteOf,
  renderSize,
  rosterOf,
  sanitizeSceneLayout,
  scheduleFingerprint,
  segmentEndpoints,
  validateBlocking,
  wallSegments,
  type Issue,
} from './scheduleGeometry'
import { buildBlockingContext, buildShotResourcePack, linkedAssetsFor } from './scheduleContext'
import { generateShotBundle, type Ask } from './scheduleAI'
import { runShot3DJob } from './shot3dJob'
import { continuityWarnings, previousShotFor, resolveShotScene } from './shotScene'
import { applyShot3DPatch, parseShot3DChatResult, SHOT3D_CHAT_SYSTEM } from './shotChat'
import { buildReferenceBoard } from './referenceBoard'
import { buildVisionPrompt, makeVisualBriefMeta, normalizeVisualBrief, VISION_SYSTEM } from './visualBrief'
import { buildScheduleScene, renderScheduleVideo, type ScheduleScene } from './schedule3d'
import type { ShotNodeType } from './data'

type Props = {
  projectName: string
  node: ShotNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  assets: ProjectAsset[]
  sceneLayouts: SceneLayout[]
  projectAspect: string
  settings: AppSettings | null
  stagePick: StagePick
  onClose: () => void
  onSave: (input: EditorSave) => Promise<void>
  onRendered: (input: EditorRendered) => Promise<void>
  toast: (message: string) => void
}

export type EditorSave = {
  scene: ShotScene
  sceneNo: number
  sceneSlug?: string
  blocking: ShotBlocking
  visualBrief?: VisualBrief
  visualBriefMeta?: VisualBriefMeta
  seedFrom?: string
}
export type EditorRendered = EditorSave & {
  video: string
  meta: NonNullable<ShotData['scheduleMeta']>
  motionNote: string
  frames?: string[]
  useFrames: boolean
}

type Snapshot = { layout: ShotScene; blocking: ShotBlocking; sceneNo: number; sceneSlug: string }
type EditorState = Snapshot & { past: Snapshot[]; future: Snapshot[] }
type Selected = { kind: 'wall' | 'prop' | 'zone' | 'actor' | 'camera'; id: string } | null
type Drag =
  | { type: 'actor' | 'face' | 'camera' | 'look'; id: string; start: Snapshot; moved: boolean }
  | { type: 'wall-a' | 'wall-b' | 'prop' | 'prop-resize' | 'prop-rotate' | 'zone' | 'zone-resize'; id: string; start: Snapshot; moved: boolean }

const clone = <T,>(v: T): T => structuredClone(v)
const snap = (s: Snapshot): Snapshot => ({
  layout: clone(s.layout),
  blocking: clone(s.blocking),
  sceneNo: s.sceneNo,
  sceneSlug: s.sceneSlug,
})
const dirtyKey = (s: Snapshot) => canonicalJson({ layout: s.layout, blocking: s.blocking, sceneNo: s.sceneNo, sceneSlug: s.sceneSlug })
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const pad = (n: number) => String(n).padStart(2, '0')
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'

function initialSnapshot(node: ShotNodeType, layouts: SceneLayout[]): {
  snap: Snapshot
  migrated: boolean
  seedFrom?: string
  hasBlocking: boolean
} {
  const d = node.data
  const episode = Number(d.episode) || 1
  const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
  const shotId = d.shotId || node.id
  const resolved = resolveShotScene(d, {
    shotId,
    sceneLayouts: layouts,
    episode,
    sceneNo,
    sceneSlug: d.sceneSlug,
  })
  const blocking =
    d.shotBlocking ??
    legacyLayoutToBlocking(d.layout) ??
    fallbackBlocking(rosterOf(d.cast, d.dialogue), resolved.scene)
  return {
    snap: {
      layout: clone(resolved.scene),
      blocking: clone(blocking),
      sceneNo,
      sceneSlug: d.sceneSlug || resolved.scene.sceneSlug || '',
    },
    migrated: resolved.migrated,
    ...(resolved.seedFrom ? { seedFrom: resolved.seedFrom } : {}),
    hasBlocking: Boolean(d.shotBlocking),
  }
}

function Num({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  return (
    <label className="se-num">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ''}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}

function ImageRef({ src, label }: { src?: string; label: string }) {
  const [bad, setBad] = useState(false)
  return (
    <div className="se-ref">
      <div className="se-ref-img">
        {src && !bad ? <img src={src} alt={label} onError={() => setBad(true)} /> : <span>缺图</span>}
      </div>
      <b>{label}</b>
    </div>
  )
}

export default function SceneScheduleEditor({
  projectName,
  node,
  nodes,
  characters,
  assets,
  sceneLayouts,
  projectAspect,
  settings,
  stagePick,
  onClose,
  onSave,
  onRendered,
  toast,
}: Props) {
  const initial = useMemo(() => initialSnapshot(node, sceneLayouts), [node.id])
  const [state, setState] = useState<EditorState>(() => ({ ...initial.snap, past: [], future: [] }))
  const [baseline, setBaseline] = useState(() => dirtyKey(initial.snap))
  const [visualBrief, setVisualBrief] = useState<VisualBrief | undefined>(node.data.visualBrief)
  const [visualBriefMeta, setVisualBriefMeta] = useState<VisualBriefMeta | undefined>(node.data.visualBriefMeta)
  const [seedFrom, setSeedFrom] = useState<string | undefined>(initial.seedFrom)
  const [projectLoaded, setProjectLoaded] = useState(false)
  const [needsAuto, setNeedsAuto] = useState(() => {
    const legacyScene = !node.data.shotScene && initial.snap.layout.source === 'legacy'
    const hasBlocking = Boolean(node.data.shotBlocking || node.data.layout)
    return (!node.data.shotScene && !legacyScene) || !hasBlocking
  })
  const autoRanRef = useRef(false)
  const [panelTab, setPanelTab] = useState<'chat' | 'props'>('chat')
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [dismissContinuity, setDismissContinuity] = useState(false)
  const chatAbortRef = useRef<AbortController | null>(null)
  const [project, setProject] = useState<ProjectData | null>(null)
  const [mode, setMode] = useState<'scene' | 'blocking'>('scene')
  const [selected, setSelected] = useState<Selected>(null)
  const [keyIdx, setKeyIdx] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewView, setPreviewView] = useState<'review' | 'pov'>('review')
  const [renderMode, setRenderMode] = useState<'clean' | 'review'>('clean')
  const [useFrames, setUseFrames] = useState(false)
  const [refsOpen, setRefsOpen] = useState(true)
  const [issues, setIssues] = useState<Issue[]>([])
  const [saveError, setSaveError] = useState('')
  const [aiBusy, setAiBusy] = useState<'bundle' | ''>('')
  const [renderBusy, setRenderBusy] = useState<{ progress: number } | null>(null)
  const [closeAsk, setCloseAsk] = useState(false)
  const [renderedVideo, setRenderedVideo] = useState(node.data.scheduleVideo || '')

  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const sceneRef = useRef<ScheduleScene | null>(null)
  const previewHostRef = useRef<HTMLDivElement>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const renderAbortRef = useRef<AbortController | null>(null)
  const playRef = useRef(0)
  const timeRef = useRef(0)

  const episodeNo = Number(node.data.episode) || 1
  const duration = effectiveSeconds(node.data.seconds)
  const roster = useMemo(() => rosterOf(node.data.cast, node.data.dialogue), [node.data.cast, node.data.dialogue])
  const dirty = dirtyKey(state) !== baseline

  useEffect(() => {
    timeRef.current = time
    sceneRef.current?.render(time)
  }, [time])

  useEffect(() => {
    let alive = true
    getProject(projectName)
      .then((p) => {
        if (alive) {
          setProject(p)
          setProjectLoaded(true)
        }
      })
      .catch(() => {
        if (alive) {
          setProject(null)
          setProjectLoaded(true)
        }
      })
    return () => {
      alive = false
    }
  }, [projectName])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const requestClose = useCallback(() => {
    if (dirty) setCloseAsk(true)
    else onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (closeAsk) {
        setCloseAsk(false)
        return
      }
      if (aiBusy) {
        aiAbortRef.current?.abort()
        return
      }
      if (renderBusy) {
        renderAbortRef.current?.abort()
        return
      }
      requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aiBusy, closeAsk, renderBusy, requestClose])

  const episode: ProjectEpisode | undefined = useMemo(
    () => (project?.episodes ?? []).find((e) => Number(e.no) === episodeNo),
    [project, episodeNo],
  )
  const scenes = useMemo(() => {
    const list = (episode?.scenes ?? []).map((s, i) => ({
      no: Number(s.no) || i + 1,
      slug: String(s.slug || s.place || `场景 ${i + 1}`),
    }))
    if (!list.some((s) => s.no === state.sceneNo)) {
      list.push({ no: state.sceneNo, slug: state.sceneSlug || `场景 ${state.sceneNo}` })
    }
    return list.sort((a, b) => a.no - b.no)
  }, [episode, state.sceneNo, state.sceneSlug])
  const currentScene = scenes.find((s) => s.no === state.sceneNo)
  const sceneSlug = state.sceneSlug || currentScene?.slug || ''

  const designs = project?.designs ?? []
  const sceneDesigns = designs.filter((d) => d.kind === 'scene')
  const propDesigns = designs.filter((d) => d.kind === 'prop')
  const linkedDesigns = designs.filter((d) => {
    if (d.id === state.layout.designId) return true
    return state.layout.props.some((p) => p.designId === d.id)
  })
  const currentKey = state.blocking.keys[clamp(keyIdx, 0, state.blocking.keys.length - 1)]
  const selectedWall =
    selected?.kind === 'wall' ? state.layout.walls.find((w) => w.id === selected.id) : undefined
  const selectedProp =
    selected?.kind === 'prop' ? state.layout.props.find((p) => p.id === selected.id) : undefined
  const selectedZone =
    selected?.kind === 'zone' ? state.layout.zones.find((z) => z.id === selected.id) : undefined
  const selectedActor =
    selected?.kind === 'actor' ? currentKey?.actors.find((a) => a.name === selected.id) : undefined
  const selectedCamera = selected?.kind === 'camera' ? currentKey?.camera : undefined
  const shotId = node.data.shotId || node.id
  const previous = useMemo(
    () => (project ? previousShotFor(project.shots ?? [], shotId, sceneLayouts) : null),
    [project, shotId, sceneLayouts],
  )
  const continuity = useMemo(
    () => (previous ? continuityWarnings(state.layout, previous.scene, previous.shot.id) : []),
    [previous, state.layout],
  )
  const liveCheck = useMemo(
    () => validateBlocking(state.blocking, { layout: state.layout, roster, aspect: projectAspect, duration }),
    [state.blocking, state.layout, roster, projectAspect, duration],
  )
  const badActors = new Set(
    liveCheck.errors.filter((e) => e.code.startsWith('actor') && e.key).map((e) => String(e.key)),
  )
  const cameraBad = liveCheck.errors.some((e) => e.code.startsWith('camera'))

  const apply = useCallback((fn: (s: EditorState) => Partial<Snapshot>, record = true) => {
    setState((prev) => {
      const patch = fn(prev)
      const next = { ...prev, ...patch }
      if (!record) return next
      return {
        ...next,
        past: [...prev.past, snap(prev)].slice(-50),
        future: [],
      }
    })
  }, [])

  const undo = () => {
    setState((prev) => {
      if (!prev.past.length) return prev
      const last = prev.past[prev.past.length - 1]
      return {
        ...prev,
        ...snap(last),
        past: prev.past.slice(0, -1),
        future: [snap(prev), ...prev.future].slice(0, 50),
      }
    })
  }
  const redo = () => {
    setState((prev) => {
      if (!prev.future.length) return prev
      const next = prev.future[0]
      return {
        ...prev,
        ...snap(next),
        past: [...prev.past, snap(prev)].slice(-50),
        future: prev.future.slice(1),
      }
    })
  }

  const refreshPreview = useCallback(() => {
    const host = previewHostRef.current
    if (!host) return
    const aspect = aspectValue(projectAspect)
    const long = 640
    const width = aspect >= 1 ? long : Math.max(100, Math.round((long * aspect) / 2) * 2)
    const height = aspect >= 1 ? Math.max(100, Math.round(long / aspect / 2) * 2) : long
    sceneRef.current?.dispose()
    const scene = buildScheduleScene({
      layout: state.layout,
      blocking: state.blocking,
      duration,
      aspect: projectAspect,
      mode: previewView === 'pov' ? 'clean' : 'review',
      showLabels: previewView === 'review',
      interactive: previewView === 'review',
      move: node.data.move,
      width,
      height,
    })
    sceneRef.current = scene
    host.replaceChildren(scene.canvas)
    scene.canvas.style.width = '100%'
    scene.canvas.style.height = 'auto'
    scene.canvas.style.display = 'block'
    scene.render(timeRef.current)
  }, [state.layout, state.blocking, duration, projectAspect, previewView, node.data.move])

  useEffect(() => {
    const t = window.setTimeout(refreshPreview, 120)
    return () => window.clearTimeout(t)
  }, [refreshPreview])

  useEffect(() => {
    return () => {
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const start = performance.now() - timeRef.current * 1000
    const tick = (now: number) => {
      const raw = (now - start) / 1000
      const t = raw % duration
      timeRef.current = t
      setTime(t)
      if (raw >= duration * 1000) {
        // 循环播放，便于反复看走位
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const onSvgPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, z: 0 }
    const r = svg.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - r.left) / Math.max(1, r.width)) * (state.layout.w + 1) - 0.5, 0, state.layout.w),
      z: clamp(((e.clientY - r.top) / Math.max(1, r.height)) * (state.layout.h + 1) - 0.5, 0, state.layout.h),
    }
  }

  const startDrag = (e: React.PointerEvent, type: Drag['type'], id: string) => {
    e.stopPropagation()
    const start = snap(state)
    dragRef.current = { type, id, start, moved: false } as Drag
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const reject = (message: string, record: boolean) => {
    if (record) toast(message)
  }
  const updateWall = (id: string, patch: Partial<SceneWall>, record = true) => {
    const old = state.layout.walls.find((w) => w.id === id)
    if (!old) return
    const next = { ...old, ...patch }
    if (![next.x1, next.z1, next.x2, next.z2, next.height, next.thickness].every(Number.isFinite)) {
      return reject('墙的坐标/尺寸必须是数字', record)
    }
    if (Math.hypot(next.x2 - next.x1, next.z2 - next.z1) < 0.1) {
      return reject('墙长至少 0.1 米', record)
    }
    if (next.height < 0.5 || next.height > 20) return reject('墙高需在 0.5~20 米', record)
    if (next.thickness < 0.02 || next.thickness > 2) return reject('墙厚需在 0.02~2 米', record)
    apply((s) => ({
      layout: { ...s.layout, walls: s.layout.walls.map((w) => (w.id === id ? next : w)) },
    }), record)
  }
  const updateProp = (id: string, patch: Partial<SceneProp>, record = true) => {
    const old = state.layout.props.find((p) => p.id === id)
    if (!old) return
    const next = { ...old, ...patch }
    if (![next.x, next.z, next.w, next.d, next.h, next.rotation].every(Number.isFinite)) {
      return reject('固定物参数必须是数字', record)
    }
    if (next.w <= 0.05 || next.d <= 0.05 || next.h <= 0.05) return reject('固定物尺寸必须大于 0.05 米', record)
    apply((s) => ({
      layout: { ...s.layout, props: s.layout.props.map((p) => (p.id === id ? next : p)) },
    }), record)
  }
  const updateZone = (id: string, patch: Partial<SceneZone>, record = true) => {
    const old = state.layout.zones.find((z) => z.id === id)
    if (!old) return
    const next = { ...old, ...patch }
    if (![next.x, next.z, next.w, next.d].every(Number.isFinite)) return reject('分区参数必须是数字', record)
    if (next.w <= 0.1 || next.d <= 0.1) return reject('分区尺寸必须大于 0.1 米', record)
    apply((s) => ({
      layout: { ...s.layout, zones: s.layout.zones.map((z) => (z.id === id ? next : z)) },
    }), record)
  }
  const updateActor = (name: string, patch: Partial<{ x: number; y: number; face: number }>, record = true) =>
    apply((s) => {
      const keys = s.blocking.keys.map((k, i) =>
        i === clamp(keyIdx, 0, s.blocking.keys.length - 1)
          ? { ...k, actors: k.actors.map((a) => (a.name === name ? { ...a, ...patch } : a)) }
          : k,
      )
      return { blocking: { ...s.blocking, keys } }
    }, record)
  const updateCamera = (patch: Partial<BlockingCamera>, record = true) => {
    const next = { ...(currentKey?.camera ?? ({} as BlockingCamera)), ...patch }
    if (![next.x, next.y, next.lookX, next.lookY, next.height, next.fov].every(Number.isFinite)) {
      return reject('机位参数必须是数字', record)
    }
    if (next.height < 0.5 || next.height > 8) return reject('机位高度需在 0.5~8 米', record)
    if (next.fov < 15 || next.fov > 110) return reject('FOV 需在 15~110 度', record)
    apply((s) => {
      const keys = s.blocking.keys.map((k, i) =>
        i === clamp(keyIdx, 0, s.blocking.keys.length - 1) ? { ...k, camera: { ...k.camera, ...patch } } : k,
      )
      return { blocking: { ...s.blocking, keys } }
    }, record)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    drag.moved = true
    const pt = onSvgPoint(e)
    if (drag.type === 'actor') {
      updateActor(drag.id, { x: pt.x / state.layout.w, y: pt.z / state.layout.h }, false)
    } else if (drag.type === 'face') {
      const actor = currentKey?.actors.find((a) => a.name === drag.id)
      if (actor) {
        const a = actorMeters(state.layout, actor)
        updateActor(drag.id, { face: (Math.atan2(pt.z - a.z, pt.x - a.x) * 180) / Math.PI }, false)
      }
    } else if (drag.type === 'camera') {
      updateCamera({ x: pt.x / state.layout.w, y: pt.z / state.layout.h }, false)
    } else if (drag.type === 'look') {
      updateCamera({ lookX: pt.x / state.layout.w, lookY: pt.z / state.layout.h }, false)
    } else if (drag.type === 'wall-a' || drag.type === 'wall-b') {
      const wall = state.layout.walls.find((w) => w.id === drag.id)
      if (wall) updateWall(drag.id, drag.type === 'wall-a' ? { x1: pt.x, z1: pt.z } : { x2: pt.x, z2: pt.z }, false)
    } else if (drag.type === 'prop') {
      updateProp(drag.id, { x: pt.x, z: pt.z }, false)
    } else if (drag.type === 'prop-resize') {
      const p = state.layout.props.find((x) => x.id === drag.id)
      if (p) updateProp(drag.id, { w: Math.max(0.1, Math.abs(pt.x - p.x) * 2), d: Math.max(0.1, Math.abs(pt.z - p.z) * 2) }, false)
    } else if (drag.type === 'prop-rotate') {
      const p = state.layout.props.find((x) => x.id === drag.id)
      if (p) updateProp(drag.id, { rotation: (Math.atan2(pt.z - p.z, pt.x - p.x) * 180) / Math.PI }, false)
    } else if (drag.type === 'zone') {
      updateZone(drag.id, { x: clamp(pt.x, 0, state.layout.w - 0.2), z: clamp(pt.z, 0, state.layout.h - 0.2) }, false)
    } else if (drag.type === 'zone-resize') {
      const z = state.layout.zones.find((x) => x.id === drag.id)
      if (z) updateZone(drag.id, { w: Math.max(0.2, Math.min(state.layout.w - z.x, pt.x - z.x)), d: Math.max(0.2, Math.min(state.layout.h - z.z, pt.z - z.z)) }, false)
    }
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag?.moved) return
    setState((prev) => ({ ...prev, past: [...prev.past, drag.start].slice(-50), future: [] }))
  }

  const changeScene = (no: number) => {
    const sc = scenes.find((s) => s.no === no)
    // 场次只改上下文；本镜空间不会被别的场次覆盖
    apply(() => ({ sceneNo: no, sceneSlug: sc?.slug || '' }))
    setSelected(null)
    setKeyIdx(0)
  }

  const addWall = () => {
    const id = `w${Date.now().toString(36)}`
    const wall: SceneWall = { id, x1: 0, z1: 0, x2: state.layout.w, z2: 0, height: 2.8, thickness: 0.18 }
    apply((s) => ({ layout: { ...s.layout, walls: [...s.layout.walls, wall] } }))
    setSelected({ kind: 'wall', id })
  }
  const addProp = () => {
    const id = `p${Date.now().toString(36)}`
    const prop: SceneProp = {
      id,
      name: '固定物',
      shape: 'box',
      x: state.layout.w / 2,
      z: state.layout.h / 2,
      w: 1,
      d: 0.6,
      h: 1,
      rotation: 0,
    }
    apply((s) => ({ layout: { ...s.layout, props: [...s.layout.props, prop] } }))
    setSelected({ kind: 'prop', id })
  }
  const addZone = () => {
    const id = `z${Date.now().toString(36)}`
    const zone: SceneZone = {
      id,
      name: '表演区',
      kind: 'action',
      x: state.layout.w * 0.25,
      z: state.layout.h * 0.25,
      w: state.layout.w * 0.5,
      d: state.layout.h * 0.5,
    }
    apply((s) => ({ layout: { ...s.layout, zones: [...s.layout.zones, zone] } }))
    setSelected({ kind: 'zone', id })
  }
  const removeSelected = () => {
    if (!selected) return
    if (selected.kind === 'wall')
      apply((s) => ({ layout: { ...s.layout, walls: s.layout.walls.filter((w) => w.id !== selected.id) } }))
    else if (selected.kind === 'prop')
      apply((s) => ({ layout: { ...s.layout, props: s.layout.props.filter((p) => p.id !== selected.id) } }))
    else if (selected.kind === 'zone')
      apply((s) => ({ layout: { ...s.layout, zones: s.layout.zones.filter((z) => z.id !== selected.id) } }))
    setSelected(null)
  }

  const changeSceneDesign = (id: string) =>
    apply((s) => ({ layout: { ...s.layout, designId: id || undefined } }))

  const addOpening = (kind: 'door' | 'window') => {
    if (!selectedWall) return
    const wall = selectedWall
    const len = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
    const opening = {
      at: Math.max(0, len * 0.5 - 0.5),
      width: 1,
      height: kind === 'door' ? 2.1 : 1.2,
      kind,
      ...(kind === 'window' ? { sill: 0.9 } : {}),
    }
    updateWall(wall.id, { openings: [...(wall.openings ?? []), opening] })
  }

  const updateOpening = (index: number, patch: Partial<NonNullable<SceneWall['openings']>[number]>) => {
    if (!selectedWall) return
    updateWall(selectedWall.id, {
      openings: (selectedWall.openings ?? []).map((o, i) => (i === index ? { ...o, ...patch } : o)),
    })
  }

  const addKey = () => {
    let addedIdx = 0
    apply((s) => {
      if (s.blocking.keys.length >= 3) return {}
      const sorted = [...s.blocking.keys].sort((a, b) => a.t - b.t)
      let t = 0.5
      let pose = interpolateBlocking(s.blocking, t)
      if (sorted.length === 1) {
        // 单帧走位没有显式结束帧：补一个 t=1 的结束姿态
        t = 1
        pose = { ...structuredClone(sorted[0]), t: 1 }
      } else if (sorted.length === 2) {
        t = (sorted[0].t + sorted[1].t) / 2
        pose = interpolateBlocking(s.blocking, t)
      }
      if (!pose) return {}
      const keys = [...sorted, { ...pose, t }].sort((a, b) => a.t - b.t)
      addedIdx = keys.findIndex((k) => k.t === t)
      return { blocking: { ...s.blocking, keys } }
    })
    setKeyIdx(addedIdx)
  }
  const removeKey = () => {
    if (state.blocking.keys.length <= 1 || keyIdx === 0 || keyIdx === state.blocking.keys.length - 1) return
    apply((s) => ({ blocking: { ...s.blocking, keys: s.blocking.keys.filter((_, i) => i !== keyIdx) } }))
    setKeyIdx(0)
  }

  const ask = useMemo<Ask>(
    () => (o) =>
      callText({
        ...o,
        modelKey: stageModelKey(settings, 'shot', stagePick),
      }),
    [settings, stagePick],
  )

  const runBundleAI = async (auto = false) => {
    if (aiBusy) return
    if (!auto && (node.data.shotScene || node.data.shotBlocking) && !window.confirm('重新生成会替换本镜空间和走位，继续？')) return
    const ac = new AbortController()
    aiAbortRef.current = ac
    setAiBusy('bundle')
    setIssues([])
    try {
      const result = await runShot3DJob({
        projectName,
        data: {
          ...node.data,
          shotScene: state.layout,
          shotBlocking: state.blocking,
          sceneNo: state.sceneNo,
          sceneSlug: state.sceneSlug,
        },
        shotId: node.data.shotId || node.id,
        project,
        sceneLayouts,
        characters,
        assets,
        nodes,
        settings,
        stagePick,
        aspect: projectAspect,
        ask,
        existingBrief: visualBrief,
        existingBriefMeta: visualBriefMeta,
        signal: ac.signal,
      })
      apply(() => ({
        layout: result.scene,
        blocking: result.blocking,
        sceneNo: result.scene.sceneNo,
        sceneSlug: result.scene.sceneSlug || state.sceneSlug,
      }))
      setVisualBrief(result.visualBrief)
      setVisualBriefMeta(result.visualBriefMeta)
      setSeedFrom(result.seedScene?.id)
      setKeyIdx(0)
      setNeedsAuto(false)
      if (result.warnings.length) toast(result.warnings[0])
      else toast(result.usedVision ? '已用参考板生成本镜 3D，可直接说“机位再远一点”' : '已用文本生成本镜 3D（参考图未参与）')
    } catch (e) {
      if (!isAbort(e)) toast((e as Error).message || '3D 生成失败')
    } finally {
      aiAbortRef.current = null
      setAiBusy('')
    }
  }

  const cancelAI = () => {
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    setAiBusy('')
  }

  const refreshBrief = async (signal?: AbortSignal) => {
    const linked = linkedAssetsFor(project?.assets ?? assets, node.data, nodes)
    const pack = buildShotResourcePack({
      shot: {
        no: node.data.no,
        seconds: node.data.seconds,
        size: node.data.size,
        move: node.data.move,
        cast: node.data.cast,
        dialogue: node.data.dialogue,
        prompt: node.data.prompt,
        videoPrompt: node.data.videoPrompt,
        refIds: node.data.refIds,
        refExtras: node.data.refExtras,
        refImage: node.data.refImage,
        candidates: node.data.candidates,
        activeIdx: node.data.activeIdx,
      },
      scene: state.layout,
      characters,
      designs: project?.designs,
      linkedAssets: linked,
      marks: node.data.marks,
    })
    if (!pack.resources.length) return { brief: undefined, meta: undefined, warnings: ['当前镜头没有可用参考图'] }
    const board = await buildReferenceBoard({
      currentFrame: pack.currentFrame,
      scene: pack.scene,
      characters: pack.characters,
      props: pack.props,
      manifest: pack.manifest,
      resources: pack.resources,
    })
    if (!board.hasImages) return { brief: undefined, meta: undefined, warnings: ['参考板没有可用图片'] }
    if (visualBrief && visualBriefMeta?.fingerprint === board.fingerprint) {
      return { brief: visualBrief, meta: visualBriefMeta, warnings: [] as string[] }
    }
    const key = stageModelKey(settings, 'vision', stagePick)
    if (!key) return { brief: undefined, meta: undefined, warnings: ['没有配置视觉模型，参考图未参与'] }
    const v = await askVision({
      system: VISION_SYSTEM,
      prompt: buildVisionPrompt(board.manifest),
      image: board.dataUrl,
      modelKey: key,
      json: true,
      maxTokens: 1600,
      signal,
    })
    const brief = normalizeVisualBrief(v.json, true)
    return {
      brief,
      meta: makeVisualBriefMeta({ fingerprint: board.fingerprint, usedVision: true, modelKey: v.modelKey }),
      warnings: [] as string[],
    }
  }

  const applyPreviousScene = () => {
    if (!previous) return
    const next = {
      ...structuredClone(previous.scene),
      id: shotId,
      episode: episodeNo,
      sceneNo: state.sceneNo,
      sceneSlug: state.sceneSlug,
      seedFrom: previous.shot.id,
    } as ShotScene
    apply(() => ({ layout: next }))
    setSeedFrom(previous.shot.id)
    setSelected(null)
  }

  const sendChat = async (text = chatInput) => {
    const message = String(text || '').trim()
    if (!message || chatBusy) return
    setChatInput('')
    setChatError('')
    setChatMessages((m) => [...m, { role: 'user', text: message }])
    const ac = new AbortController()
    chatAbortRef.current = ac
    setChatBusy(true)
    try {
      let brief = visualBrief
      let meta = visualBriefMeta
      const imageIntent = /当前画面|首帧|参考图|这张图|画面里|按图/.test(message)
      if (imageIntent) {
        const refreshed = await refreshBrief(ac.signal)
        if (refreshed.brief) {
          brief = refreshed.brief
          meta = refreshed.meta
          setVisualBrief(refreshed.brief)
          setVisualBriefMeta(refreshed.meta)
        }
        if (refreshed.warnings.length) setChatMessages((m) => [...m, { role: 'assistant', text: refreshed.warnings[0] }])
      }
      const linked = linkedAssetsFor(project?.assets ?? assets, node.data, nodes)
      const contextText = buildBlockingContext({
        episode,
        scene: state.layout,
        shot: {
          no: node.data.no,
          seconds: node.data.seconds,
          size: node.data.size,
          move: node.data.move,
          cast: node.data.cast,
          dialogue: node.data.dialogue,
          prompt: node.data.prompt,
          videoPrompt: node.data.videoPrompt,
          refIds: node.data.refIds,
          refExtras: node.data.refExtras,
        },
        characters,
        designs: project?.designs,
        linkedAssets: linked,
        marks: node.data.marks,
        aspect: projectAspect,
        ...(brief ? { visualBriefText: JSON.stringify(brief) } : {}),
      })
      const prompt =
        `${contextText}\n\n当前 ShotScene JSON：\n${JSON.stringify(state.layout)}\n` +
        `当前 ShotBlocking JSON：\n${JSON.stringify(state.blocking)}\n` +
        `当前关键帧：${keyIdx}\n上一镜空间：${previous ? JSON.stringify(previous.scene) : '无'}\n` +
        `在场角色：${roster.join('、') || '无'}\n` +
        `用户消息：${message}\n` +
        '只返回 {reply, ops}。'
      const r = await callText({
        system: SHOT3D_CHAT_SYSTEM,
        prompt,
        json: true,
        maxTokens: 1800,
        modelKey: stageModelKey(settings, 'shot', stagePick),
        signal: ac.signal,
      })
      const parsed = parseShot3DChatResult(r.json)
      if (parsed.ops.some((o) => o.op === 'regenerate_scene' || o.op === 'regenerate_blocking')) {
        setChatMessages((m) => [...m, { role: 'assistant', text: parsed.reply || '正在重新生成 3D…' }])
        setChatBusy(false)
        chatAbortRef.current = null
        void runBundleAI(true)
        return
      }
      const applied = applyShot3DPatch(
        {
          scene: state.layout,
          blocking: state.blocking,
          roster,
          aspect: projectAspect,
          duration,
          selectedKey: keyIdx,
          previousScene: previous?.scene,
        },
        parsed.ops,
      )
      if (applied.errors.length) {
        setChatError(applied.errors[0])
        setChatMessages((m) => [...m, { role: 'assistant', text: `没有应用：${applied.errors[0]}` }])
      } else {
        apply(() => ({ layout: applied.scene, blocking: applied.blocking }))
        setIssues([])
        setChatMessages((m) => [...m, { role: 'assistant', text: parsed.reply || '已按你的要求修改，可撤销。' }])
      }
    } catch (e) {
      if (!isAbort(e)) {
        setChatError((e as Error).message)
        setChatMessages((m) => [...m, { role: 'assistant', text: (e as Error).message || '聊天修改失败' }])
      }
    } finally {
      chatAbortRef.current = null
      setChatBusy(false)
    }
  }

  const cancelChat = () => {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setChatBusy(false)
  }

  useEffect(() => {
    if (!projectLoaded || !needsAuto || autoRanRef.current) return
    autoRanRef.current = true
    void runBundleAI(true)
    // 只在首次打开缺数据时自动跑一次；runBundleAI 是即时闭包，不放进依赖避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLoaded, needsAuto])

  const persist = async (): Promise<EditorSave | null> => {
    setSaveError('')
    const check = validateBlocking(state.blocking, {
      layout: state.layout,
      roster,
      aspect: projectAspect,
      duration,
    })
    setIssues(check.errors)
    if (check.errors.length) {
      toast(`有 ${check.errors.length} 处走位冲突，先修正再保存`)
      return null
    }
    const id = node.data.shotId || node.id
    const slug = state.sceneSlug || currentScene?.slug || ''
    const clean = sanitizeSceneLayout(
      {
        ...state.layout,
        id,
        episode: episodeNo,
        sceneNo: state.sceneNo,
        sceneSlug: slug,
        source: state.layout.source === 'fallback' ? 'manual' : state.layout.source,
        ...(seedFrom ? { seedFrom } : {}),
      },
      { episode: episodeNo, sceneNo: state.sceneNo, sceneSlug: slug },
    )
    if (clean.warnings.length) toast(clean.warnings[0])
    const scene = { ...clean.layout, id } as ShotScene
    const blocking: ShotBlocking = { ...state.blocking, source: 'manual' }
    try {
      await onSave({
        scene,
        sceneNo: state.sceneNo,
        sceneSlug: slug || undefined,
        blocking,
        ...(visualBrief ? { visualBrief } : {}),
        ...(visualBriefMeta ? { visualBriefMeta } : {}),
        ...(seedFrom ? { seedFrom } : {}),
      })
    } catch (e) {
      const message = (e as Error).message || '保存 3D 调度失败'
      setSaveError(message)
      toast(message)
      return null
    }
    const next = { ...state, layout: scene, blocking, sceneSlug: slug, past: [], future: [] }
    setState(next)
    setBaseline(dirtyKey(next))
    toast('3D 调度已保存')
    return {
      scene,
      sceneNo: state.sceneNo,
      sceneSlug: slug || undefined,
      blocking,
      ...(visualBrief ? { visualBrief } : {}),
      ...(visualBriefMeta ? { visualBriefMeta } : {}),
      ...(seedFrom ? { seedFrom } : {}),
    }
  }

  const renderNow = async () => {
    if (renderBusy) return
    const saved = await persist()
    if (!saved) return
    const ac = new AbortController()
    renderAbortRef.current = ac
    setRenderBusy({ progress: 0 })
    try {
      const blob = await renderScheduleVideo({
        layout: saved.scene,
        blocking: saved.blocking,
        duration,
        aspect: projectAspect,
        mode: renderMode,
        move: node.data.move,
        signal: ac.signal,
        onProgress: (progress) => setRenderBusy({ progress }),
      })
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('读取录制结果失败'))
        fr.readAsDataURL(blob)
      })
      const video = await saveScheduleVideo(dataUrl)
      const size = renderSize(projectAspect)
      const meta = {
        version: 1 as const,
        fingerprint: scheduleFingerprint({
          layout: saved.scene,
          blocking: saved.blocking,
          duration,
          aspect: projectAspect,
          mode: renderMode,
        }),
        mode: renderMode,
        duration,
        aspect: projectAspect,
        width: size.width,
        height: size.height,
        renderedAt: new Date().toISOString(),
      }
      const motionNote = motionNoteOf(saved.scene, saved.blocking, duration, node.data.move)
      let frames: string[] | undefined
      if (renderMode === 'clean' && useFrames) {
        try {
          frames = (await extractFrames(video, 3)).urls
        } catch {
          /* 抽帧失败不影响视频 */
        }
      }
      await onRendered({
        ...saved,
        video,
        meta,
        motionNote,
        frames,
        useFrames: Boolean(useFrames && renderMode === 'clean'),
      })
      setRenderedVideo(video)
      toast(renderMode === 'clean' ? '干净预演已生成' : '审阅视频已生成（仅审片，不可作参考）')
    } catch (e) {
      if (!isAbort(e)) toast((e as Error).message || '渲染失败')
    } finally {
      renderAbortRef.current = null
      setRenderBusy(null)
    }
  }

  const cancelRender = () => {
    renderAbortRef.current?.abort()
    renderAbortRef.current = null
    setRenderBusy(null)
  }

  const sceneDesign = sceneDesigns.find((d) => d.id === state.layout.designId)
  const refItems: { key: string; src?: string; label: string }[] = [
    ...(node.data.refImage ? [{ key: 'frame', src: node.data.refImage, label: '本镜首帧' }] : []),
    ...roster.map((name) => ({
      key: `char-${name}`,
      src: characters.find((c) => c.name === name)?.image,
      label: `角色 ${name}`,
    })),
    { key: 'scene', src: sceneDesign?.image, label: sceneDesign ? `场景 ${sceneDesign.name}` : '场景卡' },
    ...linkedDesigns
      .filter((d) => d.kind === 'prop')
      .map((d) => ({ key: `prop-${d.id}`, src: d.image, label: `道具 ${d.name}` })),
  ]
  const refs = (
    <>
      {refItems.map((r) => (
        <ImageRef key={r.key} src={r.src} label={r.label} />
      ))}
      {refItems.every((r) => !r.src) && <p className="se-empty">这个镜头还没有可用参考图</p>}
    </>
  )

  const scenePoints = (wall: SceneWall) =>
    wallSegments(wall).map((seg) => ({ ...segmentEndpoints(wall, seg), y0: seg.y0, y1: seg.y1 }))
  const actorPath = (() => {
    const pts: { x: number; z: number }[] = []
    if (!currentKey) return pts
    const samples = 20
    for (let i = 0; i <= samples; i++) {
      const p = interpolateBlocking(state.blocking, i / samples)
      const a = p?.actors.find((x) => x.name === selectedActor?.name)
      if (a) {
        const m = actorMeters(state.layout, a)
        pts.push({ x: m.x, z: m.z })
      }
    }
    return pts
  })()

  return (
    <div
      className="se-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="3D 调度编辑器"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="se-shell">
        <header className="se-head">
          <div className="se-title">
            <b>3D 调度</b>
            <span>
              {node.data.no} · E{pad(episodeNo)} · {sceneSlug || `场 ${state.sceneNo}`}
              {' · '}
              {state.layout.source === 'legacy'
                ? '场次迁移'
                : state.layout.source === 'fallback'
                  ? '兜底空间'
                  : state.layout.source === 'manual'
                    ? '手动空间'
                    : 'AI 空间'}
              {seedFrom ? ` · 继承 ${seedFrom}` : ''}
              {' · '}
              {visualBriefMeta ? (visualBriefMeta.usedVision ? '视觉 brief' : '参考图未参与') : '文本空间'}
            </span>
          </div>
          <div className="se-modes">
            <button className={mode === 'scene' ? 'on' : ''} onClick={() => setMode('scene')}>
              本镜空间
            </button>
            <button className={mode === 'blocking' ? 'on' : ''} onClick={() => setMode('blocking')}>
              镜头走位
            </button>
          </div>
          <label className="se-scene-select">
            场次
            <select value={state.sceneNo} onChange={(e) => changeScene(Number(e.target.value))}>
              {scenes.map((s) => (
                <option key={s.no} value={s.no}>
                  {s.no} · {s.slug}
                </option>
              ))}
            </select>
          </label>
          <div className="se-actions">
            <button className="btn-mini" onClick={undo} disabled={!state.past.length} title="撤销">
              撤销
            </button>
            <button className="btn-mini" onClick={redo} disabled={!state.future.length} title="重做">
              重做
            </button>
            <button className="btn-mini" onClick={() => setRefsOpen((v) => !v)}>
              参考图
            </button>
            <button className="btn" onClick={() => void persist()} disabled={!!aiBusy || !!renderBusy}>
              保存
            </button>
            <button className="btn primary" onClick={() => void renderNow()} disabled={!!aiBusy || !!renderBusy}>
              {renderBusy ? `渲染 ${Math.round(renderBusy.progress * 100)}%` : '渲染预演'}
            </button>
            <button className="btn-ghost" onClick={requestClose}>
              关闭
            </button>
          </div>
        </header>

        {continuity.length > 0 && !dismissContinuity && (
          <div className="se-continuity">
            <b>与上一镜空间有差异</b>
            <ul>
              {continuity.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
            <div className="se-tools">
              <button className="btn-mini" onClick={applyPreviousScene} disabled={!previous}>继承上一镜</button>
              <button className="btn-mini" onClick={() => setDismissContinuity(true)}>保留当前</button>
            </div>
          </div>
        )}

        <div className={`se-body ${refsOpen ? '' : 'no-refs'}`}>
          <section className="se-left">
            <div className="se-panel-head">
              <span>{mode === 'scene' ? '空间平面' : `走位关键帧 · ${keyIdx + 1}/${state.blocking.keys.length}`}</span>
              {mode === 'scene' ? (
                <div className="se-tools">
                  <button className="btn-mini" onClick={addWall}>+ 墙</button>
                  <button className="btn-mini" onClick={addProp}>+ 固定物</button>
                  <button className="btn-mini" onClick={addZone}>+ 分区</button>
                  <button className="btn-mini" onClick={removeSelected} disabled={!selected}>删除</button>
                  <button className="btn-mini" onClick={() => void runBundleAI()} disabled={!!aiBusy}>
                    {aiBusy ? '生成中…' : '生成 3D 预演'}
                  </button>
                  {aiBusy && <button className="btn-mini" onClick={cancelAI}>取消</button>}
                </div>
              ) : (
                <div className="se-tools">
                  <button className="btn-mini" onClick={addKey} disabled={state.blocking.keys.length >= 3}>+ 中间帧</button>
                  <button className="btn-mini" onClick={removeKey} disabled={keyIdx === 0 || keyIdx === state.blocking.keys.length - 1}>删除帧</button>
                  <button className="btn-mini" onClick={() => void runBundleAI()} disabled={!!aiBusy}>
                    {aiBusy ? '生成中…' : '生成 3D 预演'}
                  </button>
                  {aiBusy && <button className="btn-mini" onClick={cancelAI}>取消</button>}
                </div>
              )}
            </div>

            <div className="se-plan-wrap">
              <svg
                ref={svgRef}
                className="se-plan"
                viewBox={`-0.5 -0.5 ${state.layout.w + 1} ${state.layout.h + 1}`}
                preserveAspectRatio="none"
                style={{ aspectRatio: `${state.layout.w + 1} / ${state.layout.h + 1}` }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelected(null)
                    setPlaying(false)
                  }
                }}
              >
                <rect x={0} y={0} width={state.layout.w} height={state.layout.h} className="se-floor" />
                {mode === 'scene' &&
                  state.layout.zones.map((z) => (
                    <g key={z.id}>
                      <rect
                        x={z.x}
                        y={z.z}
                        width={z.w}
                        height={z.d}
                        className={`se-zone ${selected?.kind === 'zone' && selected.id === z.id ? 'sel' : ''}`}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'zone', id: z.id })
                          startDrag(e, 'zone', z.id)
                        }}
                      />
                      <text x={z.x + 0.15} y={z.z + 0.35} className="se-plan-label">{z.name}</text>
                      <circle
                        cx={z.x + z.w}
                        cy={z.z + z.d}
                        r={0.13}
                        className="se-handle"
                        data-se="zone-resize"
                        data-id={z.id}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'zone', id: z.id })
                          startDrag(e, 'zone-resize', z.id)
                        }}
                      />
                    </g>
                  ))}
                {mode === 'scene' &&
                  state.layout.walls.map((wall) =>
                    scenePoints(wall).map((p, i) => {
                      const len = Math.hypot(p.x2 - p.x1, p.z2 - p.z1)
                      const angle = (Math.atan2(p.z2 - p.z1, p.x2 - p.x1) * 180) / Math.PI
                      return (
                        <g key={`${wall.id}-${i}`}>
                          <line
                            x1={p.x1}
                            y1={p.z1}
                            x2={p.x2}
                            y2={p.z2}
                            className={`se-wall ${selected?.kind === 'wall' && selected.id === wall.id ? 'sel' : ''}`}
                          />
                          <g transform={`translate(${(p.x1 + p.x2) / 2} ${(p.z1 + p.z2) / 2}) rotate(${angle})`}>
                            <rect
                              x={-len / 2}
                              y={-0.22}
                              width={len}
                              height={0.44}
                              className="se-wall-hit"
                              data-se="wall"
                              data-id={wall.id}
                              onPointerDown={(e) => {
                                setSelected({ kind: 'wall', id: wall.id })
                                e.stopPropagation()
                              }}
                            />
                          </g>
                        </g>
                      )
                    }),
                  )}
                {mode === 'scene' &&
                  state.layout.walls.map((wall) => (
                    <g key={`${wall.id}-handles`}>
                      <circle
                        cx={wall.x1}
                        cy={wall.z1}
                        r={0.16}
                        className="se-handle"
                        data-se="wall-a"
                        data-id={wall.id}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'wall', id: wall.id })
                          startDrag(e, 'wall-a', wall.id)
                        }}
                      />
                      <circle
                        cx={wall.x2}
                        cy={wall.z2}
                        r={0.16}
                        className="se-handle"
                        data-se="wall-b"
                        data-id={wall.id}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'wall', id: wall.id })
                          startDrag(e, 'wall-b', wall.id)
                        }}
                      />
                    </g>
                  ))}
                {mode === 'scene' &&
                  state.layout.props.map((p) => (
                    <g
                      key={p.id}
                      transform={`translate(${p.x} ${p.z}) rotate(${p.rotation})`}
                      onPointerDown={(e) => {
                        setSelected({ kind: 'prop', id: p.id })
                        startDrag(e, 'prop', p.id)
                      }}
                    >
                      <rect
                        x={-p.w / 2}
                        y={-p.d / 2}
                        width={p.w}
                        height={p.d}
                        className={`se-prop ${selected?.kind === 'prop' && selected.id === p.id ? 'sel' : ''}`}
                      />
                      <text x={-p.w / 2 + 0.1} y={0.05} className="se-plan-label">{p.name}</text>
                      <circle
                        cx={p.w / 2}
                        cy={0}
                        r={0.12}
                        className="se-handle se-rotate"
                        data-se="prop-rotate"
                        data-id={p.id}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'prop', id: p.id })
                          startDrag(e, 'prop-rotate', p.id)
                        }}
                      />
                      <rect
                        x={p.w / 2 - 0.06}
                        y={p.d / 2 - 0.06}
                        width={0.12}
                        height={0.12}
                        className="se-handle"
                        data-se="prop-resize"
                        data-id={p.id}
                        onPointerDown={(e) => {
                          setSelected({ kind: 'prop', id: p.id })
                          startDrag(e, 'prop-resize', p.id)
                        }}
                      />
                    </g>
                  ))}
                {state.layout.axis && mode === 'scene' && (
                  <line
                    x1={state.layout.axis.a.x}
                    y1={state.layout.axis.a.z}
                    x2={state.layout.axis.b.x}
                    y2={state.layout.axis.b.z}
                    className="se-axis"
                  />
                )}

                {mode === 'blocking' && currentKey && (
                  <>
                    {selectedActor && actorPath.length > 1 && (
                      <polyline
                        points={actorPath.map((p) => `${p.x},${p.z}`).join(' ')}
                        className="se-path"
                      />
                    )}
                    <line
                      x1={currentKey.camera.x * state.layout.w}
                      y1={currentKey.camera.y * state.layout.h}
                      x2={currentKey.camera.lookX * state.layout.w}
                      y2={currentKey.camera.lookY * state.layout.h}
                      className="se-look-line"
                    />
                    <circle
                      cx={currentKey.camera.lookX * state.layout.w}
                      cy={currentKey.camera.lookY * state.layout.h}
                      r={0.13}
                      className="se-handle se-look"
                      onPointerDown={(e) => {
                        setSelected({ kind: 'camera', id: 'camera' })
                        startDrag(e, 'look', 'camera')
                      }}
                    />
                    <g
                      transform={`translate(${currentKey.camera.x * state.layout.w} ${currentKey.camera.y * state.layout.h})`}
                      onPointerDown={(e) => {
                        setSelected({ kind: 'camera', id: 'camera' })
                        startDrag(e, 'camera', 'camera')
                      }}
                    >
                      <rect x={-0.25} y={-0.18} width={0.5} height={0.36} data-se="camera" className={`se-camera ${selected?.kind === 'camera' ? 'sel' : ''} ${cameraBad ? 'bad' : ''}`} />
                      <text x={-0.3} y={-0.3} className="se-plan-label camera">机位</text>
                    </g>
                    {currentKey.actors.map((a) => {
                      const m = actorMeters(state.layout, a)
                      return (
                        <g
                          key={a.name}
                          transform={`translate(${m.x} ${m.z})`}
                          onPointerDown={(e) => {
                            setSelected({ kind: 'actor', id: a.name })
                            startDrag(e, 'actor', a.name)
                          }}
                        >
                          <circle r={0.3} data-se="actor" data-id={a.name} className={`se-actor ${selected?.kind === 'actor' && selected.id === a.name ? 'sel' : ''} ${badActors.has(a.name) ? 'bad' : ''}`} />
                          <line
                            x1={0}
                            y1={0}
                            x2={Math.cos((m.face * Math.PI) / 180) * 0.65}
                            y2={Math.sin((m.face * Math.PI) / 180) * 0.65}
                            className="se-face"
                          />
                          <circle
                            cx={Math.cos((m.face * Math.PI) / 180) * 0.65}
                            cy={Math.sin((m.face * Math.PI) / 180) * 0.65}
                            r={0.12}
                            className="se-handle"
                            data-se="face"
                            data-id={a.name}
                            onPointerDown={(e) => {
                              setSelected({ kind: 'actor', id: a.name })
                              startDrag(e, 'face', a.name)
                            }}
                          />
                          <text x={0} y={-0.4} className="se-plan-label actor">{a.name}</text>
                        </g>
                      )
                    })}
                  </>
                )}
              </svg>
            </div>

            <div className="se-timeline">
              <button className="btn-mini" onClick={() => setPlaying((v) => !v)}>
                {playing ? '暂停' : '播放'}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={time}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  timeRef.current = v
                  setTime(v)
                  sceneRef.current?.render(v)
                }}
              />
              <span className="mono">{time.toFixed(2)} / {duration.toFixed(1)}s</span>
              {mode === 'blocking' && (
                <div className="se-keytabs">
                  {state.blocking.keys.map((k, i) => (
                    <button key={i} className={i === keyIdx ? 'on' : ''} onClick={() => { setKeyIdx(i); setTime(k.t * duration) }}>
                      {Math.round(k.t * 100)}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="se-view">
            <div className="se-panel-head">
              <span>3D 预览</span>
              <div className="se-tools">
                <button className={previewView === 'review' ? 'on' : ''} onClick={() => setPreviewView('review')}>审阅环绕</button>
                <button className={previewView === 'pov' ? 'on' : ''} onClick={() => setPreviewView('pov')}>镜头 POV</button>
              </div>
            </div>
            <div className="se-preview" ref={previewHostRef} />
            <div className="se-renderbar">
              <label className="chk">
                <input type="checkbox" checked={renderMode === 'clean'} onChange={(e) => setRenderMode(e.target.checked ? 'clean' : 'review')} />
                干净 POV（出片参考）
              </label>
              <label className="chk">
                <input type="checkbox" checked={useFrames} onChange={(e) => setUseFrames(e.target.checked)} disabled={renderMode !== 'clean'} />
                同时抽 3 帧作参考
              </label>
              {renderBusy && <button className="btn-mini" onClick={cancelRender}>取消渲染</button>}
              {renderedVideo && (
                <a href={renderedVideo} target="_blank" rel="noreferrer">查看最近视频</a>
              )}
            </div>
            {(saveError || issues.length > 0 || liveCheck.errors.length > 0) && (
              <div className="se-issues">
                <b>{saveError || (issues.length > 0 ? '走位有冲突，保存前先修正：' : '当前走位有冲突（可继续调整）：')}</b>
                <ul>{(issues.length ? issues : liveCheck.errors).slice(0, 6).map((i, n) => <li key={n}>{i.message}</li>)}</ul>
              </div>
            )}
          </section>

          {refsOpen && (
            <aside className="se-refs">
              <div className="se-panel-head"><span>参考图对照</span><button className="btn-mini" onClick={() => setRefsOpen(false)}>收起</button></div>
              <p className="se-note">会合成参考板送入视觉模型；未配置视觉时仅作人工对照。</p>
              <div className="se-refgrid">{refs}</div>
            </aside>
          )}

          <aside className="se-props">
            <div className="se-side-tabs">
              <button className={panelTab === 'chat' ? 'on' : ''} onClick={() => setPanelTab('chat')}>聊天</button>
              <button className={panelTab === 'props' ? 'on' : ''} onClick={() => setPanelTab('props')}>属性</button>
            </div>
            {panelTab === 'chat' ? (
              <div className="se-chat">
                <div className="se-chat-log">
                  {chatMessages.length === 0 && (
                    <p className="se-empty">
                      直接说想怎么改当前镜头。比如“机位再远一点”“门往左移”“角色往右走一步”。
                    </p>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`se-msg ${m.role}`}>{m.text}</div>
                  ))}
                  {chatBusy && <div className="se-msg assistant">正在按你的话修改…</div>}
                  {chatError && <div className="se-issues">{chatError}</div>}
                </div>
                <div className="se-chat-suggest">
                  <button className="btn-mini" onClick={() => void sendChat('机位再远一点')}>机位再远一点</button>
                  <button className="btn-mini" onClick={() => void sendChat('按当前画面重建空间')}>按当前画面重建</button>
                  <button className="btn-mini" onClick={() => (previous ? applyPreviousScene() : toast('没有可继承的上一镜'))}>沿用上一镜</button>
                  <button className="btn-mini" onClick={() => void sendChat('门往左移')}>门往左移</button>
                  <button className="btn-mini" onClick={() => void sendChat('角色往右走一步')}>角色往右走一步</button>
                </div>
                <div className="se-chat-input">
                  <textarea
                    rows={2}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void sendChat()
                      }
                    }}
                    placeholder="用一句话改当前镜头的 3D…"
                  />
                  <div className="se-chat-send">
                    <button className="btn primary" onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
                      {chatBusy ? '修改中…' : '发送'}
                    </button>
                    {chatBusy && <button className="btn-mini" onClick={cancelChat}>取消</button>}
                  </div>
                </div>
              </div>
            ) : (
              <>
            <div className="se-panel-head"><span>属性</span></div>
            {mode === 'scene' ? (
              <>
                <div className="se-field-row">
                  <Num label="场地宽" value={state.layout.w} min={2} onChange={(w) => {
                    if (w < 2 || w > 80) return toast('场地宽需在 2~80 米')
                    apply((s) => ({ layout: { ...s.layout, w } }))
                  }} suffix="m" />
                  <Num label="场地深" value={state.layout.h} min={2} onChange={(h) => {
                    if (h < 2 || h > 80) return toast('场地深需在 2~80 米')
                    apply((s) => ({ layout: { ...s.layout, h } }))
                  }} suffix="m" />
                </div>
                <label className="se-select">
                  场景设定卡
                  <select value={state.layout.designId || ''} onChange={(e) => changeSceneDesign(e.target.value)}>
                    <option value="">（不绑定）</option>
                    {sceneDesigns.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                {selectedWall && (
                  <div className="se-editbox">
                    <b>墙 · {selectedWall.id}</b>
                    <div className="se-field-row">
                      <Num label="x1" value={selectedWall.x1} onChange={(v) => updateWall(selectedWall.id, { x1: v })} />
                      <Num label="z1" value={selectedWall.z1} onChange={(v) => updateWall(selectedWall.id, { z1: v })} />
                    </div>
                    <div className="se-field-row">
                      <Num label="x2" value={selectedWall.x2} onChange={(v) => updateWall(selectedWall.id, { x2: v })} />
                      <Num label="z2" value={selectedWall.z2} onChange={(v) => updateWall(selectedWall.id, { z2: v })} />
                    </div>
                    <div className="se-field-row">
                      <Num label="高" value={selectedWall.height} onChange={(v) => updateWall(selectedWall.id, { height: v })} suffix="m" />
                      <Num label="厚" value={selectedWall.thickness} step={0.02} onChange={(v) => updateWall(selectedWall.id, { thickness: v })} suffix="m" />
                    </div>
                    <div className="se-openings">
                      <div className="se-subhead"><span>门窗洞口</span>
                        <button className="btn-mini" onClick={() => addOpening('door')}>+ 门</button>
                        <button className="btn-mini" onClick={() => addOpening('window')}>+ 窗</button>
                      </div>
                      {(selectedWall.openings ?? []).map((o, i) => (
                        <div key={i} className="se-opening">
                          <span>{o.kind === 'door' ? '门' : '窗'}</span>
                          <Num label="偏移" value={o.at} onChange={(v) => updateOpening(i, { at: v })} />
                          <Num label="宽" value={o.width} onChange={(v) => updateOpening(i, { width: v })} />
                          <Num label="高" value={o.height} onChange={(v) => updateOpening(i, { height: v })} />
                          {o.kind === 'window' && <Num label="窗台" value={o.sill ?? 0.9} onChange={(v) => updateOpening(i, { sill: v })} />}
                          <button className="btn-mini" onClick={() => updateWall(selectedWall.id, { openings: selectedWall.openings?.filter((_, n) => n !== i) })}>删</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedProp && (
                  <div className="se-editbox">
                    <b>固定物</b>
                    <label className="se-select">名称<input value={selectedProp.name} onChange={(e) => updateProp(selectedProp.id, { name: e.target.value })} /></label>
                    <div className="se-field-row">
                      <Num label="x" value={selectedProp.x} onChange={(v) => updateProp(selectedProp.id, { x: v })} />
                      <Num label="z" value={selectedProp.z} onChange={(v) => updateProp(selectedProp.id, { z: v })} />
                    </div>
                    <div className="se-field-row">
                      <Num label="宽" value={selectedProp.w} onChange={(v) => updateProp(selectedProp.id, { w: v })} />
                      <Num label="深" value={selectedProp.d} onChange={(v) => updateProp(selectedProp.id, { d: v })} />
                      <Num label="高" value={selectedProp.h} onChange={(v) => updateProp(selectedProp.id, { h: v })} />
                      <Num label="旋转" value={selectedProp.rotation} onChange={(v) => updateProp(selectedProp.id, { rotation: v })} />
                    </div>
                    <label className="se-select">形状
                      <select value={selectedProp.shape} onChange={(e) => updateProp(selectedProp.id, { shape: e.target.value as 'box' | 'cylinder' })}>
                        <option value="box">方体</option><option value="cylinder">圆柱</option>
                      </select>
                    </label>
                  </div>
                )}
                {selectedZone && (
                  <div className="se-editbox">
                    <b>分区</b>
                    <label className="se-select">名称<input value={selectedZone.name} onChange={(e) => updateZone(selectedZone.id, { name: e.target.value })} /></label>
                    <div className="se-field-row">
                      <Num label="x" value={selectedZone.x} onChange={(v) => updateZone(selectedZone.id, { x: v })} />
                      <Num label="z" value={selectedZone.z} onChange={(v) => updateZone(selectedZone.id, { z: v })} />
                      <Num label="宽" value={selectedZone.w} onChange={(v) => updateZone(selectedZone.id, { w: v })} />
                      <Num label="深" value={selectedZone.d} onChange={(v) => updateZone(selectedZone.id, { d: v })} />
                    </div>
                  </div>
                )}
                {!selected && <p className="se-empty">点选墙/固定物/分区编辑数值。</p>}
              </>
            ) : (
              <>
                {!currentKey && <p className="se-empty">没有可用关键帧。</p>}
                {selectedActor && (
                  <div className="se-editbox">
                    <b>角色 · {selectedActor.name}</b>
                    <div className="se-field-row">
                      <Num label="x" value={selectedActor.x} onChange={(v) => updateActor(selectedActor.name, { x: clamp(v, 0, 1) })} />
                      <Num label="y" value={selectedActor.y} onChange={(v) => updateActor(selectedActor.name, { y: clamp(v, 0, 1) })} />
                      <Num label="朝向" value={selectedActor.face} onChange={(v) => updateActor(selectedActor.name, { face: v })} suffix="°" />
                    </div>
                  </div>
                )}
                {selectedCamera && (
                  <div className="se-editbox">
                    <b>机位 · {Math.round(currentKey!.t * 100)}%</b>
                    <div className="se-field-row">
                      <Num label="x" value={selectedCamera.x} onChange={(v) => updateCamera({ x: v })} />
                      <Num label="y" value={selectedCamera.y} onChange={(v) => updateCamera({ y: v })} />
                      <Num label="高" value={selectedCamera.height} onChange={(v) => updateCamera({ height: v })} suffix="m" />
                      <Num label="FOV" value={selectedCamera.fov} onChange={(v) => updateCamera({ fov: v })} suffix="°" />
                    </div>
                    <div className="se-field-row">
                      <Num label="看 x" value={selectedCamera.lookX} onChange={(v) => updateCamera({ lookX: v })} />
                      <Num label="看 y" value={selectedCamera.lookY} onChange={(v) => updateCamera({ lookY: v })} />
                    </div>
                  </div>
                )}
                {currentKey && (
                  <div className="se-roster">
                    <b>在场角色</b>
                    {currentKey.actors.map((a) => (
                      <button key={a.name} className="btn-mini" onClick={() => setSelected({ kind: 'actor', id: a.name })}>{a.name}</button>
                    ))}
                    <button className="btn-mini" onClick={() => setSelected({ kind: 'camera', id: 'camera' })}>机位</button>
                  </div>
                )}
                <label className="se-select">渲染版本
                  <select value={renderMode} onChange={(e) => setRenderMode(e.target.value as 'clean' | 'review')}>
                    <option value="clean">干净 POV · 可作参考</option>
                    <option value="review">审阅环绕 · 仅审片</option>
                  </select>
                </label>
              </>
            )}

              </>
            )}
          </aside>
        </div>

        <footer className="se-foot">
          <span className={dirty ? 'dirty' : ''}>{dirty ? '有未保存修改' : '已同步到编辑器基线'}</span>
          <span>有效时长 {duration}s{Math.round(Number(node.data.seconds) || 0) !== duration ? '（已夹取）' : ''} · {projectAspect} · {sceneSlug || '未绑定场次'}</span>
          {closeAsk && (
            <div className="se-closeask" role="alertdialog" aria-label="未保存修改">
              <b>有未保存修改</b>
              <button className="btn primary" onClick={async () => { const ok = await persist(); if (ok) onClose() }}>保存并关闭</button>
              <button className="btn" onClick={onClose}>放弃修改</button>
              <button className="btn-ghost" onClick={() => setCloseAsk(false)}>继续编辑</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
