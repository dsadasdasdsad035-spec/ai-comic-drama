import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react'

import '@xyflow/react/dist/style.css'
import './theme.css'
// 聊天层的 Tailwind/shadcn token 是全局一次加载的；不能只在 3D 工作台懒加载，
// 否则五个工作台的聊天在没打开过 3D 时拿不到工具类。
import './chat-ui/chat.css'

import ShotNode from './ShotNode'
import CharNode from './CharNode'
import AssetNode from './AssetNode'
import ShotEdge from './ShotEdge'
import Inspector from './Inspector'
import Timeline from './Timeline'
import CharacterBoard from './CharacterBoard'
import AssetBoard from './AssetBoard'
import ThemeToggle from './ThemeToggle'
import { ThemeProvider, useTheme } from './theme'
import Preview from './Preview'
import ShotTable from './ShotTable'
import PromptTable from './PromptTable'
import EpPicker from './EpisodeBar'
import ScriptBoard from './ScriptBoard'
import ProjectSelect from './ProjectSelect'
import ProjectMenu from './project/ProjectMenu'
import TaskCenter from './TaskCenter'
import ToolMenu from './ToolMenu'
import BoardMenu from './BoardMenu'
import TransitionPanel from './TransitionPanel'
import NodeContextMenu from './NodeContextMenu'
import Settings from './Settings'
import PublishBoard from './PublishBoard'
import CreativeStudio from './creative/CreativeStudio'
import { cancelTask, endTask, startTask } from './tasks'
import { DiagnosticsPanel, diagnose } from './Diagnostics'
import { defaultCharacters, identityFingerprint, markExpressionSheetStale, markExpressionsStale, markVoiceSampleStale, type CharacterSheet } from './characters'
import { isSheetUsable } from './expressionSheet'
import { CanvasCtx } from './ctx'
import { initialEdges, initialNodes, type AssetNodeType, type CharNodeType, type ShotEdgeType, type ShotNodeType } from './data'
import { assetMediaType } from './mediaPick'
import { cardWidth, effectiveSeconds, isRenderableSceneCode, migrateMarks, uid, type Relation, type ScheduleMeta, type SceneCodeMeta, type SceneLayout, type ShotData, type Tool, type TransitionOut } from './types'
import {
  callText,
  checkHealth,
  generateImage,
  generateVoice,
  extractFrames,
  getSettings,
  saveScheduleVideo,
  listProjects,
  listVoices,
  getProject,
  listMedia,
  mergeProjectShots,
  patchProject,
  startVideo,
  waitVideo,
  type AppSettings,
  type Cap,
  type Stage,
  type ProjectAsset,
  type DesignSheet,
  type ProjectData,
  type ProjectEpisode,
  type ProjectShot,
  type ProjectSummary,
  type VoiceOption,
} from './api'
import { dialogueToText, parseDialogue } from './prompts'
import { deliveryForSpeaker, voiceFingerprint } from './performance'
import { audioRefCapabilitiesFor, nativeAudioFingerprint } from './nativeAudio'
import { resolveVoiceForSpeaker } from './voiceCatalog'
import { audioCost, imageCost, money, normalizePricing, videoCost, type Pricing } from './pricing'
import { fallbackBlocking, isScheduleFresh, legacyLayoutToBlocking, motionNoteOf, renderSize, rosterOf, scheduleFingerprint, validateBlocking } from './scheduleGeometry'
import { collectShotReferences, currentShotImage, hasNeighborReference, limitReferences, neighborReferenceItems, resolveNeighborToken, SHOT_NEXT, SHOT_PREV } from './shotReferences'
import { resolveShotSchedule } from './scheduleStatus'
import { buildShotVideoRequest, effectiveVideoPrompt, type VideoModelInput } from './videoPrompt'
import { type Ask } from './scheduleAI'
import { resolveShotScene } from './shotScene'
import { digestEpisodes, digestShots, mergeCharacters, pickExtracted } from './charExtract'
import { COMPOSE_HINT, composeReference } from './compose'
import { bizSignature, nodeToShot, shotToData } from './shotSync'
import { toProject, toSheet, type ProjectChar } from './charMap'
import { STAGE_PICK_KEY, stageModelKey, type StagePick } from './ModelSelect'
import { ensureSkillsMigrated } from './skills/migrate'
import { assertSkillOutput, buildBoardSkillPrompt } from './skills/board'
import { builtinFailure, type BuiltinResult } from './agent/workbenchChat'
import { buildEditList, transitionFor } from './editList'
import {
  defaultTransition,
  normalizeEffect,
  normalizeGenerated,
  normalizeTransitionOut,
  transitionFingerprint,
  transitionSummary,
} from './transition'
import {
  clampKeyframeRefs,
  effectiveTransitionRefs,
  ensureTransitionBoundary,
  keyframePrompt,
  modelSupportsLastFrame,
  transitionRequestSeconds,
  transitionVideoPrompt,
} from './transitionGen'

const nodeTypes = { shot: ShotNode, char: CharNode, asset: AssetNode }
const edgeTypes = { shot: ShotEdge }

const COLORS = ['#fbbf24', '#f87171', '#38bdf8', '#a3e635', '#c084fc']
const STORAGE_KEY = 'storyboard-canvas-v1'
/** 旧全局画布的备份 key：迁移前先保留一份，可回退 */
const LEGACY_BACKUP_KEY = `${STORAGE_KEY}:legacy-backup`
/** 画布按项目隔离：项目名编码后作为后缀，避免 A/B 串状态 */
const projectCanvasKey = (name: string) => `${STORAGE_KEY}:${encodeURIComponent(name)}`

/** 没有角色卡的出场名字 → 占位节点 id（和角色卡 id 用不同前缀，避免撞名） */
const missCharId = (name: string) => `char-miss-${name}`

/** 角色节点 id → 位置表 key（占位节点用 miss: 前缀，图省事不跟角色 id 混） */
const charKey = (nodeId: string) =>
  nodeId.startsWith('char-miss-') ? `miss:${nodeId.slice('char-miss-'.length)}` : nodeId.slice(5)

/** 角色节点 id → 角色名（占位节点存的就是名单原文） */
const charNameOf = (nodeId: string) =>
  nodeId.startsWith('char-miss-') ? nodeId.slice('char-miss-'.length) : nodeId.slice(5)

/**
 * 出场名单里的名字 → 角色卡。
 * 拆镜产出会带修饰：「陈曦（投影）」「陈默（回忆）」，直接全等匹配会漏，
 * 所以按 精确 → 去括号 → 互相包含 三级退让。
 */
function matchChar(name: string, chars: CharacterSheet[]): CharacterSheet | undefined {
  const strip = (s: string) => s.replace(/[（(][^)）]*[)）]/g, '').trim()
  const n = strip(name)
  return (
    chars.find((c) => c.name === name) ??
    chars.find((c) => strip(c.name) === n) ??
    chars.find((c) => Boolean(n) && Boolean(c.name) && (n.includes(c.name) || c.name.includes(n)))
  )
}

type Saved = {
  nodes: ShotNodeType[]
  edges: ShotEdgeType[]
  characters: CharacterSheet[]
  /** 用户主动清空过画布 —— 没有这个标记，空节点会被当成「首次打开」重置成示例卡 */
  cleared?: boolean
  /** 当前集也要记住，否则刷新后一律回到第 1 集，看起来像「别的集的卡片和视频丢了」 */
  epNo?: number
}

function readSavedKey(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!Array.isArray(p?.nodes)) return null
    if (p.nodes.length === 0 && p.cleared !== true) return null
    // epNo 单独恢复（见下方 useEffect）
    return {
      nodes: p.nodes.map((n: ShotNodeType) => {
        const data = { ...n.data, marks: migrateMarks(n.data?.marks ?? []) }
        if (data.genState === 'running') {
          if (data.refImage || (data.candidates?.length ?? 0) > 0) {
            data.genState = 'error'
            data.genError = '上次生成已中断，可重试'
          } else {
            data.genState = undefined
            data.genError = undefined
          }
        }
        return { ...n, data }
      }),
      edges: p.edges ?? [],
      characters: Array.isArray(p.characters) ? p.characters : defaultCharacters,
      cleared: p.cleared === true,
      epNo: Number.isFinite(Number(p.epNo)) && Number(p.epNo) > 0 ? Number(p.epNo) : 1,
    }
  } catch {
    return null
  }
}

function loadSaved(): Saved | null {
  return readSavedKey(STORAGE_KEY)
}

/**
 * 项目级画布：
 * - 有项目 key 直接用；
 * - 没有时检查旧全局画布，先备份，再只迁移能归属当前项目的节点；
 * - 旧画布只有演示/其他项目节点时不写入项目，画布改由 project.shots 水合。
 */
function loadProjectSaved(name: string, shots: ProjectShot[]): Saved | null {
  const key = projectCanvasKey(name)
  const current = readSavedKey(key)
  if (current) return current

  let legacyRaw = ''
  try {
    legacyRaw = localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return null
  }
  if (!legacyRaw) return null
  const legacy = readSavedKey(STORAGE_KEY)
  if (!legacy) return null

  try {
    if (!localStorage.getItem(LEGACY_BACKUP_KEY)) localStorage.setItem(LEGACY_BACKUP_KEY, legacyRaw)
  } catch {
    /* 备份失败不阻塞读取，但迁移仍然只依赖项目 shotId 判断 */
  }

  const ids = new Set(shots.map((s) => s.id))
  const relevant = legacy.nodes.some((n) => {
    const id = n.data?.shotId
    return Boolean(id && ids.has(String(id)))
  })
  if (relevant || shots.length === 0) {
    try {
      localStorage.setItem(key, legacyRaw)
    } catch {
      /* 配额不足时退回内存状态 */
    }
    return legacy
  }
  return null
}

/** project.shots → 画布节点；保留同 shotId 节点的位置，新增镜头按集栅格排 */
function buildShotNodes(prev: ShotNodeType[], shots: ProjectShot[]): ShotNodeType[] {
  const byShot = new Map<string, ShotNodeType>()
  for (const n of prev) if (n.data?.shotId) byShot.set(String(n.data.shotId), n)
  const counters = new Map<number, { col: number; row: number }>()
  return shots.map((sh, i) => {
    const old = byShot.get(sh.id)
    const ep = Number(sh.episode) || 1
    const c = counters.get(ep) ?? { col: 0, row: 0 }
    const position = old?.position ?? {
      x: c.col * (cardWidth(Number(sh.seconds) || 3) + 56),
      y: (ep - 1) * 380 + c.row * 340,
    }
    c.col += 1
    if (c.col >= 6) {
      c.col = 0
      c.row += 1
    }
    counters.set(ep, c)
    const base: ShotData = old?.data ?? {
      no: sh.no ?? `S${String(i + 1).padStart(2, '0')}`,
      seconds: 3,
      size: '中景',
      move: '固定',
      dialogue: '',
      prompt: '',
      marks: [],
    }
    return {
      id: old?.id ?? uid(),
      type: 'shot' as const,
      position,
      data: shotToData(sh, base),
    }
  })
}

/** 每个集内按镜头号串一条边，画布没有项目级边时用；转场按 source.transitionOut 恢复 */
function chainEdges(shotNodes: ShotNodeType[]): ShotEdgeType[] {
  const byEp = new Map<number, ShotNodeType[]>()
  for (const n of shotNodes) {
    const ep = Number(n.data?.episode) || 1
    const list = byEp.get(ep) ?? []
    list.push(n)
    byEp.set(ep, list)
  }
  const out: ShotEdgeType[] = []
  for (const list of byEp.values()) {
    list.sort((a, b) => String(a.data?.no ?? '').localeCompare(String(b.data?.no ?? ''), undefined, { numeric: true }))
    for (let i = 1; i < list.length; i++) {
      const src = list[i - 1]
      const tgt = list[i]
      const to = tgt.data.shotId || tgt.id
      const isTransition = src.data.transitionOut?.to === to
      out.push({
        id: `seq-${src.id}-${tgt.id}`,
        source: src.id,
        target: tgt.id,
        type: 'shot',
        data: { relation: isTransition ? 'transition' : 'cut' },
      })
    }
  }
  return out
}

/**
 * 按源镜头的 transitionOut.to 找回转场边：
 * 节点重建、画布清空、项目重新加载后，线都还能回到正确的一对镜头上。
 */
function repairTransitionEdges(nodes: ShotNodeType[], edges: ShotEdgeType[]): ShotEdgeType[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const byShot = new Map<string, ShotNodeType>()
  for (const n of nodes) if (n.data.shotId) byShot.set(String(n.data.shotId), n)
  const out = edges.map((e) => ({ ...e }))
  for (const src of nodes) {
    const t = src.data.transitionOut
    if (!t?.to) continue
    const tgt = byShot.get(t.to) ?? byId.get(t.to)
    if (!tgt || tgt.id === src.id) continue
    const hit = out.find((e) => e.source === src.id && e.target === tgt.id)
    if (hit) {
      if ((hit.data?.relation ?? 'cut') !== 'transition') {
        hit.data = { ...hit.data, relation: 'transition' }
      }
      continue
    }
    out.push({
      id: `tr-repair-${src.id}-${tgt.id}`,
      source: src.id,
      target: tgt.id,
      type: 'shot',
      data: { relation: 'transition' },
    })
  }
  return out
}

/** 画布节点里哪些是分镜（素材卡/角色卡不进播放序列） */
const isShotCanvasNode = (n: ShotNodeType) => {
  const type = (n as unknown as { type?: string }).type
  return type === 'shot' || type == null
}

