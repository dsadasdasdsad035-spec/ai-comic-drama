import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, ProjectData } from './api'
import { getProject } from './api'
import type { ScheduleMeta, SceneCode, SceneCodeMeta } from './types'
import { effectiveSeconds, isRenderableSceneCode } from './types'
import type { StagePick } from './ModelSelect'
import { stageModelKey, StageModelSelect } from './ModelSelect'
import { renderSize } from './renderSize'
import VggtGeometryPanel from './VggtGeometryPanel'
import { prepareSceneCodeContext, type PreparedCodeContext } from './sceneCodePrepare'
import { renderSceneCode, trialSceneCode, sceneCodeRenderError } from './sceneCodeRender'
import { abortError, blenderHealth, type BlenderHealth } from './sceneBlender'
import { codeHashOf, sceneCodeFingerprint } from './sceneCodeFingerprint'
import { buildShotOnlyManifest } from './contextManifest'
import { isSceneCodeFresh } from './sceneCodeFreshness'
import { runSceneCodeJob } from './sceneCodeJob'
import { checkSceneCode } from './sceneCodeSanitize'
import type { AgentVideoAcceptedInput } from './agent/sceneAgentTypes'

const LazySceneAgentChat = lazy(() => import('./agent/SceneAgentChat'))

/**
 * 工作台条目：素材 → 镜头语言里的自定义白模。
 * 只带代码、代码元数据、渲染产物与运行所需的时长信息；
 * 不与分镜类型耦合，分镜也不再保存或渲染 Blender 代码。
 */
export type WorkbenchEntry = {
  id: string
  /** 条目标题，显示在命令栏 */
  title: string
  /** 有效时长（秒，未夹取） */
  seconds: number
  /** 条目自带的运镜说明，替代已删除的几何推导 */
  motionNote?: string
  code?: SceneCode
  codeMeta?: SceneCodeMeta
  /** 最近一次渲染成功的 MP4（项目内路径） */
  video?: string
  scheduleMeta?: ScheduleMeta
}

type Props = {
  projectName: string
  entry: WorkbenchEntry
  projectAspect: string
  settings: AppSettings | null
  stagePick: StagePick
  onPickStageModel?: (stage: import('./api').Stage, key: string) => void
  onClose: () => void
  onSave: (input: CodeEditorSave) => Promise<void>
  onRendered: (input: CodeEditorRendered) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
  toast: (message: string) => void
}

export type CodeEditorSave = {
  sceneCode: SceneCode
  sceneCodeMeta?: SceneCodeMeta
}

export type CodeEditorRendered = CodeEditorSave & {
  video: string
  scheduleMeta: ScheduleMeta
  frames?: string[]
  useFrames: boolean
}

type Snapshot = {
  code: string
  motionNote: string
}

type PreparedContext = PreparedCodeContext & { cacheKey: string }

type PreparedInfo = {
  count: number
  missing: number
  usedVision: boolean
  warnings: string[]
}

const FALLBACK_SCENE_CODE = `let S;
function init(ctx) {
  S = ctx;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.92 })
  );
  floor.rotation.x = -Math.PI / 2;
  S.scene.add(floor);
  const grid = new THREE.GridHelper(14, 14, 0x33506a, 0x223344);
  grid.position.y = 0.002;
  S.scene.add(grid);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f })
  );
  box.position.y = 0.6;
  S.scene.add(box);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 8, 6);
  S.scene.add(sun);
  ctx.camera.position.set(0, 2.2, 6);
  ctx.camera.lookAt(0, 0.8, 0);
}
function renderAt(t) {
  if (S) S.camera.position.x = Math.sin(t * 0.4) * 0.25;
}
function dispose() {}
`

const snapshotKey = (s: Snapshot | null) =>
  s ? JSON.stringify({ code: s.code, motionNote: s.motionNote }) : ''

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'

const sourceLabel = (source: SceneCode['source'] | 'none') =>
  source === 'ai'
    ? 'AI 生成'
    : source === 'manual'
      ? '手改'
      : source === 'legacy-converted'
        ? '旧结构化转换'
        : source === 'fallback'
          ? '空白兜底'
          : '未生成'

/**
 * 聊天输入框的起始草稿：只放还没被选进参考的镜头文本。
 * 景别/运镜/秒数不重复，agent 的镜头元数据行已经包含。
 */
