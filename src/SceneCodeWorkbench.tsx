import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterSheet } from './characters'
import type { AppSettings, MediaBundle, ProjectAsset, ProjectData } from './api'
import { getProject, listMedia } from './api'
import type { ScheduleMeta, SceneCode, SceneCodeMeta, Shot3DContext, ShotData } from './types'
import { SCENE_CODE_LIMITS, effectiveSeconds, isRenderableSceneCode, sceneCodeRuntime } from './types'
import type { ShotNodeType } from './data'
import type { StagePick } from './ModelSelect'
import { stageModelKey, StageModelSelect } from './ModelSelect'
import { renderSize } from './scheduleGeometry'
import Shot3DContextPicker from './Shot3DContextPicker'
import {
  allCatalogItems,
  buildShot3DContextCatalog,
  itemIsSelected,
  missingSelectionItems,
  toggleContextItem,
  type Shot3DContextCatalog,
} from './shot3dContextCatalog'
import {
  contextCount,
  contextFingerprint,
  dialogueHashOf,
  emptyShot3DContext,
  inheritShot3DContext,
  sanitizeShot3DContext,
  selectedDialogue,
} from './shot3dContext'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import { prepareSceneCodeContext, type PreparedCodeContext } from './sceneCodePrepare'
import { renderSceneCode, trialSceneCode, sceneCodeRenderError } from './sceneCodeRender'
import { abortError, blenderHealth, type BlenderHealth } from './sceneBlender'
import { codeHashOf, sceneCodeFingerprint } from './sceneCodeFingerprint'
import { buildManifest, type ContextManifest } from './contextManifest'
import { isSceneCodeFresh } from './sceneCodeFreshness'
import { runSceneCodeJob } from './sceneCodeJob'
import { checkSceneCode } from './sceneCodeSanitize'
import type { AgentVideoAcceptedInput } from './agent/sceneAgentTypes'

const LazySceneAgentChat = lazy(() => import('./agent/SceneAgentChat'))

type Props = {
  projectName: string
  node: ShotNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  assets: ProjectAsset[]
  sceneLayouts: import('./types').SceneLayout[]
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
  shot3DContext: Shot3DContext
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
  context: Shot3DContext | null
  motionNote: string
}

type PreparedContext = PreparedCodeContext & { cacheKey: string }