function Shell() {
  const saved = useMemo(loadSaved, [])
  const [nodes, setNodes, onNodesChange] = useNodesState<ShotNodeType>(saved?.nodes ?? initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<ShotEdgeType>(
    repairTransitionEdges(saved?.nodes ?? initialNodes, saved?.edges ?? initialEdges),
  )
  const [characters, setCharacters] = useState<CharacterSheet[]>(saved?.characters ?? defaultCharacters)
  const [view, setView] = useState<
    'board' | 'chars' | 'assets' | 'table' | 'prompts' | 'script' | 'publish' | 'settings' | 'creative'
  >('board')
  /** 从预览导出成功后带进发布台的成片 id；发布台消费后清空 */
  const [publishTarget, setPublishTarget] = useState<string | null>(null)
  /** 顶栏「发布」角标：运行中 + 失败 */
  const [publishBadge, setPublishBadge] = useState({ count: 0, failed: 0 })
  const [projectName, setProjectName] = useState('')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  /** 已经加载完成的项目；只有它等于 projectName 时才允许写回 */
  const [readyProject, setReadyProject] = useState('')
  /** 剧本页是否有未保存分集：切项目/全剧拆角色前检查 */
  const [scriptDirty, setScriptDirty] = useState(false)
  const [promptEditorDirty, setPromptEditorDirty] = useState(false)
  const projectEpochRef = useRef(0)
  /** 当前集：镜头表 / 提示词共用 */
  const [epNo, setEpNo] = useState(1)
  /** 工作台保存后自增，用来刷新集栏的镜数 */
  const [epVersion, setEpVersion] = useState(0)
  const [toast, setToast] = useState('')
  const [tool, setTool] = useState<Tool>('none')
  const [guides, setGuides] = useState(true)
  const [color, setColor] = useState(COLORS[0])
  const [relation, setRelation] = useState<Relation>('cut')
  const [selId, setSelId] = useState<string | null>(null)
  /** 选中的转场连线（与 selId 互斥） */
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null)
  const [ratio, setRatio] = useState('16:9')
  const [refMode, setRefMode] = useState(false)
  const [marksAsGuide, setMarksAsGuide] = useState(true)
  const [candCount, setCandCount] = useState(1)
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null)
  const [vbatch, setVbatch] = useState<{ total: number; done: number } | null>(null)
  const [vidBatch, setVidBatch] = useState<{ total: number; done: number } | null>(null)
  const [vidRes, setVidRes] = useState<'480p' | '720p'>('480p')
  const [preview, setPreview] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [assReady, setAssReady] = useState(false)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voiceProvider, setVoiceProvider] = useState('')
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  /** 项目级场景布局：同集同场镜头共享 */
  const [sceneLayouts, setSceneLayouts] = useState<SceneLayout[]>([])
  /** 项目画幅：3D 预演与出片共用 */
  const [projectAspect, setProjectAspect] = useState('16:9')
  const assetsSnapRef = useRef('')
  /** 服务端报告的缺失媒体引用（角色三视图 / 设定图） */
  const [missingMedia, setMissingMedia] = useState<Set<string>>(new Set())
  const { fitView, setCenter, getZoom } = useReactFlow()
  const { colors: themeColors } = useTheme()
  /** 上次同步到 project.json 的业务字段快照：只有之后的改动才写回 */
  const syncedRef = useRef<Map<string, string>>(new Map())
  /** 角色上一次同步到 project.json 的快照 */
  const charSnapRef = useRef<string>('')

  const nodesRef = useRef(nodes)
  const voicesRef = useRef<VoiceOption[]>([])
  const charactersRef = useRef(characters)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    charactersRef.current = characters
  }, [characters])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  // 项目选择必须在 App 层引导：否则先进入「提示词」标签时 projectName 还是空，
  // 工作台加载不到数据、按钮全灰（实测踩到过）
  const reloadProjects = useCallback(async () => {
    try {
      const { projects: ps } = await listProjects()
      setProjects(ps)
      return ps
    } catch {
      setProjects([])
      return [] as ProjectSummary[]
    }
  }, [])

  useEffect(() => {
    reloadProjects().then((ps) => {
      setProjectName((cur) => cur || ps[0]?.name || '')
    })
  }, [reloadProjects])

  /** 切项目：剧本有未保存分集时先确认；切换期间禁止写回旧数据 */
  const changeProject = useCallback(
    (next: string) => {
      if (next === projectName) return
      if (scriptDirty && !window.confirm('剧本页有未保存的分集，切换项目会丢失。继续？')) return
      if (
        promptEditorDirty &&
        !window.confirm('提示词页的 3D 编辑器有未保存修改，切换项目会丢失。继续？')
      ) {
        return
      }
      setPromptEditorDirty(false)
      setReadyProject('')
      setProjectName(next)
    },
    [projectName, scriptDirty, promptEditorDirty],
  )

  /**
   * 项目删除后的上下文回退。顺序不能改：
   * 先把 readyProject 脱钩，画布防抖才不会再往被删项目写一次；
   * 再清浏览器画布状态，最后才重载列表并决定新的当前项目。
   */
  const applyProjectDeletion = useCallback(
    async (names: string[]) => {
      const gone = new Set(names.filter(Boolean))
      if (!gone.size) return
      setReadyProject('')
      for (const name of gone) {
        try {
          localStorage.removeItem(projectCanvasKey(name))
        } catch {
          /* 存储不可用时忽略 */
        }
      }
      const ps = await reloadProjects()
      if (gone.has(projectName)) {
        setScriptDirty(false)
        setPromptEditorDirty(false)
        setEpNo(1)
        setNodes([])
        setEdges([])
        setCharacters([])
        setAssets([])
        setSceneLayouts([])
        setSelId(null)
        setSelEdgeId(null)
        setMissingMedia(new Set())
        setProjectName(ps[0]?.name || '')
      }
      setEpVersion((v) => v + 1)
      setToast(names.length === 1 ? `已删除项目 ${names[0]}` : `已删除 ${names.length} 个项目`)
      window.setTimeout(() => setToast(''), 3000)
    },
    [projectName, reloadProjects],
  )

  /**
   * 新建项目：全局带入口用。刷新列表后挂到新项目上，
   * 不能只 setProjectName——顶栏下拉的数据源是 projects。
   */
  const applyProjectCreated = useCallback(
    async (name: string) => {
      await reloadProjects()
      setReadyProject('')
      setProjectName(name)
      setToast(`已新建项目 ${name}`)
      window.setTimeout(() => setToast(''), 2800)
    },
    [reloadProjects],
  )

  /** 离开剧本页也保护未保存分集；确认后才允许卸载剧本组件 */
  const changeView = useCallback(
    (next: typeof view) => {
      if (next === view) return
      if (
        view === 'script' &&
        scriptDirty &&
        !window.confirm('剧本页有未保存的分集，离开会丢失。继续？')
      ) {
        return
      }
      if (
        view === 'prompts' &&
        promptEditorDirty &&
        !window.confirm('提示词页的 3D 编辑器有未保存修改，离开会丢失。继续？')
      ) {
        return
      }
      setScriptDirty(false)
      setPromptEditorDirty(false)
      setView(next)
    },
    [view, scriptDirty, promptEditorDirty],
  )

  /** 顶栏发布角标：跟着项目/集轮询运行与失败任务数 */
  useEffect(() => {
    if (!projectName) {
      setPublishBadge({ count: 0, failed: 0 })
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/publish/jobs?project=${encodeURIComponent(projectName)}&episode=${epNo}`,
        )
        const j = await r.json().catch(() => ({}))
        if (!alive || !j?.ok) return
        const s = j.summary || {}
        const failed = Number(s.failed || 0) + Number(s.unknown || 0)
        setPublishBadge({ count: Number(s.running || 0) + failed, failed })
      } catch {
        /* 轮询失败静默 */
      }
    }
    void tick()
    const t = window.setInterval(tick, 15_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [projectName, epNo])

  /** 项目切换事务：加载项目数据 + 项目级画布；旧响应按 epoch 丢弃 */
  useEffect(() => {
    const epoch = ++projectEpochRef.current
    let alive = true
    setReadyProject('')
    setSelId(null)
    setSelEdgeId(null)
    setSceneLayouts([])
    setProjectAspect('16:9')
    if (!projectName) {
      setNodes(initialNodes)
      setEdges(initialEdges)
      setCharacters(defaultCharacters)
      setAssets([])
      setSceneLayouts([])
      setProjectAspect('16:9')
      setMissingMedia(new Set())
      setEpNo(1)
      syncedRef.current = new Map()
      charSnapRef.current = JSON.stringify(defaultCharacters.map(toProject))
      assetsSnapRef.current = '[]'
      return () => {
        alive = false
      }
    }
    ;(async () => {
      try {
        const p = await getProject(projectName)
        if (!alive || epoch !== projectEpochRef.current) return
        const shots = (p.shots ?? []) as ProjectShot[]
        const stored = loadProjectSaved(projectName, shots)
        const storedNodes = stored?.nodes ?? []
        const storedAssets = storedNodes.filter(
          (n) => (n as unknown as { type?: string }).type === 'asset',
        )
        const hydrateShots = stored?.cleared !== true
        const shotNodes = hydrateShots ? buildShotNodes(storedNodes, shots) : []
        const projectAssets = (p.assets ?? []) as ProjectAsset[]
        const assetCards: ShotNodeType[] = storedAssets.length
          ? storedAssets
          : (projectAssets.map((a, i) => ({
              id: `asset-${uid()}`,
              type: 'asset',
              position: { x: 120 + (i % 3) * 240, y: 220 + Math.floor(i / 3) * 160 },
              data: { title: a.title, kind: a.kind, url: a.url, ...(a.designId ? { designId: a.designId } : {}) },
            })) as unknown as ShotNodeType[])
        const sheets = ((p.characters ?? []) as ProjectChar[]).map(toSheet)
        const epSet = new Set<number>()
        for (const e of p.episodes ?? []) epSet.add(Number(e.no) || 1)
        for (const s of shots) epSet.add(Number(s.episode) || 1)
        const maxEp = Math.max(1, ...epSet)
        const wantedEp = Number(stored?.epNo) || 1

        setNodes([...assetCards, ...shotNodes])
        setEdges(
          repairTransitionEdges(
            shotNodes,
            stored?.edges?.length ? stored.edges : chainEdges(shotNodes),
          ),
        )
        setCharacters(sheets)
        setAssets(projectAssets)
        setSceneLayouts((p.sceneLayouts ?? []) as SceneLayout[])
        setProjectAspect(p.aspect || '16:9')
        setEpNo(Math.min(Math.max(1, wantedEp), maxEp))
        syncedRef.current = new Map()
        for (const n of shotNodes) {
          if (n.data.shotId) syncedRef.current.set(String(n.data.shotId), bizSignature(n.data))
        }
        charSnapRef.current = JSON.stringify(sheets.map(toProject))
        assetsSnapRef.current = JSON.stringify(projectAssets)
        setMissingMedia(new Set(Array.isArray(p.media?.missing) ? p.media.missing : []))
        if (p.media?.migrated) {
          setToast(`已把 ${p.media.migrated} 张参考图收进项目目录`)
          window.setTimeout(() => setToast(''), 3600)
        }
        setReadyProject(projectName)
      } catch (e) {
        if (!alive || epoch !== projectEpochRef.current) return
        setNodes([])
        setEdges([])
        setCharacters([])
        setAssets([])
        setSceneLayouts([])
        setProjectAspect('16:9')
        setMissingMedia(new Set())
        setToast(`加载项目失败：${(e as Error).message}`)
        window.setTimeout(() => setToast(''), 3200)
      }
    })()
    return () => {
      alive = false
    }
    // 只在项目切换时加载；setNodes/setEdges 是稳定 setter，放进依赖会重复拉项目覆盖拆角色结果
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  // 恢复上次停留的集：只做一次，避免与后续切换打架
  useEffect(() => {
    const saved = loadSavedEpNo()
    if (saved > 1) setEpNo(saved)
  }, [])

  useEffect(() => {
    checkHealth().then((h) => {
      setHasKey(h ? h.hasKey : null)
      setAssReady(Boolean((h as any)?.ffmpegAss))
    })
  }, [])

  const patch = useCallback(
    (id: string, p: Partial<ShotData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n))),
    [setNodes],
  )

  const patchCharacter = useCallback(
    (id: string, p: Partial<CharacterSheet>): CharacterSheet[] => {
      const next = charactersRef.current.map((c) => {
        if (c.id !== id) return c
        const identityChanged =
          (p.lookEn !== undefined && p.lookEn !== c.lookEn) ||
          (p.palette !== undefined && p.palette !== c.palette) ||
          (p.keywords !== undefined && JSON.stringify(p.keywords) !== JSON.stringify(c.keywords))
        const expressions = identityChanged
          ? markExpressionsStale(c.expressions)
          : p.expressions ?? c.expressions
        const expressionSheet = identityChanged
          ? markExpressionSheetStale(c.expressionSheet)
          : p.expressionSheet ?? c.expressionSheet
        const voiceSample =
          p.voiceId !== undefined && p.voiceId !== c.voiceId
            ? markVoiceSampleStale(c.voiceSample)
            : p.voiceSample ?? c.voiceSample
        return { ...c, ...p, expressions, expressionSheet, voiceSample }
      })
      charactersRef.current = next
      setCharacters(next)
      return next
    },
    [],
  )

  /** 聊天提交整表角色草稿：合并由 adapter 完成，这里只替换状态和 ref。 */
  const replaceCharacters = useCallback((next: CharacterSheet[]) => {
    charactersRef.current = next
    setCharacters(next)
  }, [])

  /** 角色图片类变更立即落库：不等 1.2s 防抖，刷新不会丢 */
  const saveCharactersNow = useCallback(
    async (next: CharacterSheet[]) => {
      if (!projectName || readyProject !== projectName) return
      const payload = next.map(toProject)
      const sig = JSON.stringify(payload)
      try {
        await patchProject(projectName, { characters: payload })
        charSnapRef.current = sig
      } catch (e) {
        setToast(`角色图片保存失败：${(e as Error).message}`)
        window.setTimeout(() => setToast(''), 4200)
      }
    },
    [projectName, readyProject],
  )

  /** <img> 加载失败时补记缺失；服务端清单之外的文件被删也能提示 */
  const markMissing = useCallback((ref: string) => {
    if (!ref) return
    setMissingMedia((s) => {
      if (s.has(ref)) return s
      const next = new Set(s)
      next.add(ref)
      return next
    })
  }, [])

  /**
   * 角色 id 就是名字 → 改名/删除时连线要跟着迁移。
   * 画布只加载了当前集的卡片，所以除了改内存节点，还得改后端 shots 上的 refIds。
   */
  const migrateCharRefs = useCallback(
    async (from: string, to: string | null, dropTokens: string[] = []) => {
      const rid = `char-${from}`
      const drop = new Set(dropTokens)
      try {
        const p = await getProject(projectName)
        const changed = (p.shots ?? [])
          .filter((s) => {
            const refs = s.refIds ?? []
            return refs.includes(rid) || refs.some((x) => drop.has(x))
          })
          .map((s) => ({
            ...s,
            refIds: to
              ? (s.refIds ?? []).map((x) => (x === rid ? `char-${to}` : x)).filter((x) => !drop.has(x))
              : (s.refIds ?? []).filter((x) => x !== rid && !drop.has(x)),
          }))
        if (changed.length) await mergeProjectShots(projectName, changed)
      } catch {
        /* 迁移失败不阻塞界面；下次打开画布仍可从 refIds 看到原值 */
      }
    },
    [projectName],
  )

  /** 新建角色卡：id 就是名字，先给个不重名的占位名 */
  const addCharacter = useCallback(() => {
    setCharacters((cs) => {
      let i = cs.length + 1
      while (cs.some((c) => c.name === `新角色${i}`)) i += 1
      const name = `新角色${i}`
      return [...cs, { id: name, name, role: '待定', lookCn: '', lookEn: '', palette: '', keywords: [] }]
    })
    setToast('已新建角色：先补英文外观锚点，再生成三视图')
    window.setTimeout(() => setToast(''), 3000)
  }, [])

  /** 删角色卡：连带解除所有镜头上指向它的参考连线 */
  const deleteCharacter = useCallback(
    (id: string) => {
      const rid = `char-${id}`
      const orphanIds = nodesRef.current
        .filter((n) => {
          const d = n.data as unknown as { kind?: string; characterName?: string }
          return (n as unknown as AssetNodeType).type === 'asset' && d.kind === 'expression-sheet' && d.characterName === id
        })
        .map((n) => n.id)
      const drop = new Set(orphanIds)
      setCharacters((cs) => cs.filter((c) => c.id !== id))
      setNodes((ns) =>
        ns
          .filter((n) => {
            const d = n.data as unknown as { kind?: string; characterName?: string }
            return !((n as unknown as AssetNodeType).type === 'asset' && d.kind === 'expression-sheet' && d.characterName === id)
          })
          .map((n) => {
            const cur = (n.data as unknown as { refIds?: string[] }).refIds
            if (!cur?.some((x) => x === rid || drop.has(x))) return n
            return {
              ...n,
              data: { ...n.data, refIds: cur.filter((x) => x !== rid && !drop.has(x)) },
            } as typeof n
          }),
      )
      setCharPos((p) => {
        if (!(id in p)) return p
        const next = { ...p }
        delete next[id]
        return next
      })
      setSelRef(null)
      void migrateCharRefs(id, null, orphanIds)
      setToast(`已删除角色「${id}」，相关连线已解除`)
      window.setTimeout(() => setToast(''), 2600)
    },
    [migrateCharRefs],
  )

  /** 改名：id 跟着名字走，所以连线（char-名字）与画布布局都要迁移 */  const renameCharacter = useCallback(
    (oldId: string, raw: string) => {
      const name = raw.trim()
      if (!name || name === oldId) return
      if (charactersRef.current.some((c) => c.id === name)) {
        setToast(`已有同名角色「${name}」`)
        window.setTimeout(() => setToast(''), 2400)
        return
      }
      setCharacters((cs) => cs.map((c) => (c.id === oldId ? { ...c, id: name, name } : c)))
      setNodes((ns) =>
        ns.map((n) => {
          const asset = n.data as unknown as { kind?: string; characterName?: string; title?: string }
          if ((n as unknown as AssetNodeType).type === 'asset' && asset.characterName === oldId) {
            return {
              ...n,
              data: {
                ...n.data,
                characterName: name,
                ...(asset.kind === 'expression-sheet' ? { title: `${name} · 表情总图` } : {}),
              },
            } as typeof n
          }
          const cur = (n.data as unknown as { refIds?: string[] }).refIds
          const from = `char-${oldId}`
          if (!cur?.includes(from)) return n
          return {
            ...n,
            data: { ...n.data, refIds: cur.map((x) => (x === from ? `char-${name}` : x)) },
          } as typeof n
        }),
      )
      setCharPos((p) => {
        if (!(oldId in p)) return p
        const next = { ...p, [name]: p[oldId] }
        delete next[oldId]
        return next
      })
      setToast(`角色已改名为「${name}」，连线已同步`)
      window.setTimeout(() => setToast(''), 2400)
      void migrateCharRefs(oldId, name)
    },
    [migrateCharRefs],
  )

  /** 设置页的渠道/模型表：给 Inspector 的模型下拉用 */
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  /** 手动选的模型（cap → modelKey），空 = 用设置页默认；存本地，刷新不丢 */
  const [modelPick, setModelPick] = useState<Partial<Record<Cap, string>>>(() => {
    try {
      return JSON.parse(localStorage.getItem('storyboard-model-pick') || '{}')
    } catch {
      return {}
    }
  })
  const pickModelKey = useCallback((cap: Cap, key: string) => {
    setModelPick((p) => {
      const next = { ...p }
      if (key) next[cap] = key
      else delete next[cap]
      localStorage.setItem('storyboard-model-pick', JSON.stringify(next))
      return next
    })
  }, [])
  /** 环节手选（script/character/shot/prompt → modelKey），空 = 用设置页环节默认 */
  const [stagePick, setStagePick] = useState<StagePick>(() => {
    try {
      return JSON.parse(localStorage.getItem(STAGE_PICK_KEY) || '{}')
    } catch {
      return {}
    }
  })
  const pickStageModel = useCallback((stage: Stage, key: string) => {
    setStagePick((p) => {
      const next = { ...p }
      if (key) next[stage] = key
      else delete next[stage]
      localStorage.setItem(STAGE_PICK_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  /** 生效单价：设置页 > 默认估算 */
  const price: Pricing = normalizePricing(appSettings?.pricing)
  /** 当前视频模型的能力描述；预览与出片共用，避免两处各查一遍设置 */
  const selectedVideoModel = useMemo<VideoModelInput | null>(() => {
    const key = modelPick.video || appSettings?.defaults?.video || ''
    const entry = appSettings?.models.find((m) => m.key === key)
    if (!entry) return key ? { key } : null
    const provider = appSettings?.providers.find((p) => p.id === entry.provider)
    return {
      key,
      model: entry.model,
      providerKind: provider?.kind,
      audioOut: entry.features?.audioOut,
      supportsVideoRef: entry.supportsVideoRef,
    }
  }, [modelPick.video, appSettings])
  const reloadSettings = useCallback(() => {
    getSettings()
      .then(({ settings }) => setAppSettings(settings as AppSettings))
      .catch(() => setAppSettings(null))
  }, [])
  useEffect(() => {
    reloadSettings()
  }, [reloadSettings])

  // 旧规则包只迁移一次；失败不影响使用，下次打开再试。
  useEffect(() => {
    if (!appSettings || appSettings.skillsMigrated) return
    let alive = true
    ensureSkillsMigrated(appSettings)
      .then((changed) => {
        if (alive && changed) reloadSettings()
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [appSettings, reloadSettings])

  /** 当前生效的配音模型：手动选择 > 设置页默认；切换后重新取对应渠道的音色 */
  const audioModelKey = modelPick.audio || appSettings?.defaults?.audio || ''
  useEffect(() => {
    let alive = true
    listVoices(audioModelKey || undefined).then((v) => {
      if (!alive) return
      setVoices(v.voices)
      setVoiceProvider(v.provider)
    })
    return () => {
      alive = false
    }
  }, [audioModelKey])

  /**
   * 让大模型从「本集剧本 + 本集分镜」或「全剧素材」里拆角色。
   * 已写过外观锚点的同名角色不覆盖（保护手改），只做新增与补空。
   */
  const [extracting, setExtracting] = useState<'' | 'episode' | 'script'>('')
  const extractCharacters = useCallback(
    async (scope: 'episode' | 'script', signal?: AbortSignal): Promise<BuiltinResult> => {
      const label = scope === 'episode' ? '从本集拆角色' : '从全剧拆角色'
      const action = scope === 'episode' ? 'extract_characters_episode' : 'extract_characters_script'
      const fail = (message: string, cancelled = false) =>
        builtinFailure(action, message, {
          label,
          scope,
          saveMode: 'auto',
          ...(cancelled ? { cancelled: true } : {}),
        })
      if (extracting) return fail('正在拆角色，请稍候')
      if (!projectName) return fail('先绑定一个项目')
      if (readyProject !== projectName) return fail('项目还在加载，稍后再试')
      if (scope === 'script' && scriptDirty) return fail('剧本页有未保存的分集，先保存再拆角色')
      if (signal?.aborted) return fail('已取消', true)
      setExtracting(scope)
      const t0 = Date.now()
      try {
        const [p, st] = await Promise.all([getProject(projectName), getSettings()])
        const eps = (p.episodes ?? []) as ProjectEpisode[]
        const curEp = eps.find((e) => Number(e.no) === epNo)
        const sceneText =
          scope === 'episode'
            ? digestEpisodes(curEp ? [curEp] : [])
            : [
                p.source ? `【原著 / 梗概】\n${p.source}` : '',
                digestEpisodes(eps),
              ]
                .filter(Boolean)
                .join('\n\n')
        const projectShotText = digestShots(
          ((p.shots ?? []) as ProjectShot[])
            .filter((s) => (Number(s.episode) || 1) === epNo)
            .map((s) => ({
              no: s.no,
              cast: s.cast,
              dialogue: dialogueToText(s.dialogue),
              prompt: s.keyframe_prompt || s.desc,
            })),
        )
        const canvasShotText = digestShots(
          nodesRef.current
            .filter((n) => n.data.shotId && Number(n.data.episode ?? 1) === epNo)
            .map((n) => ({
              no: n.data.no,
              cast: n.data.cast,
              dialogue: n.data.dialogue,
              prompt: n.data.prompt,
            })),
        )
        const shotText = scope === 'episode' ? projectShotText || canvasShotText : ''
        if (!sceneText.trim() && !shotText.trim()) {
          throw new Error(
            scope === 'episode'
              ? `第 ${epNo} 集还没有镜头。先在「镜头表」拆镜，或把项目镜头推到画布。`
              : '当前项目没有剧本素材（source 与分集场次都为空）。先去「剧本」页生成并保存分集，或切换到有剧本的项目。',
          )
        }
        const scopeLabel =
          scope === 'episode' ? `第 ${epNo} 集的剧本场次与分镜` : '全剧的原文梗概与分集场次'
        const shotBlock = shotText ? `\n\n【本集分镜出场与台词】\n${shotText}` : ''
        const skill = await buildBoardSkillPrompt('character', { scopeLabel, sceneText, shotBlock })
        const modelKey = stageModelKey(st.settings as AppSettings, 'character', stagePick)
        if (!modelKey) throw new Error('设置页还没有可用的文本模型')
        const r = await callText<{ characters?: unknown[] }>({
          system: skill.system,
          modelKey,
          json: true,
          maxTokens: 6000,
          prompt: skill.task,
          signal,
        })
        assertSkillOutput('characters-v1', r.json)
        const list = pickExtracted(r.json)
        if (list.length === 0) throw new Error('模型没给出角色，换个范围再试')
        if (signal?.aborted) return fail('已取消', true)
        const { next, added, filled, skipped } = mergeCharacters(charactersRef.current, list)
        setCharacters(next)
        const secs = Math.round((Date.now() - t0) / 1000)
        return {
          ok: true,
          action,
          label,
          scope,
          summary:
            `拆出 ${list.length} 个角色 · ${secs}s｜新增 ${added.length}` +
            (r.modelLabel ? ` · 模型：${r.modelLabel}` : '') +
            (filled.length ? ` · 补全 ${filled.length}` : '') +
            (skipped.length ? ` · 跳过已有 ${skipped.length}` : '') +
            '，约 1 秒后自动落库',
          counts: {
            total: next.length,
            added: added.length,
            filled: filled.length,
            skipped: skipped.length,
          },
          ...(r.modelLabel ? { modelLabel: r.modelLabel } : {}),
          elapsedMs: Date.now() - t0,
          saveMode: 'auto',
        }
      } catch (e) {
        const err = e as Error
        const cancelled = Boolean(signal?.aborted) || err.name === 'AbortError'
        return fail(cancelled ? '已取消' : err.message || '拆角色失败', cancelled)
      } finally {
        setExtracting('')
      }
    },
    [extracting, projectName, readyProject, scriptDirty, epNo, stagePick],
  )

  // 角色改动回写（防抖 + 快照比对，避免首屏把整份角色重写一遍）
  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const payload = characters.map(toProject)
    const sig = JSON.stringify(payload)
    if (sig === charSnapRef.current) return
    const t = window.setTimeout(() => {
      charSnapRef.current = sig
      patchProject(projectName, { characters: payload }).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [characters, projectName, readyProject])

  // 把角色的外观锚点追加到当前镜头提示词末尾；同一角色重复注入只保留一份
  const injectCharacter = useCallback(
    (charId: string) => {
      const c = characters.find((x) => x.id === charId)
      if (!c) return
      if (!selId) {
        setToast('先在分镜里选一个镜头')
        return
      }
      const node = nodesRef.current.find((n) => n.id === selId)
      if (!node) return
      const base = node.data.prompt.trim()
      let next: string
      if (base.includes(c.lookEn)) {
        next = base
      } else {
        next = base ? `${base}, ${c.lookEn}` : c.lookEn
      }
      patch(selId, { prompt: next })
      setToast(`已把「${c.name}」的外观锚点注入 ${node.data.no}`)
      window.setTimeout(() => setToast(''), 2200)
    },
    [characters, selId, patch],
  )

  /** 设置连线关系；首次落到转场时补默认叠化（已有配置不重置） */
  const setEdgeRelation = useCallback(
    (id: string, next: Relation) => {
      const edge = edges.find((e) => e.id === id)
      setEdges((eds) =>
        eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, relation: next } } : e)),
      )
      if (next !== 'transition' || !edge) return
      const source = nodesRef.current.find((n) => n.id === edge.source)
      const target = nodesRef.current.find((n) => n.id === edge.target)
      if (!source || !target) return
      const to = target.data.shotId || target.id
      const cur = source.data.transitionOut
      const hand = [...new Set([...(source.data.handEdited ?? []), 'transition_out'])]
      if (!cur) {
        patch(source.id, { transitionOut: defaultTransition(to), handEdited: hand })
      } else if (cur.to !== to) {
        patch(source.id, { transitionOut: { ...cur, to }, handEdited: hand })
      }
    },
    [edges, setEdges, patch],
  )

  const cycleEdge = useCallback(
    (id: string) => {
      const order: Relation[] = ['cut', 'transition', 'flashback', 'branch']
      const cur = edges.find((e) => e.id === id)?.data?.relation ?? 'cut'
      setEdgeRelation(id, order[(order.indexOf(cur) + 1) % order.length])
    },
    [edges, setEdgeRelation],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const src = nodesRef.current.find((n) => n.id === c.source) as unknown as AssetNodeType | undefined
      const srcType = (src as unknown as { type?: string } | undefined)?.type
      // 角色/素材 → 分镜：不进 edges 状态，写进目标镜头的 refIds（随镜头落库），边由 refEdges 派生
      if ((srcType === 'char' || srcType === 'asset') && c.target) {
        const tgt = nodesRef.current.find((n) => n.id === c.target)
        if (!tgt) return
        const cur = (tgt.data as unknown as { refIds?: string[] }).refIds ?? []
        if (!cur.includes(c.source!)) {
          patch(c.target, { refIds: [...cur, c.source!] } as never)
          setToast(`已连线为参考（共 ${cur.length + 1} 张）`)
          window.setTimeout(() => setToast(''), 1800)
        }
        return
      }
      setEdges((eds) => addEdge({ ...c, type: 'shot', data: { relation } } as ShotEdgeType, eds))
      if (relation === 'transition' && c.source && c.target) {
        const src = nodesRef.current.find((n) => n.id === c.source)
        const tgt = nodesRef.current.find((n) => n.id === c.target)
        if (src && tgt) {
          const to = tgt.data.shotId || tgt.id
          const hand = [...new Set([...(src.data.handEdited ?? []), 'transition_out'])]
          if (!src.data.transitionOut) patch(src.id, { transitionOut: defaultTransition(to), handEdited: hand })
          else if (src.data.transitionOut.to !== to) {
            patch(src.id, { transitionOut: { ...src.data.transitionOut, to }, handEdited: hand })
          }
        }
      }
    },
    [relation, setEdges, patch],
  )

  /** 删除参考连线 = 从目标镜头的 refIds 里移除；删除转场连线 = 清掉源镜头的 transitionOut */
  const onEdgesDeleted = useCallback(
    (eds: Edge[]) => {
      for (const e of eds) {
        if (e.id.startsWith('ref-')) {
          const tgt = nodesRef.current.find((n) => n.id === e.target)
          if (!tgt) continue
          const cur = (tgt.data as unknown as { refIds?: string[] }).refIds ?? []
          if (cur.includes(e.source)) patch(e.target, { refIds: cur.filter((x) => x !== e.source) } as never)
          continue
        }
        const src = nodesRef.current.find((n) => n.id === e.source)
        const tgt = nodesRef.current.find((n) => n.id === e.target)
        if (!src || !tgt) continue
        const to = tgt.data.shotId || tgt.id
        if (src.data.transitionOut?.to !== to) continue
        patch(src.id, { transitionOut: undefined })
      }
    },
    [patch],
  )
  const addShot = () => {
    const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0)
    const no = `S${String(nodes.length + 1).padStart(2, '0')}`
    const node: ShotNodeType = {
      id: uid(),
      type: 'shot',
      position: { x: nodes.length === 0 ? 0 : maxX + 360, y: nodes.length % 2 === 0 ? 0 : 90 },
      data: { no, seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [] },
    }
    setNodes((ns) => [...ns, node])
    setSelId(node.id)
    window.setTimeout(() => fitView({ padding: 0.2, minZoom: 0.62, duration: 400 }), 60)
  }

  /** 加一张素材卡（场景/道具/图/视频），数据存画布 localStorage */
  const addAsset = () => {
    const node = {
      id: `asset-${uid()}`,
      type: 'asset',
      position: { x: 120, y: 220 },
      data: { title: '新素材', kind: 'image', url: '' },
    } as unknown as ShotNodeType
    setNodes((ns) => [...ns, node])
    setSelId(node.id)
  }

  const removeShot = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    setSelId(null)
  }

  /**
   * 画布只显示当前集：带业务 ID 的节点按 episode 过滤，
   * 没有业务 ID 的（示例卡 / 手搓的实验镜头）始终显示，避免「刚建的卡突然不见了」。
   */
  const shownNodes = useMemo(
    () => nodes.filter((n) => !n.data.shotId || (Number(n.data.episode) || 1) === epNo),
    [nodes, epNo],
  )

  /** 角色上画布：开关 + 拖动位置（数据真相源在 characters，画布只存布局） */
  const [charsOn, setCharsOn] = useState(() => localStorage.getItem('storyboard-chars-on') === '1')
  const [charPos, setCharPos] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('storyboard-char-pos') ?? '{}')
    } catch {
      return {}
    }
  })

  /**
   * 角色节点必须保持对象引用稳定：每次渲染都造新对象会让 React Flow 反复测量、
   * 触发 dimensions 变更 → 再渲染，形成抖动，连线也会渲染不出来（实测踩到）。
   */
  const charCache = useRef(new Map<string, CharNodeType>())
  const charNodes = useMemo<CharNodeType[]>(() => {
    const cache = charCache.current
    const keep = (
      id: string,
      data: CharNodeType['data'],
      position: { x: number; y: number },
    ): CharNodeType => {
      const old = cache.get(id)
      if (
        old &&
        old.data.name === data.name &&
        old.data.role === data.role &&
        old.data.image === data.image &&
        old.data.missing === data.missing &&
        old.position.x === position.x &&
        old.position.y === position.y
      )
        return old
      const next: CharNodeType = { id, type: 'char', position, data, deletable: false }
      cache.set(id, next)
      return next
    }

    const cards = characters.map((c, i) =>
      keep(
        `char-${c.id}`,
        {
          name: c.name,
          role: c.role,
          image: c.image && !missingMedia.has(c.image) ? c.image : undefined,
        },
        charPos[c.id] ?? { x: 80 + i * 170, y: -280 },
      ),
    )
    // 出场名单里有、但角色板没这张卡的名字 → 占位节点，连线不能丢
    const orphans = new Set<string>()
    for (const n of shownNodes) {
      for (const name of n.data.cast ?? []) {
        if (!matchChar(name, characters)) orphans.add(name)
      }
    }
    for (const [i, name] of [...orphans].entries()) {
      cards.push(
        keep(
          missCharId(name),
          { name, role: '无角色卡', missing: true },
          charPos[`miss:${name}`] ?? { x: 80 + (characters.length + i) * 170, y: -280 },
        ),
      )
    }
    return cards
  }, [characters, charPos, shownNodes, missingMedia])

  /** 素材库（DB assets 表）：画布素材卡是它的视图，结构化的场景/道具在这里 */
  /** 素材卡：混在 nodes 状态里持久化（type==='asset'），不受集过滤，始终显示 */
  const assetNodes = useMemo(
    () => nodes.filter((n) => (n as unknown as AssetNodeType).type === 'asset') as unknown as ShotNodeType[],
    [nodes],
  )

  /** 已发布的设定 id：素材页据此显示「已在画布/更新」 */
  const onCanvasDesignIds = useMemo(() => {
    const ids = new Set<string>()
    for (const n of assetNodes) {
      const d = n.data as unknown as { designId?: string }
      if (d.designId) ids.add(d.designId)
    }
    return ids
  }, [assetNodes])

  /** 画布素材卡 → 素材库（DB assets 表）：卡片只是视图，数据落库才能跨会话/跨集复用 */
  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const cards = assetNodes.map((a) => {
      const d = a.data as unknown as { kind?: string; title?: string; url?: string; designId?: string; characterName?: string }
      return {
        kind: d.kind || 'image',
        title: d.title || '',
        url: d.url || '',
        ...(d.designId ? { designId: d.designId } : {}),
        ...(d.characterName ? { characterName: d.characterName } : {}),
      }
    })
    const sig = JSON.stringify(cards)
    if (sig === assetsSnapRef.current) return
    const t = window.setTimeout(() => {
      assetsSnapRef.current = sig
      setAssets(cards)
      patchProject(projectName, { assets: cards } as never).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [assetNodes, projectName])

  /** 首次打开（画布上没有素材卡）时，用素材库把卡片补回来 */
  useEffect(() => {
    if (!projectName || readyProject !== projectName || assets.length === 0 || assetNodes.length > 0) return
    const cards = assets.map((a, i) => ({
      id: `asset-${uid()}`,
      type: 'asset',
      position: { x: 120 + (i % 3) * 240, y: 220 + Math.floor(i / 3) * 160 },
      data: {
        title: a.title,
        kind: a.kind,
        url: a.url,
        ...(a.designId ? { designId: a.designId } : {}),
        ...(a.characterName ? { characterName: a.characterName } : {}),
      },
    })) as unknown as ShotNodeType[]
    setNodes((ns) => [...ns, ...cards])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, assets.length])

  /**
   * 角色节点加入渲染（不进 nodes 状态，避免污染镜头同步/持久化）；素材卡始终在。
   * shownNodes 里也含素材卡（没有 shotId），必须去重 —— 否则 MiniMap 拿到重复 key。
   */
  const canvasNodes = useMemo(() => {
    const seen = new Set<string>()
    const out: ShotNodeType[] = []
    for (const n of [
      ...(charsOn ? charNodes : []),
      ...assetNodes,
      ...shownNodes,
    ] as unknown as ShotNodeType[]) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push(n)
    }
    return out
  }, [charsOn, charNodes, assetNodes, shownNodes])

  /** cast 命中的 角色 → 镜头 虚线边（派生，不持久化） */
  const castEdges = useMemo<Edge[]>(() => {
    if (!charsOn) return []
    const out: Edge[] = []
    for (const n of shownNodes) {
      for (const name of n.data.cast ?? []) {
        const card = matchChar(name, characters)
        const cid = card ? `char-${card.id}` : missCharId(name)
        out.push({
          id: `cast-${cid}-${n.id}`,
          source: cid,
          target: n.id,
          type: 'default',
          animated: !card,
          style: {
            stroke: card ? 'var(--cast-edge)' : 'var(--cast-missing)',
            strokeWidth: 1.4,
            strokeDasharray: '6 4',
            opacity: card ? 1 : 0.65,
          },
        })
      }
    }
    return out
  }, [charsOn, characters, shownNodes])
  /**
   * 参考连线（派生）：角色卡/素材卡 → 分镜，id 前缀 ref-。
   * 连线关系持久在 shot.data.refIds（随镜头写回 project.json）；
   * 源节点不在画布（角色视图关闭 / 素材被删）时不画边，但 refIds 保留。
   */
  /** 选中的参考连线（派生边不在 edges 状态里，React Flow 的选中态会被重算覆盖，自己管一份） */
  const [selRef, setSelRef] = useState<string | null>(null)
  /** 打开转场面板：与镜头/参考选择互斥 */
  const openTransition = useCallback((id: string) => {
    setSelId(null)
    setSelRef(null)
    setSelEdgeId(id)
  }, [])
  const refEdges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    const inCanvas = new Set(canvasNodes.map((n) => n.id))
    for (const n of shownNodes) {
      for (const rid of (n.data as unknown as { refIds?: string[] }).refIds ?? []) {
        if (!inCanvas.has(rid)) continue
        const eid = `ref-${rid}-${n.id}`
        const on = selRef === eid
        out.push({
          id: eid,
          source: rid,
          target: n.id,
          type: 'default',
          style: {
            stroke: 'var(--ref-edge)',
            strokeWidth: on ? 3 : 1.6,
            filter: on ? 'drop-shadow(0 0 6px var(--ref-edge))' : undefined,
          },
          label: '参考',
          labelStyle: { fill: 'var(--ref-edge)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--ref-label-bg)' },
        } as unknown as Edge)
      }
    }
    return out
  }, [canvasNodes, shownNodes, selRef])

  /** Delete/Backspace 删掉选中的参考连线（边是派生的，不走 React Flow 的选中删除） */
  useEffect(() => {
    if (!selRef) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      for (const n of nodesRef.current) {
        const cur = (n.data as unknown as { refIds?: string[] }).refIds ?? []
        for (const rid of cur) {
          if (`ref-${rid}-${n.id}` !== selRef) continue
          ev.preventDefault()
          patch(n.id, { refIds: cur.filter((x) => x !== rid) } as never)
          setSelRef(null)
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selRef, patch])

  /** 缩得很小时切到精简渲染（CSS 隐藏卡片里的次要信息） */
  const [zoomLite, setZoomLite] = useState(false)
  const zoomLiteRef = useRef(false)

  /** 右键菜单：不填 URL，直接从画布里的卡片点选参考 */
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)

  /** 可当参考源的卡片：角色卡 + 非视频素材卡（有图才算） */
  const refCards = useMemo<
    { id: string; title: string; tag: string; img: string }[]
  >(() => {
    const out: { id: string; title: string; tag: string; img: string }[] = []
    for (const c of characters) {
      if (!c.image) continue
      out.push({ id: `char-${c.id}`, title: c.name || '未命名角色', tag: '角色', img: c.image })
    }
    for (const a of assetNodes) {
      const d = a.data as unknown as { title?: string; kind?: string; url?: string }
      if (!d.url) continue
      // 只有图片类素材能当画面参考；视频与音频各有自己的链路
      if (assetMediaType((d.kind || 'image') as never, d.url) !== 'image') continue
      const tag = { scene: '场景', prop: '道具', image: '图片', 'expression-sheet': '表情' }[d.kind ?? 'image'] ?? '图片'
      out.push({ id: a.id, title: d.title || '未命名素材', tag, img: d.url })
    }
    return out
  }, [characters, assetNodes])

  /** 右键菜单数据：分镜卡 → 选参考源；角色/素材卡 → 选要连的镜头 */
  const ctxData = useMemo(() => {
    if (!ctx) return null
    const node = canvasNodes.find((n) => n.id === ctx.id)
    if (!node) return null
    const type = (node as unknown as { type?: string }).type
    const d = node.data as unknown as {
      no?: string
      name?: string
      prompt?: string
      title?: string
      kind?: string
      refIds?: string[]
    }
    if (type === 'shot') {
      const mine = d.refIds ?? []
      return {
        mode: 'shot' as const,
        targetId: node.id,
        nodeType: 'shot' as const,
        headTitle: d.no ? `${d.no} 的参考` : '镜头参考',
        headSub: '点选画布中的卡片作为参考图',
        sectionTitle: '参考画布里的卡片',
        emptyText: '画布上还没有可用作参考的图：先加素材卡，或给角色生成图',
        hint: '上一镜/下一镜只取当前画面；多选可叠加，再点一次取消。「首帧」= 直接用这张图出片。',
        items: [
          ...neighborReferenceItems(node as ShotNodeType, shownNodes as ShotNodeType[]).map((c) => ({
            ...c,
            on: mine.includes(c.id),
          })),
          ...refCards.map((c) => ({ ...c, on: mine.includes(c.id) })),
        ],
      }
    }
    const isChar = type === 'char'
    return {
      mode: 'source' as const,
      targetId: node.id,
      nodeType: (isChar ? 'char' : 'asset') as 'char' | 'asset',
      headTitle: isChar ? `角色「${d.name ?? ''}」` : `素材「${d.title || '未命名'}」`,
      headSub: '点选镜头即建立参考连线',
      sectionTitle: '连到画布里的镜头',
      emptyText: '画布上还没有分镜卡',
      hint: '连线后，生成画面 / 出片都会带上这张图。',
      items: shownNodes.map((n) => ({
        id: n.id,
        title: `${n.data.no}${n.data.size ? ' · ' + n.data.size : ''}`,
        tag: (n.data.prompt ?? '').slice(0, 14),
        img: n.data.refImage,
        on: (n.data.refIds ?? []).includes(node.id),
      })),
    }
  }, [ctx, canvasNodes, refCards, shownNodes])

  /** 建立/取消参考关系：refIds 挂在镜头（target）上 */
  const toggleRef = useCallback(
    (shotNodeId: string, sourceId: string) => {
      const t = nodesRef.current.find((n) => n.id === shotNodeId)
      if (!t) return
      const cur = (t.data as unknown as { refIds?: string[] }).refIds ?? []
      const next = cur.includes(sourceId) ? cur.filter((x) => x !== sourceId) : [...cur, sourceId]
      patch(shotNodeId, { refIds: next } as never)
    },
    [patch],
  )

  /** 直接用这张图当首帧（出片参考），省掉手填 URL */
  const useAsFirstFrame = useCallback(
    (shotNodeId: string, sourceId: string) => {
      const node = nodesRef.current.find((n) => n.id === shotNodeId)
      const neighbor = node ? resolveNeighborToken(node, shownNodes as ShotNodeType[], sourceId) : null
      const card = neighbor
        ? { title: neighbor.label, img: neighbor.url }
        : refCards.find((c) => c.id === sourceId)
      if (!card?.img) return
      patch(shotNodeId, { refImage: card.img, videoUrl: undefined, vidState: 'idle' } as never)
      setToast(`已用「${card.title}」做首帧`)
      window.setTimeout(() => setToast(''), 2000)
    },
    [patch, refCards, shownNodes],
  )

  /** 其他集各有多少张卡：当前集为空时用来提示「不是丢了，是切集了」 */
  /** 当前选中的卡片（⌘/Shift 点选 或 Shift 框选） */
  const selectedNodes = useMemo(() => shownNodes.filter((n) => n.selected), [shownNodes])
  const [selBusy, setSelBusy] = useState('')
  const [selKind, setSelKind] = useState<'image' | 'video' | 'voice' | null>(null)
  /** 运行中的出图请求：同一镜只允许一个在途请求 */
  const activeImgRef = useRef<Map<string, { token: number; controller: AbortController; taskId: string }>>(new Map())
  const imgTokenRef = useRef(0)
  const batchAbortRef = useRef<AbortController | null>(null)

  /** 对选中的卡片批量执行 */
  const runOnSelected = async (kind: 'image' | 'video' | 'voice') => {
    if (selBusy) return
    const list = nodesRef.current.filter((n) => n.selected)
    if (list.length === 0) return
    const label = { image: '出图', video: '出片', voice: '配音' }[kind]
    const ac = kind === 'image' ? new AbortController() : null
    batchAbortRef.current = ac
    setSelKind(kind)
    setSelBusy(`${label} 0/${list.length}`)
    let i = 0
    let cancelled = false
    try {
      for (const n of list) {
        if (ac?.signal.aborted) {
          cancelled = true
          break
        }
        if (kind === 'image') await generateOne(n.id, { signal: ac?.signal })
        else if (kind === 'video') await generateVideoOne(n.id)
        else await generateVoiceOne(n.id)
        if (ac?.signal.aborted) {
          cancelled = true
          break
        }
        i += 1
        setSelBusy(`${label} ${i}/${list.length}`)
      }
    } finally {
      batchAbortRef.current = null
      setSelKind(null)
      setSelBusy('')
    }
    setToast(cancelled ? '已取消批量出图' : `已对 ${list.length} 张执行${label}`)
    window.setTimeout(() => setToast(''), 2400)
  }

  const cancelBatch = () => {
    if (!batchAbortRef.current) return
    batchAbortRef.current.abort()
    setToast('正在取消批量出图…')
  }

  const deleteSelected = () => {
    const ids = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
    if (ids.size === 0) return
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)))
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
    setSelId(null)
    setToast(`已删除 ${ids.size} 张`)
    window.setTimeout(() => setToast(''), 2000)
  }

  /** 连续性诊断 */
  const [diagOn, setDiagOn] = useState(false)
  const issues = useMemo(() => (diagOn ? diagnose(shownNodes) : []), [diagOn, shownNodes])

  const otherEpCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of nodes) {
      if (!n.data.shotId) continue
      const e = Number(n.data.episode) || 1
      m.set(e, (m.get(e) ?? 0) + 1)
    }
    return [...m.entries()].filter(([e]) => e !== epNo).sort((a, b) => a[0] - b[0])
  }, [nodes, epNo])

  /** 当前集真正的分镜（素材卡/角色卡不进播放序列） */
  const episodeShots = useMemo(
    () => shownNodes.filter(isShotCanvasNode),
    [shownNodes],
  )
  /** 唯一剪辑序列：时间线、预览、导出都从这里取时间 */
  const edit = useMemo(() => buildEditList(episodeShots, edges), [episodeShots, edges])
  const inactiveEdgeIds = useMemo(
    () => new Set(edit.inactive.map((x) => x.edgeId)),
    [edit],
  )

  const shownEdges = useMemo<Edge[]>(() => {
    const ids = new Set(canvasNodes.map((n) => n.id))
    const shotsById = new Map(episodeShots.map((n) => [n.id, n]))
    const decorated = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        if ((e.data?.relation ?? 'cut') !== 'transition') return e as Edge
        const src = shotsById.get(e.source)
        const tgt = shotsById.get(e.target)
        if (!src || !tgt) return e as Edge
        const t = transitionFor(src, tgt)
        const fp = transitionFingerprint(src.data, tgt.data, t.generated)
        const pending = t.mode === 'generated' && !t.generated?.video?.url
        const stale = Boolean(
          t.mode === 'generated' &&
            t.generated?.video?.url &&
            t.meta?.fingerprint &&
            t.meta.fingerprint !== fp,
        )
        const state = inactiveEdgeIds.has(e.id)
          ? 'inactive'
          : stale
            ? 'stale'
            : pending
              ? 'pending'
              : 'ready'
        return {
          ...e,
          data: { ...e.data, transition: { summary: transitionSummary(t), state } },
        } as Edge
      })
    return [...decorated, ...castEdges, ...refEdges]
  }, [edges, canvasNodes, castEdges, refEdges, episodeShots, inactiveEdgeIds])

  /** 点角色节点 → 聚焦到它的出场镜头（名单带修饰也能命中） */
  const focusChar = (name: string) => {
    const targets = shownNodes
      .filter((n) => (n.data.cast ?? []).some((c) => c === name || matchChar(c, characters)?.name === name))
      .map((n) => ({ id: n.id }))
    if (targets.length === 0) {
      setToast(`「${name}」当前集没有出场镜头`)
      window.setTimeout(() => setToast(''), 2200)
      return
    }
    fitView({ nodes: targets, padding: 0.35, duration: 500 })
  }

  /** 画布上已有的业务 ID，给工作台标「在画布」 */
  const onCanvasIds = useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) if (n.data.shotId) s.add(n.data.shotId)
    return s
  }, [nodes])

  /** 工作台 → 画布：按 shot.id 幂等推送，本次没推到的旧节点只标灰不删 */
  const pushShotsToCanvas = useCallback(
    (shots: ProjectShot[]) => {
      // 新节点 id 必须提前生成，才能同时把连线接上
      const existing = new Map<string, ShotNodeType>()
      for (const n of nodesRef.current) if (n.data.shotId) existing.set(n.data.shotId, n)
      const ids = shots.map((sh) => existing.get(sh.id)?.id ?? uid())

      // 分镜栅格：每行 6 格，左→右、再换行，保证一眼能顺着读
      const PER_ROW = 6
      const GAP_X = 56
      const GAP_Y = 340
      const grid: { x: number; y: number }[] = []
      let cx = 0
      let row = 0
      let col = 0
      for (const sh of shots) {
        grid.push({ x: cx, y: row * GAP_Y })
        cx += cardWidth(Number(sh.seconds) || 3) + GAP_X
        col += 1
        if (col >= PER_ROW) {
          col = 0
          row += 1
          cx = 0
        }
      }

      setNodes((prev) => {
        const byShot = new Map<string, ShotNodeType>()
        for (const n of prev) if (n.data.shotId) byShot.set(n.data.shotId, n)
        const incoming = new Set(shots.map((s) => s.id))

        const next: ShotNodeType[] = shots.map((sh, i) => {
          const old = byShot.get(sh.id)
          const base: ShotData = old?.data ?? {
            no: sh.no ?? `S${String(i + 1).padStart(2, '0')}`,
            seconds: 3,
            size: '中景',
            move: '固定',
            dialogue: '',
            prompt: '',
            marks: [],
          }
          return {
            id: ids[i],
            type: 'shot' as const,
            // 已有节点保留手工拖过的位置，新节点落在栅格里
            position: old?.position ?? grid[i],
            data: shotToData(sh, base),
          }
        })

        for (const n of prev) {
          if (n.data.shotId && !incoming.has(n.data.shotId)) {
            next.push({ ...n, data: { ...n.data, orphan: true } })
          } else if (!n.data.shotId) {
            // 示例卡（id 形如 S01）在有真实镜头后退场，避免与推送的卡片重叠
            if (/^S\d+$/.test(n.id)) continue
            next.push(n)
          }
        }
        return next
      })

      // 顺序连线：把这一集的镜头按顺序串起来，重推时整条重建（幂等）
      setEdges((prev) => {
        const pushed = new Set(ids)
        const kept = prev.filter((e) => !pushed.has(e.source) && !pushed.has(e.target))
        const chain: ShotEdgeType[] = []
        for (let i = 1; i < ids.length; i++) {
          const prevShot = shots[i - 1]
          const to = shots[i].id
          const rel: Relation =
            prevShot?.transition_out?.to === to ? 'transition' : 'cut'
          chain.push({
            id: `seq-${ids[i - 1]}-${ids[i]}`,
            source: ids[i - 1],
            target: ids[i],
            type: 'shot',
            data: { relation: rel },
          })
        }
        return [...kept, ...chain]
      })
      // 记下快照：之后的改动才算「画布侧编辑」
      const snap = new Map<string, string>()
      for (const s of shots) {
        snap.set(
          s.id,
          bizSignature({
            no: s.no ?? '',
            seconds: Number(s.seconds) || 0,
            size: s.size ?? '',
            move: s.move ?? '',
            dialogue: typeof s.dialogue === 'string' ? s.dialogue : dialogueToText(s.dialogue),
            prompt: s.keyframe_prompt ?? '',
            refImage: s.keyframe,
            videoUrl: s.clip,
            marks: [],
          }),
        )
      }
      // 只更新本次推送的镜头，别把其他集的快照冲掉 ——
      // 整份替换会让别集节点全部变成「脏」，下次写回时被无谓地重写一遍
      for (const [k, v] of snap) syncedRef.current.set(k, v)
      setToast(`已推送 ${shots.length} 镜到画布`)
      window.setTimeout(() => setToast(''), 2200)
      window.setTimeout(() => fitView({ padding: 0.2, minZoom: 0.55, duration: 400 }), 80)
    },
    [setNodes, fitView],
  )

  /**
   * 素材设定 → 画布：按 designId 幂等 upsert。
   * 已存在的卡只更新标题/类型/图片，保留位置和连线；新卡放在分镜上方的素材带。
   */
  const pushDesigns = useCallback(
    (list: DesignSheet[]) => {
      const withImage = list.filter((d) => Boolean(d.image) && !missingMedia.has(String(d.image)))
      const skipped = list.length - withImage.length
      if (withImage.length === 0) {
        setToast(skipped ? `跳过 ${skipped} 张无图素材；先生成设定图` : '先生成设定图，再加入画布')
        window.setTimeout(() => setToast(''), 2400)
        return
      }
      const byId = new Map(withImage.map((d) => [d.id, d]))
      const existing = new Set<string>()
      for (const n of nodesRef.current) {
        if ((n as unknown as AssetNodeType).type !== 'asset') continue
        const d = n.data as unknown as { designId?: string }
        if (d.designId) existing.add(d.designId)
      }
      const fresh = withImage.filter((d) => !existing.has(d.id))
      const updated = withImage.length - fresh.length
      const base = nodesRef.current.filter(
        (n) => (n as unknown as AssetNodeType).type === 'asset',
      ).length

      setNodes((prev) => {
        const out = prev.map((n) => {
          if ((n as unknown as AssetNodeType).type !== 'asset') return n
          const data = n.data as unknown as { designId?: string }
          const design = data.designId ? byId.get(data.designId) : undefined
          if (!design) return n
          return {
            ...n,
            data: {
              ...n.data,
              title: design.name,
              kind: design.kind,
              url: design.image,
              designId: design.id,
            },
          }
        })
        let i = 0
        for (const design of fresh) {
          const slot = base + i++
          out.push({
            id: `asset-${uid()}`,
            type: 'asset',
            position: {
              x: 80 + (slot % 4) * 250,
              y: -560 - Math.floor(slot / 4) * 180,
            },
            data: {
              title: design.name,
              kind: design.kind,
              url: design.image,
              designId: design.id,
            },
          } as unknown as ShotNodeType)
        }
        return out
      })

      setToast(
        `已加入 ${fresh.length} 个素材${updated ? ` · 更新 ${updated}` : ''}${skipped ? ` · 跳过 ${skipped} 张无图` : ''}`,
      )
      window.setTimeout(() => setToast(''), 2600)
      window.setTimeout(() => fitView({ padding: 0.2, minZoom: 0.5, duration: 400 }), 80)
    },
    [setNodes, fitView, missingMedia],
  )

  /** 在线素材导入 → 直接生成一张素材卡（不建连线，不覆盖已手改内容） */
  const addAssetCardFromStock = useCallback(
    (input: { title: string; kind: string; url: string }) => {
      const base = nodesRef.current.filter((n) => (n as unknown as AssetNodeType).type === 'asset').length
      setNodes((prev) => [
        ...prev,
        {
          id: `asset-${uid()}`,
          type: 'asset',
          position: {
            x: 80 + (base % 4) * 250,
            y: -560 - Math.floor(base / 4) * 180,
          },
          data: { title: input.title, kind: input.kind, url: input.url },
        } as unknown as ShotNodeType,
      ])
      setToast(`已导入素材：${input.title}`)
      window.setTimeout(() => setToast(''), 2400)
    },
    [setNodes],
  )

  /** 角色表情总图 → 画布：每个角色只有一张卡，重复发布只更新图片/标题。 */
  const publishExpressionSheet = useCallback(
    (charId: string) => {
      const character = charactersRef.current.find((c) => c.id === charId || c.name === charId)
      const sheet = character?.expressionSheet
      if (!character || !sheet) {
        setToast('先生成表情总图，再发布到画布')
        window.setTimeout(() => setToast(''), 2600)
        return
      }
      if (!isSheetUsable(sheet, identityFingerprint(character))) {
        setToast('表情总图已失效，请先重生成')
        window.setTimeout(() => setToast(''), 2600)
        return
      }
      if (sheet.image && missingMedia.has(sheet.image)) {
        setToast('表情总图文件缺失，请重新生成或上传')
        window.setTimeout(() => setToast(''), 3000)
        return
      }
      const title = `${character.name} · 表情总图`
      const existing = nodesRef.current.find((n) => {
        const d = n.data as unknown as { kind?: string; characterName?: string }
        return (
          (n as unknown as AssetNodeType).type === 'asset' &&
          d.kind === 'expression-sheet' &&
          d.characterName === character.name
        )
      })
      if (existing) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === existing.id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    title,
                    kind: 'expression-sheet',
                    url: sheet.image,
                    characterName: character.name,
                  },
                } as typeof n
              : n,
          ),
        )
        setToast('已更新画布上的表情总图')
      } else {
        const base = nodesRef.current.filter(
          (n) => (n as unknown as AssetNodeType).type === 'asset',
        ).length
        setNodes((prev) => [
          ...prev,
          {
            id: `asset-${uid()}`,
            type: 'asset',
            position: {
              x: 80 + (base % 4) * 250,
              y: -560 - Math.floor(base / 4) * 180,
            },
            data: {
              title,
              kind: 'expression-sheet',
              url: sheet.image,
              characterName: character.name,
            },
          } as unknown as ShotNodeType,
        ])
        setToast('已发布表情总图到画布')
      }
      window.setTimeout(() => setToast(''), 2800)
      window.setTimeout(() => fitView({ padding: 0.2, minZoom: 0.5, duration: 400 }), 80)
    },
    [fitView, missingMedia, setNodes],
  )

  /** 打开角色上画布；本集一条名单都没有时明确告知，而不是静默无反应 */
  const toggleChars = useCallback(() => {
    const next = !charsOn
    setCharsOn(next)
    localStorage.setItem('storyboard-chars-on', next ? '1' : '0')
    if (!next) return
    const withCast = nodesRef.current.filter((n) => (n.data.cast ?? []).length > 0).length
    if (withCast === 0) {
      setToast('本集画布还没有出场名单，正在从项目文件补…')
      window.setTimeout(() => setToast(''), 2800)
    }
  }, [charsOn])

  /**
   * 画布节点的 cast 只在「推送」时带上，老节点会是空的。
   * 打开角色视图时补一次：从 project.json 按 shotId 取 cast 填回去。
   * cast 不在 bizSignature 里 → 不会触发无谓写回。
   */
  useEffect(() => {
    if (!charsOn || !projectName || readyProject !== projectName) return
    const missing = nodesRef.current.filter((n) => n.data.shotId && !(n.data.cast ?? []).length)
    if (missing.length === 0) return
    let alive = true
    getProject(projectName)
      .then((p) => {
        if (!alive) return
        const byId = new Map((p.shots ?? []).map((s) => [s.id, s]))
        const fill = new Map<string, string[]>()
        for (const n of missing) {
          const c = byId.get(n.data.shotId as string)?.cast
          if (c?.length) fill.set(n.id, c)
        }
        if (fill.size === 0) return
        setNodes((ns) =>
          ns.map((n) => (fill.has(n.id) ? { ...n, data: { ...n.data, cast: fill.get(n.id) } } : n)),
        )
        setToast(`已补全 ${fill.size} 镜的出场名单`)
        window.setTimeout(() => setToast(''), 2400)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [charsOn, projectName, readyProject, setNodes])

  /** 画布侧改动 → 写回 project.json。
   * 只在有实质性业务字段变化时才写，且靠快照对比避免首屏把所有镜头重写一遍。
   */
  useEffect(() => {
    if (!projectName || readyProject !== projectName || view !== 'board') return
    if (syncedRef.current.size === 0) return
    const timer = window.setTimeout(() => {
      const changed: ProjectShot[] = []
      for (const n of nodes) {
        const id = n.data.shotId
        if (!id) continue
        const sig = bizSignature(n.data)
        if (syncedRef.current.get(id) === sig) continue
        syncedRef.current.set(id, sig)
        changed.push(nodeToShot(n.data, id))
      }
      if (changed.length === 0) return
      mergeProjectShots(projectName, changed).catch(() => {
        /* 写回失败不打断画布操作，工作台「重新加载」可看到差异 */
      })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [nodes, projectName, readyProject, view])

  const charImages = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of characters) if (c.name && c.image) m[c.name] = c.image
    return m
  }, [characters])


  const cancelGenerate = useCallback(
    (id: string) => {
      const rec = activeImgRef.current.get(id)
      if (!rec) return
      activeImgRef.current.delete(id)
      rec.controller.abort()
      cancelTask(rec.taskId)
      patch(id, { genState: 'idle', genError: undefined })
      setToast('已取消出图')
      window.setTimeout(() => setToast(''), 2200)
    },
    [patch],
  )

  const generateOne = useCallback(
    async (id: string, opts: { signal?: AbortSignal } = {}) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      if (activeImgRef.current.has(id)) return
      // prompt 可能缺失（旧项目镜头没有 keyframe_prompt 且 desc 为空时 shotToData 会给出 undefined）
      const prompt = String(node.data.prompt ?? '').trim()
      if (!prompt) {
        patch(id, { genState: 'error', genError: '请先填写画面提示词' })
        return
      }
      if (opts.signal?.aborted) return
      const controller = new AbortController()
      const onExternalAbort = () => controller.abort()
      opts.signal?.addEventListener('abort', onExternalAbort, { once: true })
      const token = ++imgTokenRef.current
      patch(id, { genState: 'running', genError: undefined })
      // 单镜也要记账：之前只有批量才记，导致右上角金额偏低
      const tid = startTask('image', `${node.data.no} 出图`, {
        cost: imageCost(price, candCount),
        retry: () => void generateOne(id),
        cancel: () => cancelGenerate(id),
      })
      activeImgRef.current.set(id, { token, controller, taskId: tid })
      const current = () => activeImgRef.current.get(id)?.token === token
      try {
        let ref: string | undefined
        let composed = false
        if (refMode && node.data.refImage) {
          if (marksAsGuide && node.data.marks.length > 0) {
            ref = await composeReference(node.data.refImage, node.data.marks)
            composed = true
          } else {
            ref = node.data.refImage
          }
        }
        // 角色/相邻分镜/素材统一由共享解析器排序；当前画面由 ref 单独占图1。
        const collected = collectShotReferences({
          node,
          nodes: nodesRef.current,
          characters,
          missingMedia,
        })
        if (collected.missing.length) {
          const first = collected.missing[0]
          throw new Error(`${first.label}：${first.reason}`)
        }
        const extraCandidates = collected.refs.filter((r) => r.url !== ref)
        const extraBudget = Math.max(0, 10 - (ref ? 1 : 0))
        const limited = limitReferences(extraCandidates, extraBudget)
        const extraRefs = limited.used.map((r) => r.url)
        const refLabels = limited.used.map((r, i) => `图${(ref ? 2 : 1) + i}=${r.label}`)
        if (limited.omitted.length) {
          setToast(`参考图超过 10 张，已省略：${limited.omitted.map((r) => r.label).join('、')}`)
          window.setTimeout(() => setToast(''), 3600)
        }
        const refIntro = ref ? '图1=构图与上一镜连贯性；' : ''
        const res = await generateImage({
          prompt: (composed ? prompt + COMPOSE_HINT : prompt) +
            (extraRefs.length
              ? `\n\n参考图说明：${refIntro}${refLabels.join('，')}。对应主体必须与参考图保持一致。`
              : ''),
          ratio,
          refImage: ref,
          refImages: extraRefs,
          n: candCount,
          modelKey: modelPick.image,
        }, { signal: controller.signal })
        if (!current()) return
        const urls = res.urls?.length ? res.urls : [res.url]
        patch(id, {
          candidates: urls,
          activeIdx: 0,
          refImage: urls[0],
          genState: 'idle',
          genError: undefined,
          videoUrl: undefined,
          vidState: 'idle',
        })
        endTask(tid)
        if (res.warning) {
          setToast(res.warning)
          window.setTimeout(() => setToast(''), 3600)
        }
      } catch (e) {
        if (!current()) return
        const err = e as Error
        if (err.name === 'AbortError') {
          patch(id, { genState: 'idle', genError: undefined })
          cancelTask(tid)
          setToast('已取消出图')
          window.setTimeout(() => setToast(''), 2200)
        } else {
          patch(id, { genState: 'error', genError: err.message })
          endTask(tid, err.message)
        }
      } finally {
        opts.signal?.removeEventListener('abort', onExternalAbort)
        if (current()) activeImgRef.current.delete(id)
      }
    },
    [patch, ratio, refMode, marksAsGuide, candCount, charImages, characters, modelPick, price, missingMedia, cancelGenerate],
  )

  /**
   * 图生视频：预览与实际请求共用 buildShotVideoRequest。
   * 有手改快照时逐字发送手改正文；附件仍由当前连线与开关决定。
   */
  const generateVideoOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const schedule = resolveShotSchedule({
        data: node.data,
        shotId: node.id,
        sceneLayouts,
        projectAspect,
      })
      const request = buildShotVideoRequest({
        data: node.data,
        nodeId: node.id,
        nodes: nodesRef.current,
        characters: charactersRef.current,
        missingMedia,
        schedule,
        model: selectedVideoModel,
        resolution: vidRes,
      })
      const blocked = request.blocking[0]
      if (blocked) {
        patch(id, { vidState: 'error', vidError: blocked.message })
        if (blocked.code !== 'no-image' && blocked.code !== 'native-no-image') {
          setToast(blocked.message)
          window.setTimeout(() => setToast(''), 3600)
        }
        return
      }
      const omittedNotes = [
        request.omitted.length
          ? `参考图最多 4 张，已省略：${request.omitted.map((r) => r.label).join('、')}`
          : '',
        request.omittedVideos.length
          ? `首期只使用第一条视频素材，已忽略：${request.omittedVideos.map((r) => r.label).join('、')}`
          : '',
      ].filter(Boolean)
      if (omittedNotes.length) {
        setToast(omittedNotes.join('；'))
        window.setTimeout(() => setToast(''), 4200)
      }
      patch(id, { vidState: 'running', vidError: undefined, vidAt: Date.now(), videoUrl: undefined })
      const effective = effectiveVideoPrompt(request, node.data.videoPromptOverride)
      const imageUrls = request.refs.map((r) => r.url)
      const audioRef = request.audio
        ? {
            character: request.audio.character || '',
            url: request.audio.url,
            label: request.audio.label,
          }
        : null
      const modelKey = selectedVideoModel?.key || ''
      const tid = startTask('video', `${node.data.no} 出片`, {
        cost: videoCost(price, request.seconds, vidRes),
        retry: () => void generateVideoOne(id),
      })
      try {
        const res = await startVideo({
          ...(request.mode === 'native'
            ? { refImages: imageUrls, generateAudio: true, audioRef: request.audio?.url }
            : request.video
              ? {
                  refVideos: [request.video.url],
                  ...(imageUrls.length > 0 ? { refImages: imageUrls } : {}),
                }
              : imageUrls.length > 0
                ? { refImages: imageUrls }
                : { image: request.firstFrame?.url || '' }),
          prompt: effective.text,
          seconds: request.seconds,
          ratio,
          resolution: vidRes,
          ...(request.video || request.mode === 'native'
            ? {}
            : { cameraFixed: node.data.move === '固定' }),
          modelKey,
        })
        if (res.skipped?.length) {
          setToast(`跳过 ${res.skipped.length} 张失效参考图，继续出片`)
          window.setTimeout(() => setToast(''), 3000)
        }
        const taskId = res.id
        const done = await waitVideo(taskId, (elapsed) =>
          patch(id, { vidAt: Date.now() - elapsed * 1000 }),
        )
        const createdAt = new Date().toISOString()
        patch(id, {
          videoUrl: done.url,
          vidState: 'idle',
          vidAt: undefined,
          videoMeta: {
            url: done.url,
            prompt: effective.text,
            fingerprint: request.fingerprint,
            modelKey,
            createdAt,
          },
          ...(request.mode === 'native' && audioRef
            ? {
                audioMode: 'native' as const,
                audioRef,
                audioMeta: {
                  fingerprint: nativeAudioFingerprint({
                    modelKey,
                    audioRef,
                    dialogue: parseDialogue(node.data.dialogue),
                  }),
                  modelKey,
                  createdAt,
                },
              }
            : {}),
        })
        endTask(tid)
      } catch (e) {
        patch(id, { vidState: 'error', vidError: (e as Error).message, vidAt: undefined })
        endTask(tid, (e as Error).message)
      }
    },
    [patch, ratio, vidRes, selectedVideoModel, sceneLayouts, projectAspect, missingMedia],
  )

  /** 转场配置写回：始终基于最新节点数据合并，避免异步生成覆盖用户同时改的其他字段 */
  const writeTransition = useCallback(
    (sourceId: string, to: string, updater: (cur: TransitionOut) => TransitionOut) => {
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== sourceId) return n
          const cur = normalizeTransitionOut(n.data.transitionOut, to)
          return {
            ...n,
            data: {
              ...n.data,
              transitionOut: updater(cur),
              handEdited: [...new Set([...(n.data.handEdited ?? []), 'transition_out'])],
            },
          }
        }),
      )
    },
    [setNodes],
  )

  const transitionPair = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId)
      if (!edge) return null
      const source = nodesRef.current.find((n) => n.id === edge.source)
      const target = nodesRef.current.find((n) => n.id === edge.target)
      if (!source || !target) return null
      return { edge, source, target, to: target.data.shotId || target.id }
    },
    [edges],
  )

  const generateTransitionKeyframe = useCallback(
    async (edgeId: string) => {
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, target, to } = pair
      const base = normalizeTransitionOut(source.data.transitionOut, to)
      const g = normalizeGenerated(base.generated)
      if (g.keyframe?.state === 'running') return
      if (!source.data.shotId) {
        setToast('这张镜头卡没有业务 ID，转场配置只存在画布，无法写回项目')
        window.setTimeout(() => setToast(''), 3600)
      }
      writeTransition(source.id, to, (cur) => ({
        ...cur,
        mode: 'generated',
        generated: {
          ...normalizeGenerated(cur.generated),
          keyframe: {
            ...(cur.generated?.keyframe ?? { candidates: [] }),
            state: 'running',
            error: undefined,
          },
        },
      }))
      const tid = startTask('image', '转场关键帧', { cost: imageCost(price, 1) })
      try {
        const { boundary, warnings } = await ensureTransitionBoundary(source, target, g.boundary)
        const missing = [
          ...collectShotReferences({ node: source, nodes: nodesRef.current, characters, missingMedia }).missing,
          ...collectShotReferences({ node: target, nodes: nodesRef.current, characters, missingMedia }).missing,
        ].map((m) => `${m.label}：${m.reason}`)
        const refs = effectiveTransitionRefs(
          source,
          target,
          nodesRef.current,
          characters,
          missingMedia,
          g,
        )
        const limited = clampKeyframeRefs([
          boundary.out || '',
          boundary.in || '',
          ...refs.map((r) => r.url),
        ])
        if (limited.urls.length === 0) throw new Error('没有可用的参考图，先给相邻镜头出画面')
        const prompt = keyframePrompt(source, target, g)
        const res = await generateImage({
          prompt,
          ratio: projectAspect,
          refImages: limited.urls,
          n: 1,
          modelKey: modelPick.image,
          ...(projectName ? { project: projectName } : {}),
        })
        const urls = res.urls?.length ? res.urls : [res.url]
        const keyframe = {
          candidates: urls,
          activeIdx: 0,
          image: urls[0],
          prompt,
          state: 'idle' as const,
        }
        writeTransition(source.id, to, (cur) => {
          const generated = { ...normalizeGenerated(cur.generated), boundary, keyframe }
          return {
            ...cur,
            mode: 'generated',
            generated,
            meta: {
              fingerprint: transitionFingerprint(source.data, target.data, generated),
              modelKey: modelPick.image,
              createdAt: new Date().toISOString(),
            },
          }
        })
        endTask(tid)
        if (missing.length) {
          setToast(`参考图缺失：${missing.slice(0, 3).join('；')}`)
          window.setTimeout(() => setToast(''), 4200)
        } else if (warnings.length) {
          setToast(warnings.join('；'))
          window.setTimeout(() => setToast(''), 4200)
        } else if (limited.omitted > 0) {
          setToast(`参考图超过 10 张，已省略 ${limited.omitted} 张`)
          window.setTimeout(() => setToast(''), 3200)
        }
      } catch (e) {
        const message = (e as Error).message || '关键帧生成失败'
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            keyframe: {
              ...(cur.generated?.keyframe ?? { candidates: [] }),
              state: 'error',
              error: message,
            },
          },
        }))
        endTask(tid, message)
      }
    },
    [
      transitionPair,
      writeTransition,
      characters,
      missingMedia,
      projectAspect,
      modelPick,
      projectName,
      price,
    ],
  )

  const generateTransitionVideo = useCallback(
    async (edgeId: string) => {
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, target, to } = pair
      const base = normalizeTransitionOut(source.data.transitionOut, to)
      const g = normalizeGenerated(base.generated)
      const keyframe = g.keyframe?.image || g.keyframe?.candidates?.[g.keyframe?.activeIdx ?? 0]
      if (!keyframe) {
        setToast('先生成并确认关键帧，再生成转场视频')
        window.setTimeout(() => setToast(''), 2600)
        return
      }
      if (g.video?.state === 'running') return
      const videoKey = modelPick.video || appSettings?.defaults?.video || ''
      const entry = appSettings?.models.find((m) => m.key === videoKey)
      const supportsLast = modelSupportsLastFrame(entry)
      const req = transitionRequestSeconds(g.targetSeconds, entry?.model, supportsLast)
      writeTransition(source.id, to, (cur) => ({
        ...cur,
        mode: 'generated',
        generated: {
          ...normalizeGenerated(cur.generated),
          video: {
            ...(cur.generated?.video ?? {}),
            state: 'running',
            error: undefined,
            at: Date.now(),
            modelKey: videoKey,
            seconds: req.seconds,
            ...(req.trimTo ? { trimTo: req.trimTo } : {}),
          },
        },
      }))
      const tid = startTask('video', '转场视频', {
        cost: videoCost(price, req.seconds, vidRes),
      })
      try {
        const { boundary, warnings } = await ensureTransitionBoundary(source, target, g.boundary)
        const res = await startVideo({
          transition: {
            boundaryOut: boundary.out,
            boundaryIn: boundary.in,
            keyframe,
          },
          prompt: transitionVideoPrompt(source, target, g),
          seconds: req.seconds,
          ratio: projectAspect,
          resolution: vidRes,
          cameraFixed: false,
          modelKey: videoKey,
        })
        const done = await waitVideo(res.id)
        writeTransition(source.id, to, (cur) => {
          const generated = {
            ...normalizeGenerated(cur.generated),
            boundary,
            video: {
              url: done.url,
              modelKey: videoKey,
              seconds: req.seconds,
              ...(req.trimTo ? { trimTo: req.trimTo } : {}),
              state: 'idle' as const,
            },
          }
          return {
            ...cur,
            mode: 'generated',
            generated,
            meta: {
              fingerprint: transitionFingerprint(source.data, target.data, generated),
              modelKey: videoKey,
              createdAt: new Date().toISOString(),
            },
          }
        })
        endTask(tid)
        if (warnings.length) {
          setToast(warnings.join('；'))
          window.setTimeout(() => setToast(''), 4200)
        }
      } catch (e) {
        const message = (e as Error).message || '转场视频生成失败'
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            video: {
              ...(cur.generated?.video ?? {}),
              state: 'error',
              error: message,
            },
          },
        }))
        endTask(tid, message)
      }
    },
    [transitionPair, writeTransition, modelPick, appSettings, projectAspect, vidRes, price],
  )

  /** 批量只动效果转场；生成转场必须逐条手动，避免一次点掉多次视频生成 */
  const unifyTransitions = useCallback(() => {
    let changed = 0
    for (const e of edges) {
      if ((e.data?.relation ?? 'cut') !== 'transition') continue
      const source = nodesRef.current.find((n) => n.id === e.source)
      const target = nodesRef.current.find((n) => n.id === e.target)
      if (!source || !target) continue
      const to = target.data.shotId || target.id
      const cur = normalizeTransitionOut(source.data.transitionOut, to)
      if (cur.mode === 'generated') continue
      const effect = normalizeEffect(cur.effect)
      if (effect.type === 'dissolve' && Math.abs(effect.seconds - 0.5) < 0.001) continue
      writeTransition(source.id, to, (c) => ({
        ...c,
        mode: 'effect',
        effect: normalizeEffect({ type: 'dissolve', seconds: 0.5 }),
      }))
      changed++
    }
    setToast(
      changed
        ? `已把 ${changed} 条转场统一为叠化 0.5s（生成转场保持不变）`
        : '没有需要改的效果转场；生成转场保持原样',
    )
    window.setTimeout(() => setToast(''), 3200)
  }, [edges, writeTransition])

  /** 台词配音：走本地 TTS provider（当前是 macOS say） */
  const generateVoiceOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const text = node.data.dialogue.trim()
      if (!text) {
        patch(id, { voiceState: 'error', voiceError: '这一镜没有台词' })
        return
      }
      const available = voicesRef.current
      const lines = parseDialogue(text)
      const audioModel = appSettings?.models.find((m) => m.key === audioModelKey)
      const currentProviderId = audioModel?.provider
      const charOf = (speaker: string) => charactersRef.current.find((c) => c.name === speaker)
      const pick = available.find((v) => v.id === node.data.voiceName) ?? available[0]
      const resolutions = lines.map((line) =>
        resolveVoiceForSpeaker({
          character: charOf(line.speaker),
          currentProviderId,
          fallbackVoice: pick?.id,
        }),
      )
      const failed = resolutions.find((r) => !r.ok)
      if (failed && !failed.ok) {
        patch(id, { voiceState: 'error', voiceError: failed.reason })
        return
      }
      const voiceOf = (speaker: string) => {
        const idx = lines.findIndex((l) => l.speaker === speaker)
        const r = idx >= 0 ? resolutions[idx] : null
        return r?.ok ? r.voice : pick?.id || ''
      }
      patch(id, { voiceState: 'running', voiceError: undefined, ...(pick ? { voiceName: pick.id } : {}) })
      const deliveryOf = (speaker: string, i: number) =>
        deliveryForSpeaker(node.data.performance, speaker, node.data.dialogueDelivery, i)
      const deliveries = lines.map((l, i) => deliveryOf(l.speaker, i))
      const firstVoice = lines.length ? charOf(lines[0].speaker)?.voiceId || pick?.id || '' : ''
      const payload = lines.length > 1
        ? {
            lines: lines.map((l, i) => ({
              text: l.text,
              voice: voiceOf(l.speaker),
              rate: node.data.voiceRate ?? 180,
              ...deliveries[i],
            })),
          }
        : {
            text: lines[0]?.text ?? text,
            voice: voiceOf(lines[0]?.speaker ?? ''),
            rate: node.data.voiceRate ?? 180,
            performance: deliveries[0],
          }

      try {
        const r = await generateVoice({ ...payload, modelKey: modelPick.audio })
        patch(id, {
          voiceUrl: r.url,
          voiceState: 'idle',
          voiceSeconds: r.seconds,
          voiceMeta: {
            engine: r.engine,
            model: modelPick.audio || undefined,
            voice: firstVoice,
            applied: r.applied ?? [],
            unsupported: r.unsupported ?? [],
            fingerprint: voiceFingerprint(text, deliveries),
            createdAt: new Date().toISOString(),
          },
        })
      } catch (e) {
        patch(id, { voiceState: 'error', voiceError: (e as Error).message })
      }
    },
    [patch, modelPick, appSettings, audioModelKey],
  )

  const voiceAll = async () => {
    if (vbatch) return
    const list = nodesRef.current.filter((n) => n.data.dialogue.trim())
    if (list.length === 0) {
      setToast('没有带台词的镜头')
      window.setTimeout(() => setToast(''), 2000)
      return
    }
    setVbatch({ total: list.length, done: 0 })
    for (const n of list) {
      const tid = startTask('voice', `${n.data.no} 配音`, {
        retry: () => void generateVoiceOne(n.id),
      })
      try {
        await generateVoiceOne(n.id)
        const after = nodesRef.current.find((x) => x.id === n.id)
        endTask(tid, after?.data.voiceState === 'error' ? after.data.voiceError || '配音失败' : undefined)
      } catch (e: any) {
        endTask(tid, String(e?.message || e))
      }
      setVbatch((b) => (b ? { ...b, done: b.done + 1 } : b))
      await new Promise((r) => setTimeout(r, 120))
    }
    setVbatch(null)
    setToast(`配音完成 ${list.length} 镜`)
    window.setTimeout(() => setToast(''), 2200)
  }

  const generateAll = async () => {
    if (batch) return
    const list = nodesRef.current
    if (list.length === 0) return
    setBatch({ total: list.length, done: 0 })
    for (const n of list) {
      // 记账在 generateOne 内部完成，这里只管进度
      await generateOne(n.id)
      setBatch((b) => (b ? { ...b, done: b.done + 1 } : b))
      await new Promise((r) => setTimeout(r, 350))
    }
    setBatch(null)
  }

  /** 批量出片：只挑「有画面、还没视频」的镜头 */
  const generateVideoAll = async () => {
    if (vidBatch) return
    const list = nodesRef.current.filter((n) => n.data.refImage && !n.data.videoUrl)
    if (list.length === 0) {
      setToast('没有可出片的镜头（要先有画面）')
      window.setTimeout(() => setToast(''), 2200)
      return
    }
    setVidBatch({ total: list.length, done: 0 })
    for (const n of list) {
      await generateVideoOne(n.id)
      setVidBatch((b) => (b ? { ...b, done: b.done + 1 } : b))
      await new Promise((r) => setTimeout(r, 400))
    }
    setVidBatch(null)
    setToast(`出片完成 ${list.length} 镜`)
    window.setTimeout(() => setToast(''), 2200)
  }

  /** 画面轨换序：把某镜移到目标下标（时间线上拖动触发） */
  /** 时间线换序只动分镜，素材卡保持原位 */
  const pickShot = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    setSelId(id)
    setCenter(n.position.x + cardWidth(n.data.seconds) / 2, n.position.y + 100, {
      zoom: Math.max(0.7, getZoom()),
      duration: 420,
    })
  }

  /** 清空画布：只动画布，不碰 project.json */
  const clearCanvas = () => {
    if (nodesRef.current.length === 0 && edges.length === 0) {
      setToast('画布已经是空的')
      window.setTimeout(() => setToast(''), 2000)
      return
    }
    if (!window.confirm('清空画布上的所有卡片和连线？project.json 里的镜头不受影响，可以再推一次。')) return
    setNodes((ns) => ns.filter((n) => (n as unknown as AssetNodeType).type === 'asset')) // 素材卡保留
    setEdges([])
    setSelId(null)
    setToast('画布已清空（素材卡保留，project.json 未改动）')
    window.setTimeout(() => setToast(''), 2600)
  }

  const resetAll = () => {
    try {
      if (projectName) localStorage.removeItem(projectCanvasKey(projectName))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setNodes(projectName ? [] : initialNodes)
    setEdges(projectName ? [] : initialEdges)
    setSelId(null)
    setTool('none')
    syncedRef.current = new Map()
    window.setTimeout(() => fitView({ padding: 0.12, minZoom: 0.66, duration: 400 }), 60)
  }

  const exportJson = () => {
    const payload = {
      project: '回收人 · 分镜',
      exportedAt: new Date().toISOString(),
      shots: nodes.map((n) => ({
        id: n.id,
        ...n.data,
        position: n.position,
        marks: n.data.marks,
      })),
      relations: edges.map((e) => ({ from: e.source, to: e.target, relation: e.data?.relation ?? 'cut' })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'storyboard.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          projectCanvasKey(projectName),
          JSON.stringify({
            nodes,
            edges,
            characters,
            cleared: !nodes.some((n) => n.data?.shotId),
            epNo,
          }),
        )
      } catch {
        /* 图片过大超出配额时静默失败，不影响使用 */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [nodes, edges, characters, epNo, projectName, readyProject])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && /input|textarea|select/i.test(t.tagName)) return
      const k = e.key.toLowerCase()
      if (k === 'v') setTool('none')
      else if (k === 'p') setTool('pen')
      else if (k === 'r') setTool('rect')
      else if (k === 'g') setGuides((g) => !g)
      else if (k === 'escape') {
        setTool('none')
        setSelId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  const api = useMemo(
    () => ({
      tool,
      guides,
      color,
      charImages,
      patch,
      cycleEdge,
      setEdgeRelation,
      openTransition,
      generate: generateOne,
      cancelGenerate,
      generateVideo: generateVideoOne,
    }),
    [
      tool,
      guides,
      color,
      charImages,
      patch,
      cycleEdge,
      setEdgeRelation,
      openTransition,
      generateOne,
      cancelGenerate,
      generateVideoOne,
    ],
  )
  const selected = nodes.find((n) => n.id === selId) ?? null
  /** 选中镜头的出片请求预览；与 generateVideoOne 调用同一个纯拼装器 */
  const selectedVideoRequest = useMemo(() => {
    const type = (selected as unknown as { type?: string } | null)?.type
    if (!selected || (type && type !== 'shot')) return null
    const schedule = resolveShotSchedule({
      data: selected.data,
      shotId: selected.id,
      sceneLayouts,
      projectAspect,
    })
    return buildShotVideoRequest({
      data: selected.data,
      nodeId: selected.id,
      nodes,
      characters,
      missingMedia,
      schedule,
      model: selectedVideoModel,
      resolution: vidRes,
    })
  }, [
    selected,
    nodes,
    characters,
    missingMedia,
    sceneLayouts,
    projectAspect,
    selectedVideoModel,
    vidRes,
  ])
  const selEdge = selEdgeId ? edges.find((e) => e.id === selEdgeId) ?? null : null
  const selEdgeSource = selEdge ? nodes.find((n) => n.id === selEdge.source) ?? null : null
  const selEdgeTarget = selEdge ? nodes.find((n) => n.id === selEdge.target) ?? null : null

  return (
    <CanvasCtx.Provider value={api}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-dot" />
            <b>分镜画布</b>
            <span className="brand-sub">React Flow × Konva</span>
          </div>

          {/* 创意会话不绑定项目：选择器在该视图隐藏，但保留占位几何，
              否则导航会在进出创意时整体左移。slot-hidden 用 visibility + inert 语义
              让它不可见、不可聚焦、不被朗读，同时宽度照旧。 */}
          <div
            className={`topbar-project-slot ${view === 'creative' ? 'slot-hidden' : ''}`}
            aria-hidden={view === 'creative'}
            {...(view === 'creative' ? { inert: '' as unknown as boolean } : {})}
          >
            <ProjectSelect projects={projects} value={projectName} onChange={changeProject} />
            <ProjectMenu onCreated={applyProjectCreated} onDeleted={applyProjectDeletion} />
            <EpPicker
              projectName={projectName}
              epNo={epNo}
              setEpNo={setEpNo}
              version={epVersion}
            />
          </div>

          <div className="viewtabs" role="navigation" aria-label="工作台视图">
            <button
              className={view === 'creative' ? 'on' : ''}
              aria-current={view === 'creative' ? 'page' : undefined}
              onClick={() => changeView('creative')}
              title="创意工作室：不绑定项目，聊天即主界面"
            >
              创意
            </button>
            <button
              className={view === 'script' ? 'on' : ''}
              aria-current={view === 'script' ? 'page' : undefined}
              onClick={() => changeView('script')}
            >
              剧本
            </button>
            <button
              className={view === 'chars' ? 'on' : ''}
              aria-current={view === 'chars' ? 'page' : undefined}
              onClick={() => changeView('chars')}
            >
              角色
            </button>
            <button
              className={view === 'assets' ? 'on' : ''}
              aria-current={view === 'assets' ? 'page' : undefined}
              onClick={() => changeView('assets')}
            >
              素材
            </button>
            <button
              className={view === 'table' ? 'on' : ''}
              aria-current={view === 'table' ? 'page' : undefined}
              onClick={() => changeView('table')}
            >
              镜头表
            </button>
            <button
              className={view === 'prompts' ? 'on' : ''}
              aria-current={view === 'prompts' ? 'page' : undefined}
              onClick={() => changeView('prompts')}
            >
              提示词
            </button>
            <button
              className={view === 'board' ? 'on' : ''}
              aria-current={view === 'board' ? 'page' : undefined}
              onClick={() => changeView('board')}
            >
              画布
            </button>
            <button
              className={view === 'publish' ? 'on' : ''}
              aria-current={view === 'publish' ? 'page' : undefined}
              onClick={() => changeView('publish')}
              title="成片分发：抖音 / B站 / 头条"
            >
              发布
              {publishBadge.count > 0 ? <span className="nav-badge">{publishBadge.count}</span> : null}
            </button>
            <button
              className={view === 'settings' ? 'on' : ''}
              aria-current={view === 'settings' ? 'page' : undefined}
              onClick={() => changeView('settings')}
              title="大模型 / 技能 / 存储"
            >
              设置
            </button>
          </div>

          <div className="spacer" />

          {hasKey === false && (
            <span className="warn-chip" title="未在 ~/.canghe-skills/.env 找到 ARK_API_KEY">
              未配置密钥
            </span>
          )}
          <ThemeToggle />
          <TaskCenter />
          <button className="btn" onClick={exportJson}>
            导出 JSON
          </button>
        </header>

        {view === 'creative' ? (
          <CreativeStudio
            settings={appSettings}
            stagePick={stagePick}
            onToast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3000)
            }}
            onProjectDataChanged={() => {
              void reloadProjects()
              setEpVersion((v) => v + 1)
            }}
          />
        ) : view === 'table' ? (
          <ShotTable
            projectName={projectName}
            setProjectName={changeProject}
            onProjectsChanged={reloadProjects}
            onCanvas={onCanvasIds}
            epNo={epNo}
            settings={appSettings}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            onSaved={() => setEpVersion((v) => v + 1)}
            onPush={pushShotsToCanvas}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2600)
            }}
          />
        ) : view === 'script' ? (
          <ScriptBoard
            projectName={projectName}
            epNo={epNo}
            setEpNo={setEpNo}
            settings={appSettings}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            onDirtyChange={setScriptDirty}
            onGotoShotTable={() => changeView('table')}
            onSaved={() => setEpVersion((v) => v + 1)}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2800)
            }}
          />
        ) : view === 'prompts' ? (
          <PromptTable
            projectName={projectName}
            onCanvas={onCanvasIds}
            epNo={epNo}
            settings={appSettings}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            onPush={pushShotsToCanvas}
            canvasNodes={nodes}
            assets={assets}
            sceneLayouts={sceneLayouts}
            projectAspect={projectAspect}
            onEditorDirtyChange={setPromptEditorDirty}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2600)
            }}
          />
        ) : view === 'publish' ? (
          <PublishBoard
            projectName={projectName}
            epNo={epNo}
            initialDeliverableId={publishTarget}
            onConsumeInitial={() => setPublishTarget(null)}
            settings={appSettings}
            stagePick={stagePick}
            onToast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3200)
            }}
          />
        ) : view === 'settings' ? (
          <Settings
            onSaved={reloadSettings}
            onProjectsDeleted={applyProjectDeletion}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2800)
            }}
          />
        ) : view === 'assets' ? (
          <AssetBoard
            projectName={projectName}
            epNo={epNo}
            settings={appSettings}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            imageModelKey={modelPick.image}
            onPickImageModel={(key) => pickModelKey('image', key)}
            onCanvasDesignIds={onCanvasDesignIds}
            onPush={pushDesigns}
            onAddAssetCard={addAssetCardFromStock}
            price={price}
            missing={missingMedia}
            onImageMissing={markMissing}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3000)
            }}
          />
        ) : view === 'chars' ? (
          <CharacterBoard
            characters={characters}
            patch={patchCharacter}
            selectedShot={selected ? { id: selected.id, no: selected.data.no } : null}
            selectedShotBudget={
              selectedVideoRequest
                ? {
                    used: selectedVideoRequest.refs.length,
                    max: 4,
                    expression: Boolean(selected?.data.useExpressionRef),
                    omitted: selectedVideoRequest.omitted.length,
                  }
                : null
            }
            onInject={injectCharacter}
            voices={voices}
            onAdd={addCharacter}
            onDelete={deleteCharacter}
            onRename={renameCharacter}
            onExtract={extractCharacters}
            extracting={extracting}
            settings={appSettings}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            viewModel={modelPick.view}
            onPickViewModel={(key) => pickModelKey('view', key)}
            price={price}
            projectName={projectName}
            onPersist={saveCharactersNow}
            onPublishSheet={publishExpressionSheet}
            onReplace={replaceCharacters}
            epNo={epNo}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2800)
            }}
            missing={missingMedia}
            onImageMissing={markMissing}
            charsOn={charsOn}
            onToggleChars={toggleChars}
          />
        ) : (
        <main className="main">
          <div className={`canvas ${zoomLite ? 'zoom-lite' : ''}`}>
            <div className="canvas-tools">
              <ToolMenu
                tool={tool}
                setTool={setTool}
                color={color}
                setColor={setColor}
                colors={COLORS}
                guides={guides}
                setGuides={setGuides}
                relation={relation}
                setRelation={setRelation}
              />
              <BoardMenu
                perImage={money(price.image)}
                canGen={hasKey !== false}
                batch={batch}
                vidBatch={vidBatch}
                vbatch={vbatch}
                charsOn={charsOn}
                diagOn={diagOn}
                onAddShot={addShot}
                onGenAll={generateAll}
                onGenVideoAll={generateVideoAll}
                onVoiceAll={voiceAll}
                onUnifyTransitions={unifyTransitions}
                onFit={() => fitView({ padding: 0.2, duration: 400 })}
                onToggleChars={toggleChars}
                onToggleDiag={() => setDiagOn((v) => !v)}
                onClear={clearCanvas}
              />
              <button
                className="btn-mini"
                onClick={addAsset}
                title="添加素材卡：场景图 / 道具图 / 参考图 / 视频素材，连线到分镜卡即为参考"
              >
                + 素材
              </button>
              <button
                className="btn-mini"
                onClick={() => setPreview(true)}
                title="按时间尺顺序连播：有视频放视频，没视频按镜头时长定格"
              >
                ▶ 连播
              </button>
            </div>
            {/* 只数真正的分镜卡：无 shotId 的示例卡始终显示，不能用 shownNodes.length 判空 */}
            {shownNodes.filter((n) => n.data.shotId).length === 0 && otherEpCounts.length > 0 && (
              <div className="canvas-hint">
                <b>E{String(epNo).padStart(2, '0')} 这一集画布上没有卡片</b>
                <span>其他集还有：</span>
                {otherEpCounts.map(([e, c]) => (
                  <button key={e} className="btn-mini" onClick={() => setEpNo(e)}>
                    E{String(e).padStart(2, '0')} · {c} 张
                  </button>
                ))}
              </div>
            )}
            {selectedNodes.length > 0 && (
              <div className="selbar">
                <b>{selectedNodes.length} 张已选</b>
                <button className="btn-mini" onClick={() => runOnSelected('image')} disabled={!!selBusy}>
                  出图
                </button>
                {selBusy && selKind === 'image' && (
                  <button className="btn-mini" onClick={cancelBatch}>
                    取消出图
                  </button>
                )}
                <button className="btn-mini" onClick={() => runOnSelected('video')} disabled={!!selBusy}>
                  出片
                </button>
                <button className="btn-mini" onClick={() => runOnSelected('voice')} disabled={!!selBusy}>
                  配音
                </button>
                <button className="btn-mini" onClick={deleteSelected} disabled={!!selBusy}>
                  删除
                </button>
                {selBusy && <span className="selbusy">{selBusy}</span>}
              </div>
            )}

            {diagOn && (
              <DiagnosticsPanel
                issues={issues}
                onPick={(id) => {
                  setSelId(id)
                  const n = nodesRef.current.find((x) => x.id === id)
                  if (n) setCenter(n.position.x + 150, n.position.y + 120, { zoom: Math.max(0.8, getZoom()), duration: 400 })
                }}
                onClose={() => setDiagOn(false)}
              />
            )}

            <ReactFlow
              nodes={canvasNodes}
              edges={shownEdges as unknown as ShotEdgeType[]}
              onNodesChange={(changes) => {
                onNodesChange(changes)
                // 角色节点不在 nodes 状态里，位置变更单独路由到 charPos
                let moved = false
                setCharPos((p) => {
                  const next = { ...p }
                  for (const ch of changes) {
                    if (ch.type === 'position' && ch.id.startsWith('char-') && ch.position) {
                      next[charKey(ch.id)] = ch.position
                      moved = true
                    }
                  }
                  return moved ? next : p
                })
              }}
              onNodeDragStop={(_, node) => {
                if (node.id.startsWith('char-')) {
                  setCharPos((p) => {
                    const next = { ...p, [charKey(node.id)]: node.position }
                    localStorage.setItem('storyboard-char-pos', JSON.stringify(next))
                    return next
                  })
                }
              }}
              onMove={(_, vp) => {
                const lite = vp.zoom < 0.55
                if (lite !== zoomLiteRef.current) {
                  zoomLiteRef.current = lite
                  setZoomLite(lite)
                }
              }}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDeleted}
              onBeforeDelete={async ({ edges: delEdges }) => {
                const trans = delEdges.filter(
                  (e) => !e.id.startsWith('ref-') && (e.data?.relation ?? 'cut') === 'transition',
                )
                if (trans.length === 0) return true
                const risky = trans.some((e) => {
                  const src = nodesRef.current.find((n) => n.id === e.source)
                  const tgt = nodesRef.current.find((n) => n.id === e.target)
                  if (!src || !tgt) return false
                  const to = tgt.data.shotId || tgt.id
                  const cur = src.data.transitionOut
                  return Boolean(
                    cur &&
                      cur.to === to &&
                      (cur.generated?.video?.url || cur.generated?.keyframe?.candidates?.length),
                  )
                })
                return (
                  !risky ||
                  window.confirm('删除这条转场连线会同时清除已生成的关键帧/视频配置。继续？')
                )
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, n) => {
                setSelRef(null)
                setSelEdgeId(null)
                if (n.id.startsWith('char-')) focusChar(charNameOf(n.id))
                else setSelId(n.id)
              }}
              onEdgeClick={(_, e) => {
                if (e.id.startsWith('ref-')) {
                  setSelId(null)
                  setSelEdgeId(null)
                  setSelRef(e.id)
                  return
                }
                if ((e.data?.relation ?? 'cut') === 'transition') {
                  setSelId(null)
                  setSelRef(null)
                  setSelEdgeId(e.id)
                }
              }}
              onPaneClick={() => {
                setSelRef(null)
                setSelId(null)
                setSelEdgeId(null)
                setCtx(null)
              }}
              onNodeContextMenu={(e, n) => {
                e.preventDefault()
                setSelRef(null)
                setSelEdgeId(null)
                setSelId(n.id)
                setCtx({ x: e.clientX, y: e.clientY, id: n.id })
              }}
              onPaneContextMenu={() => setCtx(null)}
              onNodesDelete={() => setSelId(null)}
              defaultEdgeOptions={{ type: 'shot' }}
              connectionLineStyle={{ stroke: themeColors.edgeCut, strokeWidth: 2 }}
              proOptions={{ hideAttribution: true }}
              onlyRenderVisibleElements
              minZoom={0.2}
              maxZoom={2.2}
              fitView
              fitViewOptions={{ padding: 0.12, minZoom: 0.66 }}
              deleteKeyCode={['Backspace', 'Delete']}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              selectionKeyCode="Shift"
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color={themeColors.canvasDot} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                position="top-right"
                nodeColor={themeColors.minimapNode}
                maskColor={themeColors.minimapMask}
                style={{ background: themeColors.minimapBg }}
              />
            </ReactFlow>

            {ctx && ctxData && (
              <NodeContextMenu
                x={ctx.x}
                y={ctx.y}
                headTitle={ctxData.headTitle}
                headSub={ctxData.headSub}
                sectionTitle={ctxData.sectionTitle}
                emptyText={ctxData.emptyText}
                hint={ctxData.hint}
                items={ctxData.items}
                onClickItem={(id) =>
                  ctxData.mode === 'shot' ? toggleRef(ctxData.targetId, id) : toggleRef(id, ctxData.targetId)
                }
                onFirstFrame={
                  ctxData.mode === 'shot' ? (id) => useAsFirstFrame(ctxData.targetId, id) : undefined
                }
                onEdit={() => {
                  setSelId(ctx.id)
                  setCtx(null)
                }}
                onDelete={
                  ctxData.nodeType === 'asset'
                    ? () => {
                        removeShot(ctx.id)
                        setCtx(null)
                      }
                    : undefined
                }
                onClose={() => setCtx(null)}
              />
            )}

            <Timeline
              nodes={episodeShots}
              edges={edges}
              activeId={selId}
              charImages={charImages}
              onPick={pickShot}
              onPatch={patch}
              onOpenTransition={openTransition}
            />
          </div>

          {selEdge && selEdgeSource && selEdgeTarget ? (
            <TransitionPanel
              edge={selEdge}
              source={selEdgeSource}
              target={selEdgeTarget}
              nodes={episodeShots}
              characters={characters}
              missingMedia={missingMedia}
              settings={appSettings}
              pick={modelPick}
              projectName={projectName}
              price={price}
              vidRes={vidRes}
              inactive={inactiveEdgeIds.has(selEdge.id)}
              onPatch={patch}
              onSetRelation={setEdgeRelation}
              onClose={() => setSelEdgeId(null)}
              onGenerateKeyframe={generateTransitionKeyframe}
              onGenerateVideo={generateTransitionVideo}
            />
          ) : (
            <Inspector
            node={selected}
            patch={patch}
            onDelete={removeShot}
            onReset={resetAll}
            onGenerate={generateOne}
            onCancelGenerate={cancelGenerate}
            ratio={ratio}
            setRatio={setRatio}
            refMode={refMode}
            setRefMode={setRefMode}
            marksAsGuide={marksAsGuide}
            setMarksAsGuide={setMarksAsGuide}
            candCount={candCount}
            setCandCount={setCandCount}
            vidRes={vidRes}
            setVidRes={setVidRes}
            onGenerateVideo={generateVideoOne}
            projectAspect={projectAspect}
            price={price}
            projectName={projectName}
            characters={characters}
            videoRequest={selectedVideoRequest}
            settings={appSettings}
            pick={modelPick}
            onPick={pickModelKey}
            onVoice={generateVoiceOne}
            voices={voices}
            voiceProvider={voiceProvider}
          />
          )}
        </main>
        )}

        {preview && (
          <Preview
            nodes={nodes}
            edges={edges}
            startId={selId}
            onClose={() => setPreview(false)}
            onPick={pickShot}
            assReady={assReady}
            epNo={epNo}
            onEpChange={setEpNo}
            projectName={projectName}
            onPublish={(deliverableId) => {
              setPublishTarget(deliverableId)
              setPreview(false)
              changeView('publish')
            }}
          />
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </CanvasCtx.Provider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ReactFlowProvider>
        <Shell />
      </ReactFlowProvider>
    </ThemeProvider>
  )
}

/** 只读当前集，供首帧恢复用（loadSaved 已解析过整份存档） */
function loadSavedEpNo(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 1
    const n = Number(JSON.parse(raw)?.epNo)
    return Number.isFinite(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}