export default function SceneCodeWorkbench({
  projectName,
  entry,
  projectAspect,
  settings,
  stagePick,
  onPickStageModel,
  onClose,
  onSave,
  onRendered,
  onDirtyChange,
  toast,
}: Props) {
  const duration = effectiveSeconds(entry.seconds)
  const { width, height } = renderSize(projectAspect)

  const [project, setProject] = useState<ProjectData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [vggtSessionUrls, setVggtSessionUrls] = useState<string[]>([])
  const [savedCode, setSavedCode] = useState<SceneCode | undefined>(entry.code)
  const [draftCode, setDraftCode] = useState(entry.code?.code || '')
  const [draftMotionNote, setDraftMotionNote] = useState(entry.code?.motionNote || entry.motionNote || '')
  const [codeSource, setCodeSource] = useState<SceneCode['source']>(entry.code?.source || 'ai')
  const [lastValidatedCode, setLastValidatedCode] = useState(entry.code?.code || '')
  const [lastValidatedHash, setLastValidatedHash] = useState(entry.code?.codeHash || '')
  const [baseline, setBaseline] = useState<Snapshot | null>(null)
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [sideTab, setSideTab] = useState<'chat' | 'code' | 'geom'>('chat')
  const [composerSeed, setComposerSeed] = useState<string | undefined>()
  const chatScrollRef = useRef(0)
  const [previewState, setPreviewState] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [previewError, setPreviewError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewProgress, setPreviewProgress] = useState(0)
  const [engine, setEngine] = useState<BlenderHealth | null>(null)
  const [consent, setConsent] = useState(() => {
    try {
      return localStorage.getItem('sceneBlenderConsent') === '1'
    } catch {
      return true
    }
  })
  const [missingPreviewAssets, setMissingPreviewAssets] = useState<string[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [preparedInfo, setPreparedInfo] = useState<PreparedInfo | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateLabel, setGenerateLabel] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [renderBusy, setRenderBusy] = useState<{ progress: number } | null>(null)
  const [renderError, setRenderError] = useState('')
  const [renderedVideo, setRenderedVideo] = useState(entry.video || '')
  const [saveError, setSaveError] = useState('')
  const [closeAsk, setCloseAsk] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const previewHostRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const preparedRef = useRef<PreparedContext | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const initRef = useRef(false)
  const generateAbortRef = useRef<AbortController | null>(null)
  const renderAbortRef = useRef<AbortController | null>(null)
  const previewSeqRef = useRef(0)

  const currentSnapshot = useMemo<Snapshot>(
    () => ({ code: draftCode, motionNote: draftMotionNote }),
    [draftCode, draftMotionNote],
  )
  useEffect(() => {
    snapshotRef.current = currentSnapshot
  }, [currentSnapshot])

  const dirty = Boolean(baseline && snapshotKey(baseline) !== snapshotKey(currentSnapshot))
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const renderedVideoFresh = Boolean(
    renderedVideo &&
      savedCode &&
      entry.codeMeta &&
      savedCode.code === draftCode &&
      isSceneCodeFresh({
        sceneCode: savedCode,
        meta: entry.codeMeta,
        seconds: duration,
        aspect: projectAspect,
        hasVideo: true,
      }),
  )
  const renderedVideoStatus = !renderedVideo ? '未渲染' : renderedVideoFresh ? '生效' : '已过期'
  /** v1（Three.js）代码：浏览器运行时产物，不能进 Blender，只读。 */
  const legacyCode = Boolean(savedCode && !isRenderableSceneCode(savedCode))
  const readOnly3d = legacyCode

  const switchSideTab = (next: 'chat' | 'code' | 'geom') => {
    if (next === sideTab) return
    const viewport = document.querySelector<HTMLElement>('[data-chat-viewport]')
    if (sideTab === 'chat' && viewport) chatScrollRef.current = viewport.scrollTop
    setSideTab(next)
    if (next === 'chat') {
      // assistant-ui 在重新显示时会把视口拉到底部；切回后恢复用户原来的位置。
      const restore = () => {
        const el = document.querySelector<HTMLElement>('[data-chat-viewport]')
        if (el) el.scrollTop = chatScrollRef.current
      }
      requestAnimationFrame(() => {
        restore()
        requestAnimationFrame(restore)
      })
      window.setTimeout(restore, 80)
    }
  }

  const modelKey = stageModelKey(settings, 'sceneCode', stagePick)
  /** 生成与渲染只需要最小条目头，不把分镜数据带进来。 */
  const shotHead = useMemo(
    () => ({ no: entry.title, seconds: entry.seconds }),
    [entry.title, entry.seconds],
  )
  const manifest = useMemo(
    () =>
      buildShotOnlyManifest({
        shotId: entry.id,
        shotNo: entry.title,
        duration,
        aspect: projectAspect,
      }),
    [entry.id, entry.title, duration, projectAspect],
  )

  useEffect(() => {
    let alive = true
    getProject(projectName)
      .catch(() => null)
      .then((p) => {
        if (!alive) return
        setProject(p)
      })
      .finally(() => {
        if (alive) setLoaded(true)
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

  useEffect(() => {
    let alive = true
    blenderHealth()
      .then((h) => {
        if (alive) setEngine(h)
      })
      .catch(() => {
        /* 健康检查失败由渲染入口报错 */
      })
    return () => {
      alive = false
    }
  }, [])

  const disposePreview = useCallback(() => {
    previewSeqRef.current++
    previewAbortRef.current?.abort()
    previewAbortRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    setPlaying(false)
  }, [])

  useEffect(
    () => () => {
      generateAbortRef.current?.abort()
      renderAbortRef.current?.abort()
      disposePreview()
    },
    [disposePreview],
  )

  const pushCurrent = useCallback(() => {
    const cur = snapshotRef.current
    if (!cur) return
    setPast((p) => [...p, cur].slice(-50))
    setFuture([])
  }, [])

  const updateCode = useCallback(
    (next: string) => {
      if (next === draftCode) return
      pushCurrent()
      setDraftCode(next)
      setCodeSource('manual')
    },
    [draftCode, pushCurrent],
  )

  const applySnapshot = useCallback(
    async (s: Snapshot) => {
      const codeChanged = s.code !== draftCode
      setDraftCode(s.code)
      setDraftMotionNote(s.motionNote)
      preparedRef.current = null
      setPreparedInfo(null)
      if (codeChanged && s.code.trim()) {
        const prepared = await ensurePrepared()
        await startPreview(s.code, prepared)
      }
    },
    [draftCode],
  )

  const undo = async () => {
    if (!past.length) return
    const prev = past[past.length - 1]
    const cur = snapshotRef.current
    setPast((p) => p.slice(0, -1))
    setFuture((f) => (cur ? [cur, ...f].slice(0, 50) : f))
    await applySnapshot(prev)
  }

  const redo = async () => {
    if (!future.length) return
    const next = future[0]
    const cur = snapshotRef.current
    setFuture((f) => f.slice(1))
    setPast((p) => (cur ? [...p, cur].slice(-50) : p))
    await applySnapshot(next)
  }

  const ensurePrepared = useCallback(
    async (signal?: AbortSignal): Promise<PreparedContext> => {
      const cacheKey = stageModelKey(settings, 'vision', stagePick)
      if (preparedRef.current?.cacheKey === cacheKey) return preparedRef.current
      const prepared = await prepareSceneCodeContext({ settings, stagePick, signal })
      const value: PreparedContext = { ...prepared, cacheKey }
      if (!signal?.aborted) {
        preparedRef.current = value
        setPreparedInfo({
          count: prepared.assets.length,
          missing: prepared.missing.length,
          usedVision: prepared.mediaBrief.usedVision,
          warnings: prepared.warnings,
        })
      }
      return value
    },
    [settings, stagePick],
  )

  const startPreview = useCallback(
    async (code: string, prepared: PreparedCodeContext) => {
      disposePreview()
      // 任何不可渲染的代码（旧 Three.js、坏围栏、缺入口）都不进 Blender。
      if (!checkSceneCode(code).ok) {
        setPreviewState('idle')
        setPreviewError('')
        return
      }
      const seq = ++previewSeqRef.current
      const ac = new AbortController()
      previewAbortRef.current = ac
      setPreviewState('starting')
      setPreviewError('')
      setMissingPreviewAssets([])
      setPlaying(false)
      setTime(0)
      setPreviewProgress(0)
      setPreviewUrl('')
      try {
        const result = await renderSceneCode({
          code,
          assets: prepared.assets,
          duration,
          aspect: projectAspect,
          tier: 'proxy',
          mode: 'clean',
          shot: shotHead,
          signal: ac.signal,
          onProgress: (value) => {
            if (seq === previewSeqRef.current) setPreviewProgress(value)
          },
        })
        if (seq !== previewSeqRef.current || ac.signal.aborted) return
        setPreviewUrl(result.videoUrl)
        setMissingPreviewAssets(result.job.missingAssets.map((m) => m.key))
        setPreviewState('ready')
      } catch (e) {
        if (seq !== previewSeqRef.current || isAbort(e)) return
        setPreviewState('error')
        setPreviewError(sceneCodeRenderError(e))
      } finally {
        if (previewAbortRef.current === ac) previewAbortRef.current = null
      }
    },
    [disposePreview, duration, projectAspect, shotHead],
  )

  const runTrial = useCallback(
    async (code: string, prepared: PreparedContext, signal?: AbortSignal) => {
      if (signal?.aborted) throw abortError()
      const checked = checkSceneCode(code)
      if (!checked.ok) throw new Error(checked.errors.slice(0, 3).join('；'))
      await trialSceneCode({
        code: checked.code,
        assets: prepared.assets,
        duration,
        aspect: projectAspect,
        ...(signal ? { signal } : {}),
      })
    },
    [duration, projectAspect],
  )

  const applyGeneratedCode = useCallback(
    async (result: { code: string; codeHash: string; motionNote?: string }, source: SceneCode['source'], prepared: PreparedContext) => {
      pushCurrent()
      setDraftCode(result.code)
      setDraftMotionNote(result.motionNote || draftMotionNote)
      setCodeSource(source)
      setLastValidatedCode(result.code)
      setLastValidatedHash(result.codeHash)
      await startPreview(result.code, prepared)
    },
    [draftMotionNote, pushCurrent, startPreview],
  )

  const generateCode = async () => {
    if (generating) return
    if (!modelKey) {
      setGenerateError('没有可用的白模 3D 代码模型，请到设置页绑定「白模 3D 代码」环节；也可以直接手写代码')
      return
    }
    const ac = new AbortController()
    generateAbortRef.current = ac
    setGenerating(true)
    setGenerateError('')
    setGenerateLabel(draftCode ? '正在重写白模代码…' : '正在生成白模代码…')
    try {
      const prepared = await ensurePrepared(ac.signal)
      const result = await runSceneCodeJob({
        shot: shotHead,
        project,
        assets: prepared.assets,
        mediaBrief: prepared.mediaBrief,
        videoBrief: prepared.videoBrief,
        duration,
        aspect: projectAspect,
        settings,
        stagePick,
        signal: ac.signal,
        trial: async (code) => runTrial(code, prepared, ac.signal),
      })
      if (ac.signal.aborted) return
      await applyGeneratedCode(result, 'ai', prepared)
      toast('白模代码已生成，可试运行后保存')
    } catch (e) {
      if (!isAbort(e)) {
        const message = sceneCodeRenderError(e)
        setGenerateError(message)
        if (!draftCode) setPreviewError(message)
      }
    } finally {
      generateAbortRef.current = null
      setGenerating(false)
      setGenerateLabel('')
    }
  }

  const init = useCallback(async () => {
    if (!loaded || initRef.current) return
    initRef.current = true
    const base: Snapshot = { code: draftCode, motionNote: draftMotionNote }
    setBaseline(base)
    if (draftCode) {
      // v1 Three.js 代码只读，不能送进 Blender；打开时不要自动渲染。
      if (legacyCode) {
        setPreviewState('idle')
        setPreviewError('')
        return
      }
      const saved = entry.code
      const meta = entry.codeMeta
      const fresh = Boolean(
        saved &&
          meta &&
          entry.video &&
          isSceneCodeFresh({
            sceneCode: saved,
            meta,
            seconds: duration,
            aspect: projectAspect,
            hasVideo: true,
          }),
      )
      if (fresh && entry.video) {
        // 已有生效视频直接当代理片，省掉一次整段渲染。
        setPreviewUrl(entry.video)
        setPreviewState('ready')
        setTime(0)
        return
      }
      try {
        const prepared = await ensurePrepared()
        await startPreview(draftCode, prepared)
      } catch (e) {
        setPreviewState('error')
        setPreviewError(sceneCodeRenderError(e))
      }
    }
  }, [
    loaded,
    draftCode,
    draftMotionNote,
    ensurePrepared,
    startPreview,
    legacyCode,
    entry.code,
    entry.codeMeta,
    entry.video,
    duration,
    projectAspect,
  ])

  useEffect(() => {
    if (loaded) void init()
  }, [loaded, init])

  const buildSceneCode = async (
    code: string,
    source: SceneCode['source'],
    motionNote: string,
  ): Promise<SceneCode> => ({
    version: 2,
    abiVersion: 2,
    runtime: 'blender',
    engineVersion: engine?.version || 'unknown',
    code,
    codeHash: await codeHashOf(code),
    source,
    ...(motionNote.trim() ? { motionNote: motionNote.trim() } : {}),
    updatedAt: new Date().toISOString(),
  })

  const acceptAgentVideo = async (input: AgentVideoAcceptedInput) => {
    const code = await buildSceneCode(input.code, 'ai', draftMotionNote)
    const renderedAt = new Date().toISOString()
    const assets = input.prepared.assets.map((a) => a.ref)
    const runtime = 'blender' as const
    const engineVersion = engine?.version || 'unknown'
    const fps = 30
    const frameCount = Math.max(1, Math.round(input.duration * fps))
    const fingerprint = sceneCodeFingerprint({
      codeHash: code.codeHash,
      abiVersion: 2,
      runtime,
      engineVersion,
      assets,
      duration: input.duration,
      aspect: input.aspect,
      mode: 'clean',
      fps,
      frames: frameCount,
    })
    const size = renderSize(input.aspect)
    const sceneCodeMeta: SceneCodeMeta = {
      version: 2,
      fingerprint,
      codeHash: code.codeHash,
      abiVersion: 2,
      runtime,
      engineVersion,
      assets,
      duration: input.duration,
      aspect: input.aspect,
      width: size.width,
      height: size.height,
      fps,
      frames: frameCount,
      tier: 'final',
      mode: 'clean',
      renderedAt,
    }
    const scheduleMeta: ScheduleMeta = {
      version: 1,
      fingerprint,
      mode: 'clean',
      duration: input.duration,
      aspect: input.aspect,
      width: size.width,
      height: size.height,
      renderedAt,
    }
    await onRendered({
      sceneCode: code,
      sceneCodeMeta,
      video: input.video,
      scheduleMeta,
      useFrames: false,
    })
    setSavedCode(code)
    setDraftCode(input.code)
    setCodeSource('ai')
    setRenderedVideo(input.video)
    setLastValidatedCode(input.code)
    setLastValidatedHash(code.codeHash)
    // 保留 onDraftCode 推入的撤销栈：应用验收结果不应清空「改之前」的快照。
    setBaseline({ code: input.code, motionNote: draftMotionNote })
  }

  const saveNow = async (): Promise<boolean> => {
    const checked = checkSceneCode(draftCode)
    if (!checked.ok) {
      setSaveError(checked.errors[0] || '代码不可用')
      return false
    }
    setSaveError('')
    try {
      let prepared = preparedRef.current
      const visionKey = stageModelKey(settings, 'vision', stagePick)
      if (!prepared || prepared.cacheKey !== visionKey) {
        prepared = await ensurePrepared()
      }
      if (draftCode !== lastValidatedCode) {
        await runTrial(draftCode, prepared)
        setLastValidatedCode(draftCode)
        setLastValidatedHash(await codeHashOf(draftCode))
      }
      const code = await buildSceneCode(draftCode, codeSource, draftMotionNote)
      await onSave({
        sceneCode: code,
        ...(entry.codeMeta ? { sceneCodeMeta: entry.codeMeta } : {}),
      })
      setSavedCode(code)
      setBaseline({ code: draftCode, motionNote: draftMotionNote })
      setPast([])
      setFuture([])
      toast('已保存白模代码')
      return true
    } catch (e) {
      setSaveError(sceneCodeRenderError(e))
      return false
    }
  }

  const renderNow = async () => {
    if (renderBusy) return
    if (!draftCode.trim()) {
      setRenderError('当前没有代码')
      return
    }
    const checked = checkSceneCode(draftCode)
    if (!checked.ok) {
      setRenderError(checked.errors.slice(0, 3).join('；'))
      return
    }
    const ac = new AbortController()
    renderAbortRef.current = ac
    setRenderBusy({ progress: 0 })
    setRenderError('')
    try {
      const prepared = await ensurePrepared(ac.signal)
      const result = await renderSceneCode({
        code: draftCode,
        assets: prepared.assets,
        duration,
        aspect: projectAspect,
        tier: 'final',
        mode: 'clean',
        signal: ac.signal,
        onProgress: (value) => setRenderBusy({ progress: value }),
        keyTimes: [0, duration / 3, (duration * 2) / 3, Math.max(0, duration - 1 / 30)],
      })
      if (ac.signal.aborted) return
      const url = result.videoUrl
      const code = await buildSceneCode(draftCode, codeSource, draftMotionNote)
      const renderedAt = new Date().toISOString()
      const runtime = 'blender' as const
      const engineVersion = engine?.version || 'unknown'
      const fps = 30
      const frameCount = result.job.total
      const fingerprint = sceneCodeFingerprint({
        codeHash: code.codeHash,
        abiVersion: 2,
        runtime,
        engineVersion,
        assets: prepared.assets.map((a) => a.ref),
        duration,
        aspect: projectAspect,
        mode: 'clean',
        fps,
        frames: frameCount,
      })
      const meta: SceneCodeMeta = {
        version: 2,
        fingerprint,
        codeHash: code.codeHash,
        abiVersion: 2,
        runtime,
        engineVersion,
        assets: prepared.assets.map((a) => a.ref),
        duration,
        aspect: projectAspect,
        width: result.job.width,
        height: result.job.height,
        fps,
        frames: frameCount,
        tier: 'final',
        mode: 'clean',
        renderedAt,
      }
      const scheduleMeta: ScheduleMeta = {
        version: 1,
        fingerprint,
        mode: 'clean',
        duration,
        aspect: projectAspect,
        width: result.job.width,
        height: result.job.height,
        renderedAt,
      }
      const frames: string[] | undefined = result.frameUrls.length ? result.frameUrls : undefined
      await onRendered({
        sceneCode: code,
        sceneCodeMeta: meta,
        video: url,
        scheduleMeta,
        ...(frames ? { frames } : {}),
        useFrames: false,
      })
      setSavedCode(code)
      setRenderedVideo(url)
      setLastValidatedCode(draftCode)
      setLastValidatedHash(code.codeHash)
      setBaseline({ code: draftCode, motionNote: draftMotionNote })
      setPast([])
      setFuture([])
      toast('3D 代码视频已生成')
    } catch (e) {
      if (!isAbort(e)) setRenderError(sceneCodeRenderError(e))
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

  const cancelGenerate = () => {
    generateAbortRef.current?.abort()
    generateAbortRef.current = null
    setGenerating(false)
    setGenerateLabel('')
  }

  const useEmptyCode = async () => {
    try {
      const prepared = await ensurePrepared()
      const hash = await codeHashOf(FALLBACK_SCENE_CODE)
      await applyGeneratedCode({ code: FALLBACK_SCENE_CODE, codeHash: hash, motionNote: '空白模板场景' }, 'fallback', prepared)
    } catch (e) {
      setGenerateError(sceneCodeRenderError(e))
    }
  }

  const requestClose = () => {
    if (generating) cancelGenerate()
    if (renderBusy) cancelRender()
    if (dirty) setCloseAsk(true)
    else {
      disposePreview()
      onClose()
    }
  }

  const saveAndClose = async () => {
    if (await saveNow()) {
      setCloseAsk(false)
      disposePreview()
      onClose()
    }
  }

  const discardAndClose = () => {
    setCloseAsk(false)
    disposePreview()
    onClose()
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video || previewState !== 'ready') return
    if (video.paused) {
      void video.play().catch(() => setPlaying(false))
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  const seek = (t: number) => {
    const video = videoRef.current
    setTime(t)
    setPlaying(false)
    if (video) {
      video.pause()
      video.currentTime = Math.max(0, Math.min(duration, t))
    }
  }

  const prepareAgent = async () => ensurePrepared()

  const applyAgentDraft = async (
    code: string,
    _check: import('./sceneCodeSanitize').SceneCodeCheck,
    prepared: import('./sceneCodePrepare').PreparedCodeContext,
  ) => {
    pushCurrent()
    setDraftCode(code)
    setCodeSource('ai')
    setLastValidatedCode(code)
    setLastValidatedHash(await codeHashOf(code))
    await startPreview(code, prepared)
  }

  const onVggtIngested = useCallback((videoUrl: string) => {
    const u = videoUrl.split('?')[0]
    if (!u.startsWith('/')) return
    setVggtSessionUrls((prev) => [...new Set([...prev, u])])
  }, [])

  const hashLabel = lastValidatedCode === draftCode && lastValidatedHash ? lastValidatedHash.slice(0, 10) : '未验证'
  const displaySource = draftCode ? codeSource : 'none'

  const vggtSources = useMemo(() => {
    const out: { kind: 'reference' | 'schedule'; label: string; url: string }[] = []
    for (const url of vggtSessionUrls) {
      const u = String(url || '').split('?')[0]
      if (u.startsWith('/')) out.push({ kind: 'reference', label: '参考片', url: u })
    }
    const sched = String(renderedVideo || entry.video || '').split('?')[0]
    if (sched.startsWith('/')) {
      out.push({ kind: 'schedule', label: '当前白模 MP4（只读）', url: sched })
    }
    return out
  }, [vggtSessionUrls, renderedVideo, entry.video])

  const injectVggtToChat = useCallback((text: string) => {
    setComposerSeed(undefined)
    requestAnimationFrame(() => {
      setComposerSeed(text)
      setSideTab('chat')
    })
  }, [])

  return (
    <div
      className="cw-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="白模代码工作台"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="cw-shell">
        <header className="cw-head cw-command-bar">
          <div className="cw-command-meta">
            <b className="cw-command-title">白模工作台</b>
            <div className="cw-chip-row" role="list">
              <span className="cw-chip" role="listitem">
                {entry.title}
              </span>
              <span className="cw-chip muted" role="listitem">
                {duration.toFixed(1)}s · {projectAspect}
              </span>
              <span className={`cw-chip ${readOnly3d ? 'legacy' : displaySource}`} role="listitem">
                {readOnly3d ? '旧 Three.js' : sourceLabel(displaySource)}
              </span>
              <span className="cw-chip mono subtle" role="listitem" title="代码 hash">
                {hashLabel}
              </span>
            </div>
          </div>
          <div className="cw-command-actions">
            <div className="cw-history-group" role="group" aria-label="编辑历史">
              <button className="btn-mini" onClick={() => void undo()} disabled={!past.length} title="撤销">
                撤销
              </button>
              <button className="btn-mini" onClick={() => void redo()} disabled={!future.length} title="重做">
                重做
              </button>
            </div>
            <button className="btn" onClick={() => void saveNow()} disabled={!!renderBusy || generating}>
              保存
            </button>
            <button
              className="btn primary"
              onClick={() => void renderNow()}
              disabled={!!renderBusy || generating || !draftCode || readOnly3d}
            >
              {renderBusy ? `渲染 ${Math.round(renderBusy.progress * 100)}%` : '渲染视频'}
            </button>
            <button className="btn-ghost" onClick={requestClose}>
              关闭
            </button>
          </div>
        </header>

        {!consent && !readOnly3d && (
          <div className="cw-legacy-bar">
            <b>执行模型告知</b>
            <span>
              3D 代码以本机用户权限在 Blender 进程中执行，只有静态准入与一次性工作目录，不是浏览器沙箱；请只运行你信任的代码。
            </span>
            <button
              className="btn-mini"
              onClick={() => {
                try {
                  localStorage.setItem('sceneBlenderConsent', '1')
                } catch {
                  /* 记不住就每次提醒 */
                }
                setConsent(true)
              }}
            >
              知道了
            </button>
          </div>
        )}

        {readOnly3d && (
          <div className="cw-legacy-bar">
            <b>旧 Three.js 代码只读</b>
            <span>
              这版代码由浏览器 Three.js 运行时生成，不能在本机 Blender 中渲染。请新建一条白模，用 Blender Python 代码重写运镜。
            </span>
          </div>
        )}

        <div className="cw-body cw-body--stage">
          <main className="cw-main cw-stage">
            <div className="cw-preview-head">
              <div>
                <b>白模预览</b>
                <span className="cw-preview-status">
                  {readOnly3d
                    ? '旧代码只读'
                    : previewState === 'starting'
                      ? `代理渲染中… ${Math.round(previewProgress * 100)}%`
                      : previewState === 'error'
                        ? '渲染失败'
                        : previewState === 'ready'
                          ? `可预览 · Blender ${engine?.version || '未检测'}`
                          : '等待代码'}
                </span>
              </div>
              <div className="cw-preview-actions">
                {!readOnly3d && (
                  <button
                    className="btn-mini"
                    onClick={() => void generateCode()}
                    disabled={generating || !modelKey || !engine?.ok}
                    title={!engine?.ok ? '需要先安装受支持的 Blender' : undefined}
                  >
                    {generating ? '生成中…' : '生成白模代码'}
                  </button>
                )}
                {generating && <button className="btn-mini" onClick={cancelGenerate}>取消</button>}
                {!readOnly3d && !draftCode && <button className="btn-mini" onClick={() => void useEmptyCode()}>空白模板</button>}
                {renderedVideo && (
                  <a
                    className="cw-link"
                    data-video-status={renderedVideoStatus}
                    style={{ color: renderedVideoStatus === '生效' ? 'var(--ok)' : 'var(--warn)' }}
                    href={renderedVideo}
                    target="_blank"
                    rel="noreferrer"
                    title={
                      renderedVideoStatus === '生效'
                        ? '最近渲染的视频与当前草稿一致'
                        : '旧视频：当前代码已变化，需要重新渲染'
                    }
                  >
                    最近视频 · {renderedVideoStatus}
                  </a>
                )}
              </div>
            </div>

            {generateError && <div className="cw-alert danger">{generateError}</div>}
            {previewError && <div className="cw-alert danger">{previewError}</div>}
            {missingPreviewAssets.length > 0 && (
              <div className="cw-alert warn">运行时缺少素材：{missingPreviewAssets.join('、')}</div>
            )}

            <div className="cw-preview-wrap">
              <div
                className="cw-preview"
                ref={previewHostRef}
                style={readOnly3d ? { visibility: 'hidden', position: 'absolute' } : undefined}
              >
                {previewUrl && !readOnly3d && (
                  <video
                    ref={videoRef}
                    className="cw-preview-video"
                    src={previewUrl}
                    playsInline
                    muted
                    preload="auto"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  />
                )}
              </div>
              {!readOnly3d && !draftCode && previewState !== 'starting' && (
                <div className="cw-empty-preview">
                  <b>还没有代码</b>
                  <span>
                    {!engine?.ok
                      ? '需要先安装受支持的 Blender，才能生成和渲染白模代码。'
                      : !modelKey
                        ? '没有配置白模 3D 代码模型；可以在代码页签手写。'
                        : '生成一版代码，或在右侧聊天里描述场景；也可以切到代码页签手写。'}
                  </span>
                  {engine?.ok && modelKey && (
                    <button className="btn primary" onClick={() => void generateCode()}>
                      生成白模代码
                    </button>
                  )}
                </div>
              )}
              {!readOnly3d && previewState === 'starting' && !previewUrl && (
                <div className="cw-preview-overlay">
                  代理渲染中… {Math.round(previewProgress * 100)}%
                </div>
              )}
            </div>

            {!readOnly3d && (
              <div className="cw-transport-dock">
              <button className="btn-mini" onClick={togglePlay} disabled={previewState !== 'ready'}>
                {playing ? '暂停' : '播放'}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
                disabled={previewState !== 'ready'}
                aria-label="代码预览时间轴"
              />
              <span className="mono">
                {time.toFixed(2)} / {duration.toFixed(1)}s
              </span>
              {renderBusy && <button className="btn-mini" onClick={cancelRender}>取消渲染</button>}
              </div>
            )}

            <div className="cw-footnotes">
              <span>
                {readOnly3d
                  ? '旧代码只读：浏览器 Three.js 产物无法在本机 Blender 渲染。'
                  : '白模只对齐运镜与构图意图，不进成片人物外观；渲染出的 MP4 可发布为素材卡或在分镜里当运镜参照。VGGT 几何在右侧「几何」页签摄取，不写镜级参考板。'}
              </span>
              {renderError && <span className="cw-danger">{renderError}</span>}
              {saveError && <span className="cw-danger">{saveError}</span>}
            </div>
          </main>

          <aside className="cw-side cw-work-pane">
            <div className="cw-work-tabs" role="tablist" aria-label="工作台页签">
              <button
                role="tab"
                aria-selected={sideTab === 'chat'}
                className={sideTab === 'chat' ? 'on' : ''}
                onClick={() => switchSideTab('chat')}
              >
                对话
              </button>
              <button
                role="tab"
                aria-selected={sideTab === 'code'}
                className={sideTab === 'code' ? 'on' : ''}
                onClick={() => switchSideTab('code')}
              >
                代码
              </button>
              {!readOnly3d && (
                <button
                  role="tab"
                  aria-selected={sideTab === 'geom'}
                  className={sideTab === 'geom' ? 'on' : ''}
                  onClick={() => switchSideTab('geom')}
                >
                  几何
                </button>
              )}
            </div>
            {onPickStageModel && (
              <div className="cw-model-row">
                <StageModelSelect
                  stage="sceneCode"
                  label="代码模型"
                  settings={settings}
                  pick={stagePick}
                  onChange={onPickStageModel}
                  className="wb-field cw-model-select"
                />
              </div>
            )}

            <div className="cw-side-pane" hidden={sideTab !== 'chat'} aria-hidden={sideTab !== 'chat'}>
              <Suspense fallback={<div style={{ padding: 16, color: "var(--muted)", fontSize: 12 }}>正在加载 agent 聊天…</div>}>
                <LazySceneAgentChat
                  settings={settings}
                  stagePick={stagePick}
                  manifest={manifest}
                  threadKey={{ project: projectName, surface: 'lexicon', shotId: entry.id }}
                  prepareAgent={prepareAgent}
                  onDraftCode={applyAgentDraft}
                  onVideoAccepted={acceptAgentVideo}
                  onOpenCode={() => switchSideTab('code')}
                  onToast={toast}
                  currentCode={draftCode}
                  width={width}
                  height={height}
                  aspect={projectAspect}
                  duration={duration}
                  composerSeed={composerSeed}
                />
              </Suspense>
            </div>
            <div className="cw-side-pane" hidden={sideTab !== 'code'} aria-hidden={sideTab !== 'code'}>
              <div className="cw-code-panel">
                <div className="cw-code-meta">
                  <span>来源：{sourceLabel(codeSource)}</span>
                  <span className="mono">hash {hashLabel}</span>
                </div>
                <textarea
                  className="cw-code"
                  value={draftCode}
                  onChange={(e) => updateCode(e.target.value)}
                  spellCheck={false}
                  readOnly={readOnly3d}
                  aria-label="场景代码"
                />
                <label className="cw-motion">
                  <span>运镜说明（给下游视频模型；不是由代码自动推导）</span>
                  <input
                    value={draftMotionNote}
                    onChange={(e) => {
                      pushCurrent()
                      setDraftMotionNote(e.target.value)
                    }}
                    placeholder="例如：镜头缓慢推近，角色从左侧入画"
                  />
                </label>
                <div className="cw-code-actions">
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        const prepared = await ensurePrepared()
                        await runTrial(draftCode, prepared)
                        setLastValidatedCode(draftCode)
                        setLastValidatedHash(await codeHashOf(draftCode))
                        await startPreview(draftCode, prepared)
                        toast('代码试运行通过')
                      } catch (e) {
                        setPreviewState('error')
                        setPreviewError(sceneCodeRenderError(e))
                      }
                    }}
                    disabled={!draftCode.trim() || readOnly3d}
                  >
                    运行
                  </button>
                  <button className="btn primary" onClick={() => void saveNow()} disabled={!draftCode.trim() || readOnly3d}>
                    保存
                  </button>
                </div>
              </div>
            </div>
            {!readOnly3d && (
              <div
                className="cw-side-pane cw-geom-pane"
                hidden={sideTab !== 'geom'}
                aria-hidden={sideTab !== 'geom'}
                role="tabpanel"
              >
                <p className="cw-geom-lead">
                  从参考片或面板内上传摄取几何；摘要可一键贴到对话，不会写入镜级参考板。
                </p>
                <VggtGeometryPanel
                  projectName={projectName}
                  projectAspect={projectAspect}
                  effectiveSeconds={duration}
                  sources={vggtSources}
                  onCopyToChat={injectVggtToChat}
                  onIngested={onVggtIngested}
                  onToast={toast}
                  geometryBusy={Boolean(renderBusy) || generating}
                />
              </div>
            )}
          </aside>
        </div>
      </div>

      {closeAsk && (
        <div className="cw-close-ask" role="alertdialog" aria-modal="true">
          <div>
            <b>有未保存的 3D 代码修改</b>
            <p>保存后再关闭，还是放弃本次修改？</p>
            <div className="cw-close-actions">
              <button className="btn primary" onClick={() => void saveAndClose()}>保存并关闭</button>
              <button className="btn" onClick={discardAndClose}>放弃修改</button>
              <button className="btn-ghost" onClick={() => setCloseAsk(false)}>继续编辑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