type PreparedInfo = {
  contextFp: string
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
  s ? JSON.stringify({ code: s.code, context: s.context, motionNote: s.motionNote }) : ''

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
  node,
  nodes,
  characters,
  assets,
  sceneLayouts,
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
  const shotId = node.data.shotId || node.id
  const episodeNo = Number(node.data.episode) || 1
  const sceneNo = Math.max(1, Number(node.data.sceneNo) || 1)
  const duration = effectiveSeconds(node.data.seconds)
  const { width, height } = renderSize(projectAspect)
  const legacyAvailable = !node.data.sceneCode && Boolean(node.data.shotScene || node.data.shotBlocking || node.data.layout)

  const [project, setProject] = useState<ProjectData | null>(null)
  const [media, setMedia] = useState<MediaBundle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [catalog, setCatalog] = useState<Shot3DContextCatalog | null>(null)
  const [context, setContext] = useState<Shot3DContext | null>(() =>
    node.data.shot3DContext ? sanitizeShot3DContext(node.data.shot3DContext) : null,
  )
  const [savedCode, setSavedCode] = useState<SceneCode | undefined>(node.data.sceneCode)
  const [draftCode, setDraftCode] = useState(node.data.sceneCode?.code || '')
  const [draftMotionNote, setDraftMotionNote] = useState(
    node.data.sceneCode?.motionNote || node.data.motionNote || '',
  )
  const [codeSource, setCodeSource] = useState<SceneCode['source']>(node.data.sceneCode?.source || 'ai')
  const [lastValidatedCode, setLastValidatedCode] = useState(node.data.sceneCode?.code || '')
  const [lastValidatedHash, setLastValidatedHash] = useState(node.data.sceneCode?.codeHash || '')
  const [lastValidatedContextFp, setLastValidatedContextFp] = useState('')
  const [legacyMode, setLegacyMode] = useState(Boolean(legacyAvailable))
  const [baseline, setBaseline] = useState<Snapshot | null>(null)
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [sideTab, setSideTab] = useState<'chat' | 'code'>('chat')
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
  const [renderedVideo, setRenderedVideo] = useState(node.data.scheduleVideo || '')
  const [saveError, setSaveError] = useState('')
  const [closeAsk, setCloseAsk] = useState(false)
  const [ctxOpen, setCtxOpen] = useState(true)

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
    () => ({ code: draftCode, context, motionNote: draftMotionNote }),
    [draftCode, context, draftMotionNote],
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
      node.data.sceneCodeMeta &&
      savedCode.code === draftCode &&
      isSceneCodeFresh({
        sceneCode: savedCode,
        meta: node.data.sceneCodeMeta,
        context: context ?? undefined,
        seconds: duration,
        aspect: projectAspect,
        hasVideo: true,
      }),
  )
  const renderedVideoStatus = !renderedVideo ? '未渲染' : renderedVideoFresh ? '生效' : '已过期'
  /** 旧结构化数据或 v1（Three.js）代码：只读，不能渲染，只能显式转换。 */
  const legacyCode = Boolean(savedCode && !isRenderableSceneCode(savedCode))
  const readOnly3d = legacyMode || legacyCode

  const switchSideTab = (next: 'chat' | 'code') => {
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
  const selectedItems = useMemo(() => {
    if (!catalog || !context) return []
    return [
      ...allCatalogItems(catalog).filter((item) => itemIsSelected(context, item)),
      ...missingSelectionItems(catalog, context),
    ]
  }, [catalog, context])
  const manifest = useMemo<ContextManifest>(() => {
    if (!context || !catalog) {
      return {
        version: 1,
        shot: { no: String(node.data.no || ''), duration, aspect: projectAspect },
        attachments: [],
      }
    }
    return buildManifest({
      context,
      catalog,
      shotNo: String(node.data.no || ''),
      duration,
      aspect: projectAspect,
    })
  }, [context, catalog, node.data.no, duration, projectAspect])
  const contextChanged = Boolean(
    context && preparedInfo && preparedInfo.contextFp !== contextFingerprint(context),
  )
  const selectedTextCount =
    context === null
      ? 0
      : Number(context.text.prompt) +
        Number(context.text.videoPrompt) +
        Number(context.text.cast) +
        Number(context.text.marks) +
        Number(context.text.sizeMove) +
        (context.text.dialogue === 'all' ? catalog?.text.dialogue.length || 0 : context.text.dialogue.length)

  const previousSelection = useMemo(() => {
    if (!project?.shots) return null
    const idx = project.shots.findIndex((s) => s.id === shotId)
    if (idx <= 0) return null
    const ep = Number(project.shots[idx].episode) || 1
    const sn = Math.max(1, Number(project.shots[idx].scene_no) || 1)
    for (let i = idx - 1; i >= 0; i--) {
      const s = project.shots[i]
      if ((Number(s.episode) || 1) !== ep) continue
      if (Math.max(1, Number(s.scene_no) || 1) !== sn) continue
      const raw = s.shot_3d_context ?? s.shot3DContext
      if (raw) return sanitizeShot3DContext(raw)
    }
    return null
  }, [project, shotId])

  useEffect(() => {
    let alive = true
    Promise.all([getProject(projectName).catch(() => null), listMedia(projectName)])
      .then(([p, m]) => {
        if (!alive) return
        setProject(p)
        setMedia(m)
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [projectName])

  useEffect(() => {
    if (!loaded) return
    const c = buildShot3DContextCatalog({
      project,
      characters,
      shot: {
        ...node.data,
        episode: episodeNo,
        sceneNo,
        sceneSlug: node.data.sceneSlug || '',
      },
      media,
      nodes,
      sceneNo,
      sceneSlug: node.data.sceneSlug || '',
    })
    setCatalog(c)
    setContext((prev) =>
      prev ??
      (node.data.shot3DContext
        ? sanitizeShot3DContext(node.data.shot3DContext)
        : emptyShot3DContext(dialogueHashOf(node.data.dialogue))),
    )
  }, [loaded, project, media, characters, nodes, node.id, node.data.sceneNo, node.data.sceneSlug, node.data.shot3DContext])

  useEffect(() => {
    rootRef.current?.focus()
    // 窄屏优先保证预览和 agent 聊天宽度；参考内容仍可从顶部按钮打开。
    const mq = window.matchMedia?.('(max-width: 980px)')
    if (!mq) return
    const apply = () => {
      if (mq.matches) setCtxOpen(false)
    }
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
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

  const setContextSafe = useCallback(
    (next: Shot3DContext) => {
      pushCurrent()
      setContext(next)
      preparedRef.current = null
      setPreparedInfo(null)
    },
    [pushCurrent],
  )

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
      setContext(s.context)
      setDraftMotionNote(s.motionNote)
      preparedRef.current = null
      setPreparedInfo(null)
      if (codeChanged && s.code.trim() && s.context && catalog) {
        const prepared = await ensurePrepared(s.context, catalog)
        await startPreview(s.code, prepared)
      }
    },
    [catalog, draftCode],
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
    async (ctx: Shot3DContext, cat: Shot3DContextCatalog, signal?: AbortSignal, allowVideoVision = false): Promise<PreparedContext> => {
      const fp = `${contextFingerprint(ctx)}|${stageModelKey(settings, 'vision', stagePick)}`
      if (preparedRef.current?.cacheKey === fp) return preparedRef.current
      const prepared = await prepareSceneCodeContext({
        context: ctx,
        catalog: cat,
        settings,
        stagePick,
        signal,
        allowVideoVision,
      })
      const value: PreparedContext = { ...prepared, cacheKey: fp }
      if (!signal?.aborted) {
        preparedRef.current = value
        setPreparedInfo({
          contextFp: prepared.contextFp,
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
          shot: { no: node.data.no, seconds: node.data.seconds, size: node.data.size, move: node.data.move },
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
    [disposePreview, duration, projectAspect, node.data.no, node.data.seconds, node.data.size, node.data.move],
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
      setLastValidatedContextFp(context ? contextFingerprint(context) : '')
      setLegacyMode(false)
      await startPreview(result.code, prepared)
    },
    [draftMotionNote, pushCurrent, startPreview],
  )

  const generateCode = async (auto = false, convert = false) => {
    if (generating || !context || !catalog) return
    if (!contextCount(context)) {
      setGenerateError('请至少选择一项参考内容')
      return
    }
    if (!modelKey) {
      setGenerateError('没有可用的 3D 代码文本模型，请到设置页绑定「3D 代码」环节；也可以直接手写代码')
      return
    }
    const ac = new AbortController()
    generateAbortRef.current = ac
    setGenerating(true)
    setGenerateError('')
    setGenerateLabel(convert ? '正在把旧结构化 3D 转成代码…' : auto ? '正在生成 3D 代码…' : '正在重写 3D 代码…')
    try {
      const prepared = await ensurePrepared(context, catalog, ac.signal, true)
      const legacyScene = convert
        ? {
            shotScene: node.data.shotScene,
            shotBlocking: node.data.shotBlocking,
            layout: node.data.layout,
            sceneLayouts,
            // v1 Three.js 代码只作转换参考；新代码必须是 bpy。
            ...(legacyCode && savedCode ? { legacyCode: savedCode.code } : {}),
          }
        : undefined
      const result = await runSceneCodeJob({
        shot: { ...node.data, episode: episodeNo, sceneNo, sceneSlug: node.data.sceneSlug || '' },
        project,
        context,
        catalog,
        assets: prepared.assets,
        mediaBrief: prepared.mediaBrief,
        videoBrief: prepared.videoBrief,
        duration,
        aspect: projectAspect,
        settings,
        stagePick,
        legacyScene,
        signal: ac.signal,
        trial: async (code) => runTrial(code, prepared, ac.signal),
      })
      if (ac.signal.aborted) return
      await applyGeneratedCode(result, convert ? 'legacy-converted' : 'ai', prepared)
      if (convert) {
        const code = await buildSceneCode(result.code, 'legacy-converted', result.motionNote || draftMotionNote)
        await onSave({
          sceneCode: code,
          shot3DContext: context,
          ...(node.data.sceneCodeMeta ? { sceneCodeMeta: node.data.sceneCodeMeta } : {}),
        })
        setSavedCode(code)
        setBaseline({ code: result.code, context, motionNote: result.motionNote || draftMotionNote })
        toast('旧结构化 3D 已转换为代码并保存')
      } else {
        toast('3D 代码已生成，可试运行后保存')
      }
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
    if (!catalog || !context || initRef.current) return
    initRef.current = true
    const base: Snapshot = { code: draftCode, context, motionNote: draftMotionNote }
    setBaseline(base)
    if (draftCode) {
      // v1 Three.js 代码只读，不能送进 Blender；打开时不要自动渲染。
      if (legacyCode) {
        setPreviewState('idle')
        setPreviewError('')
        return
      }
      const saved = node.data.sceneCode
      const meta = node.data.sceneCodeMeta
      const fresh = Boolean(
        saved &&
          meta &&
          node.data.scheduleVideo &&
          isSceneCodeFresh({
            sceneCode: saved,
            meta,
            context,
            seconds: duration,
            aspect: projectAspect,
            hasVideo: true,
          }),
      )
      if (fresh && node.data.scheduleVideo) {
        // 已有生效视频直接当代理片，省掉一次整段渲染。
        setPreviewUrl(node.data.scheduleVideo)
        setPreviewState('ready')
        setTime(0)
        return
      }
      try {
        const prepared = await ensurePrepared(context, catalog)
        await startPreview(draftCode, prepared)
      } catch (e) {
        setPreviewState('error')
        setPreviewError(sceneCodeRenderError(e))
      }
    }
  }, [
    catalog,
    context,
    draftCode,
    draftMotionNote,
    ensurePrepared,
    startPreview,
    legacyCode,
    node.data.sceneCode,
    node.data.sceneCodeMeta,
    node.data.scheduleVideo,
    duration,
    projectAspect,
  ])

  useEffect(() => {
    if (loaded && catalog && context) void init()
  }, [loaded, catalog, context, init])

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
      selectionFingerprint: contextFingerprint(input.context),
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
      shot3DContext: input.context,
      sceneCodeMeta,
      video: input.video,
      scheduleMeta,
      useFrames: false,
    })
    setSavedCode(code)
    setDraftCode(input.code)
    setContext(input.context)
    setCodeSource('ai')
    setLegacyMode(false)
    setRenderedVideo(input.video)
    setLastValidatedCode(input.code)
    setLastValidatedHash(code.codeHash)
    setLastValidatedContextFp(contextFingerprint(input.context))
    // 保留 onDraftCode 推入的撤销栈：应用验收结果不应清空「改之前」的快照。
    setBaseline({ code: input.code, context: input.context, motionNote: draftMotionNote })
  }

  const saveNow = async (): Promise<boolean> => {
    if (!context || !catalog) return false
    const checked = checkSceneCode(draftCode)
    if (!checked.ok) {
      setSaveError(checked.errors[0] || '代码不可用')
      return false
    }
    setSaveError('')
    try {
      let prepared = preparedRef.current
      if (!prepared || prepared.cacheKey !== `${contextFingerprint(context)}|${stageModelKey(settings, 'vision', stagePick)}`) {
        prepared = await ensurePrepared(context, catalog)
      }
      const currentContextFp = contextFingerprint(context)
      if (draftCode !== lastValidatedCode || currentContextFp !== lastValidatedContextFp) {
        await runTrial(draftCode, prepared)
        setLastValidatedCode(draftCode)
        setLastValidatedHash(await codeHashOf(draftCode))
        setLastValidatedContextFp(currentContextFp)
      }
      const code = await buildSceneCode(draftCode, codeSource, draftMotionNote)
      await onSave({
        sceneCode: code,
        shot3DContext: context,
        ...(node.data.sceneCodeMeta ? { sceneCodeMeta: node.data.sceneCodeMeta } : {}),
      })
      setSavedCode(code)
      setBaseline({ code: draftCode, context, motionNote: draftMotionNote })
      setPast([])
      setFuture([])
      toast('已保存 3D 代码和参考内容')
      return true
    } catch (e) {
      setSaveError(sceneCodeRenderError(e))
      return false
    }
  }

  const renderNow = async () => {
    if (!context || !catalog || renderBusy) return
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
      const prepared = await ensurePrepared(context, catalog, ac.signal)
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
        selectionFingerprint: contextFingerprint(context),
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
        shot3DContext: context,
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
      setLastValidatedContextFp(contextFingerprint(context))
      setBaseline({ code: draftCode, context, motionNote: draftMotionNote })
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
    if (!context || !catalog) return
    try {
      const prepared = await ensurePrepared(context, catalog)
      const hash = await codeHashOf(FALLBACK_SCENE_CODE)
      await applyGeneratedCode({ code: FALLBACK_SCENE_CODE, codeHash: hash, motionNote: '空白模板场景' }, 'fallback', prepared)
    } catch (e) {
      setGenerateError(sceneCodeRenderError(e))
    }
  }

  const inheritSelection = () => {
    if (!previousSelection) {
      toast('没有同集同场上一镜的选择可沿用')
      return
    }
    setContextSafe(inheritShot3DContext(previousSelection, dialogueHashOf(node.data.dialogue)))
    toast('已沿用上一镜的参考内容选择')
  }

  const removeSelected = (key: string) => {
    if (!context || !catalog) return
    const item = selectedItems.find((x) => x.key === key)
    if (!item) return
    setContextSafe(toggleContextItem(context, item))
  }

  const removeAttachment = (key: string) => {
    if (!context) return
    if (key.startsWith('text:')) {
      const text = context.text
      if (key === 'text:prompt') setContextSafe({ ...context, text: { ...text, prompt: false } })
      else if (key === 'text:videoPrompt') setContextSafe({ ...context, text: { ...text, videoPrompt: false } })
      else if (key === 'text:cast') setContextSafe({ ...context, text: { ...text, cast: false } })
      else if (key === 'text:sizeMove') setContextSafe({ ...context, text: { ...text, sizeMove: false } })
      else if (key === 'text:marks') setContextSafe({ ...context, text: { ...text, marks: false } })
      else if (key === 'text:dialogue') setContextSafe({ ...context, text: { ...text, dialogue: [] } })
      else if (key.startsWith('text:scene:')) {
        const sceneKey = key.slice('text:scene:'.length)
        setContextSafe({ ...context, sceneKeys: context.sceneKeys.filter((k) => k !== sceneKey) })
      }
      return
    }
    removeSelected(key)
  }

  const toggleBrief = (key: string) => {
    if (!context) return
    const off = new Set(context.briefOff || [])
    if (off.has(key)) off.delete(key)
    else off.add(key)
    setContextSafe({ ...context, briefOff: [...off] })
  }

  const clearAttachments = () => {
    if (!context) return
    setContextSafe(emptyShot3DContext(dialogueHashOf(node.data.dialogue)))
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

  const prepareAgent = async () => {
    if (!context || !catalog) throw new Error('镜头上下文还没有加载完成')
    return ensurePrepared(context, catalog)
  }

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
    setLastValidatedContextFp(context ? contextFingerprint(context) : '')
    setLegacyMode(false)
    await startPreview(code, prepared)
  }

  const hashLabel = lastValidatedCode === draftCode && lastValidatedHash ? lastValidatedHash.slice(0, 10) : '未验证'
  const displaySource = draftCode ? codeSource : 'none'
  const legacyScene = {
    shotScene: node.data.shotScene,
    shotBlocking: node.data.shotBlocking,
    layout: node.data.layout,
    sceneLayouts,
  }

  return (
    <div className="cw-backdrop" role="dialog" aria-modal="true" aria-label="3D 代码工作台" ref={rootRef} tabIndex={-1}>
      <div className="cw-shell">
        <header className="cw-head">
          <div className="cw-title">
            <b>3D 调度</b>
            <span>
              {node.data.no} · E{String(episodeNo).padStart(2, '0')} · {duration.toFixed(1)}s · {projectAspect}
            </span>
            <span className={`cw-source ${readOnly3d ? 'legacy' : displaySource}`}>{sourceLabel(displaySource)}</span>
            {readOnly3d && <span className="cw-badge legacy">{legacyCode ? '旧 Three.js 代码只读' : '旧结构化只读'}</span>}
            <span className="mono cw-hash">{hashLabel}</span>
          </div>
          <div className="cw-actions">
            <button className="btn-mini" onClick={() => void undo()} disabled={!past.length} title="撤销">
              撤销
            </button>
            <button className="btn-mini" onClick={() => void redo()} disabled={!future.length} title="重做">
              重做
            </button>
            <button className="btn-mini cw-ctx-toggle" onClick={() => setCtxOpen((v) => !v)}>
              参考内容 {selectedItems.length + selectedTextCount}
            </button>
            <button className="btn" onClick={() => void saveNow()} disabled={!!renderBusy || generating}>
              保存
            </button>
            <button className="btn primary" onClick={() => void renderNow()} disabled={!!renderBusy || generating || !draftCode || readOnly3d}>
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
            <b>{legacyCode ? '旧 Three.js 代码只读' : '旧结构化 3D 只读'}</b>
            <span>
              {legacyCode
                ? '这版代码由浏览器 Three.js 运行时生成，不能在本机 Blender 中渲染；转换后会得到可渲染的 Blender Python 代码。'
                : '这里展示的是旧 shotScene / shotBlocking 数据；旧白模预览已下线。转成 Blender Python 代码并试运行通过后才写入 sceneCode。'}
            </span>
            <button
              className="btn-mini"
              onClick={() => void generateCode(false, true)}
              disabled={generating || !modelKey || !engine?.ok || !context || !catalog}
              title={
                !engine?.ok
                  ? '需要先安装受支持的 Blender'
                  : !context || !catalog
                    ? '正在加载镜头上下文…'
                    : undefined
              }
            >
              {generating ? '转换中…' : '转换为 Blender 代码'}
            </button>
          </div>
        )}

        <div className={`cw-body ${ctxOpen ? '' : 'ctx-collapsed'}`}>
          {ctxOpen && catalog && context && (
            <aside className="cw-context">
              <Shot3DContextPicker
                catalog={catalog}
                value={context}
                projectName={projectName}
                currentEpisode={episodeNo}
                onChange={setContextSafe}
                onInherit={inheritSelection}
                onToast={toast}
              />
            </aside>
          )}

          <main className="cw-main">
            <div className="cw-preview-head">
              <div>
                <b>3D 预览</b>
                <span className="cw-preview-status">
                  {readOnly3d
                    ? '旧数据只读 · 需转换'
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
                    onClick={() => void generateCode(false, false)}
                    disabled={generating || !modelKey || !context || contextCount(context) === 0 || !engine?.ok}
                    title={
                      !engine?.ok
                        ? '需要先安装受支持的 Blender'
                        : !context || contextCount(context) === 0
                          ? '先在左侧选择参考'
                          : undefined
                    }
                  >
                    {generating ? '生成中…' : '生成 3D 代码'}
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
                        : '旧视频：当前代码/参考内容已变化，需要重新渲染'
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
                      ? '需要先安装受支持的 Blender，才能生成和渲染 3D 代码。'
                      : !modelKey
                        ? '没有配置 3D 代码模型；可以在代码页签手写。'
                        : context && contextCount(context) > 0
                          ? '生成一版代码，或在右侧聊天里描述场景；也可以切到代码页签手写。'
                          : '先从左侧选择参考，或在右侧聊天里描述场景；也可以切到代码页签手写。'}
                  </span>
                  {engine?.ok && modelKey && context && contextCount(context) > 0 && (
                    <button className="btn primary" onClick={() => void generateCode(true)}>
                      生成 3D 代码
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

            {!readOnly3d && <div className="cw-timeline">
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
            </div>}

            <div className="cw-footnotes">
              <span>{readOnly3d ? '旧数据只读；转换为 Blender 代码并试运行通过后才会切换。' : '纯代码模式：不做角色名单、穿墙/碰撞或空间连续性校验；请以代码、渲染结果和运行错误为准。'}</span>
              {preparedInfo && (
                <span>
                  素材 {preparedInfo.count} 个{preparedInfo.missing ? `，缺失 ${preparedInfo.missing}` : ''} ·{' '}
                  {preparedInfo.usedVision ? '媒体 brief 已参与' : '素材未参与理解'}
                </span>
              )}
              {contextChanged && <span className="cw-warn">上下文已变化；重新运行/渲染会使用新选择。</span>}
              {renderError && <span className="cw-danger">{renderError}</span>}
              {saveError && <span className="cw-danger">{saveError}</span>}
            </div>
          </main>

          <aside className="cw-side">
            <div className="cw-side-tabs">
              <button className={sideTab === 'chat' ? 'on' : ''} onClick={() => switchSideTab('chat')}>
                聊天
              </button>
              <button className={sideTab === 'code' ? 'on' : ''} onClick={() => switchSideTab('code')}>
                代码
              </button>
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
                  threadKey={{ project: projectName, surface: 'scene3d', shotId }}
                  onRemoveAttachment={removeAttachment}
                  onToggleBrief={toggleBrief}
                  onClearAttachments={clearAttachments}
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
                      if (!context || !catalog) return
                      try {
                        const prepared = await ensurePrepared(context, catalog)
                        await runTrial(draftCode, prepared)
                        setLastValidatedCode(draftCode)
                        setLastValidatedHash(await codeHashOf(draftCode))
                        setLastValidatedContextFp(contextFingerprint(context))
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
