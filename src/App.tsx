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
import AssetBoard from './AssetBoard'
import ThemeToggle from './ThemeToggle'
import { ThemeProvider, useTheme } from './theme'
import Preview from './Preview'
import EpPicker from './EpisodeBar'
import ProjectMenu from './project/ProjectMenu'
import PromptDialog from './PromptDialog'
import AppShell from './shell/AppShell'
import ProjectHub from './shell/ProjectHub'
import OverviewPage from './shell/OverviewPage'
import { EPISODE_VIEWS, type ViewId } from './shell/nav'
import {
  ROUTE_EVENT,
  clearLastView,
  hubHash,
  navigate,
  parseHash,
  projectHash,
  readLastView,
  replaceWithHub,
  writeLastView,
  type Route,
} from './shell/route'
import { useRailCollapsed } from './shell/useRail'
import TaskCenter from './TaskCenter'
import ToolMenu from './ToolMenu'
import BoardMenu from './BoardMenu'
import { effectiveProdKind } from './shotProdKind'
import type { ShotProdKind } from './types'
import TransitionPanel from './TransitionPanel'
import { loadInspectorPrefs, saveInspectorPrefs } from './inspectorLayout'
import NodeContextMenu from './NodeContextMenu'
import EdgeContextMenu from './EdgeContextMenu'
import Settings, { type SettingsInitialSection } from './Settings'
import AccountPage from './account/AccountPage'
import IntakeDialog from './intake/IntakeDialog'
import WorkbenchBar from './WorkbenchBar'
import { auditKeyframePrompt } from './promptAudit'
import {
  planAddShot,
  planDeleteShot,
  planDeleteShots,
  planFixAnchors,
  planInsertAfter,
  planRenameShotNo,
  planShotImport,
  validateShotNos,
} from './canvasShotOps'
import { formatEpisodeLabel, reconcileProjectShots } from './shotRows'
import BoardEpisodeGrid from './board/BoardEpisodeGrid'
import EpisodeScriptImportDialog from './board/EpisodeScriptImportDialog'
import EpisodeScriptDetailDialog from './board/EpisodeScriptDetailDialog'
import { episodeScriptUi } from './board/episodeScriptUi'
import {
  blankEpisode,
  episodeHasScript,
  findEpisode,
  nextEpisodeNo,
  planDeleteEpisodeScript,
} from './board/episodeOps'
import { resolveEpisodeTarget, setEpisodeTargetSeconds } from './productionContext'
import StudioFrame from './creative/StudioFrame'
import { postStudioCanvasContext } from './creative/pushStudioCanvasContext'
import { useStudioProjectSync } from './creative/useStudioProjectSync'
import { resolveStudioMount } from './creative/keepalive'
import { useStudioWarmup } from './creative/useStudioWarmup'
import { cancelTask, endTask, startTask } from './tasks'
import { DiagnosticsPanel, diagnose } from './Diagnostics'
import { defaultCharacters, identityFingerprint, markExpressionSheetStale, markExpressionsStale, markVoiceSampleStale, type CharacterSheet } from './characters'
import { isSheetUsable } from './expressionSheet'
import { CanvasCtx } from './ctx'
import { initialEdges, initialNodes, type AssetNodeType, type CharNodeType, type ShotEdgeType, type ShotNodeType } from './data'
import { assetMediaType } from './mediaPick'
import { cardWidth, effectiveSeconds, migrateMarks, uid, type Relation, type ShotData, type Tool, type TransitionOut } from './types'
import {
  checkHealth,
  generateImage,
  generateVoice,
  extractFrames,
  getSettings,
  listProjects,
  listVoicesCached,
  getProject,
  listMedia,
  mergeProjectShots,
  patchProject,
  recoverVideo,
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
import {
  providerIdForAudioModelKey,
  resolveCharacterAudioModelKey,
  resolveVoiceForSpeaker,
} from './voiceCatalog'
import { audioCost, imageCost, money, normalizePricing, videoCost, type Pricing } from './pricing'
import { collectShotReferences, currentShotImage, hasNeighborReference, limitReferences, neighborReferenceItems, SHOT_NEXT, SHOT_PREV } from './shotReferences'
import { refreshPromptRenderTemplateVersion } from './promptRender'
import {
  buildShotVideoRequest,
  effectiveVideoPrompt,
  videoOmitToastMessages,
  type VideoModelInput,
} from './videoPrompt'
import { resolveVideoUpstreamRecover } from './videoRecover'
import { COMPOSE_HINT, composeReference } from './compose'
import { bizSignature, nodeToShot, shotToData } from './shotSync'
import { downloadEpisodeMarkdown } from './storyboardMarkdown'
import { buildShotRefIndex } from './shotRefIndex'
import {
  assetNodesFromAssets,
  buildShotNodes,
  composeShotCanvasEdges,
  composeShotCanvasNodes,
  isShotCanvasNode,
  repairTransitionEdges,
} from './canvasShots'
import {
  arrangeAll,
  charSlotPosition,
  nodeRect,
  placeNewNode,
  type ArrangeItem,
  type PlacedRect,
} from './canvasLayout'
import {
  canvasIdFromNodeId,
  applyLayout,
  assetKey,
  assetNodeId,
  diffLayout,
  layoutSnapshot,
  nodeKeyOf,
  planLegacyCanvasMigration,
  shotKey,
  type CanvasSpot,
} from './canvasLayoutStore'
import { readCharacters, toProject } from './charMap'
import { STAGE_PICK_KEY, stageModelKey, type StagePick } from './ModelSelect'
import { ensureSkillsMigrated } from './skills/migrate'
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
  buildTransitionVideoPreview,
  buildTransitionVideoRequest,
  transitionRequestSeconds,
  transitionStyleRefTokens,
  transitionRefEdgeId,
  parseTransitionRefEdgeId,
  isTransitionDedicatedRefToken,
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

/**
 * 本地存档只当缓存：
 * - v1：`{ nodes, edges, characters, epNo }`——沙盒（未选项目）画布的完整形状；
 * - v2：`{ version: 2, edges, epNo }`——项目模式只存**边与集号**。
 *   节点位置与素材卡身份已经随项目落库（`canvas_layouts` / `assets.canvas_id`），
 *   再在本地存一份节点就成了第二个真相源，换端口/换机器就会两份数据打架。
 */
type Saved = {
  version?: 1 | 2
  nodes?: ShotNodeType[]
  edges: ShotEdgeType[]
  characters?: CharacterSheet[]
  /** 当前集也要记住，否则刷新后一律回到第 1 集，看起来像「别的集的卡片和视频丢了」 */
  epNo?: number
}

function readSavedKey(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (Number(p?.version) === 2) {
      // v2 没有 nodes：只要还能取回边或集号就是有效存档，
      // 否则会被当成「没存过」而回落到旧的全局画布迁移分支，把别的项目的画布灌进来
      const ep = Number(p?.epNo)
      const hasEp = Number.isFinite(ep) && ep > 0
      if (!Array.isArray(p?.edges) && !hasEp) return null
      return {
        version: 2,
        nodes: [],
        edges: Array.isArray(p.edges) ? (p.edges as ShotEdgeType[]) : [],
        characters: defaultCharacters,
        epNo: hasEp ? ep : 1,
      }
    }
    if (!Array.isArray(p?.nodes)) return null
    const savedEp = Number(p.epNo)
    const hasSavedEp = Number.isFinite(savedEp) && savedEp > 0
    // 空存档只有在记住了集号时才是有效存档（清空后的画布可以正好是空的）
    if (p.nodes.length === 0 && !hasSavedEp) return null
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
        if (data.transitionOut?.generated?.video?.state === 'running') {
          const generated = normalizeGenerated(data.transitionOut.generated)
          data.transitionOut = {
            ...data.transitionOut,
            generated: {
              ...generated,
              video: {
                ...(generated.video ?? {}),
                state: 'idle',
                error: undefined,
                at: undefined,
              },
            },
          }
        }
        return { ...n, data }
      }),
      edges: p.edges ?? [],
      characters: Array.isArray(p.characters) ? p.characters : defaultCharacters,
      epNo: Number.isFinite(Number(p.epNo)) && Number(p.epNo) > 0 ? Number(p.epNo) : 1,
    }
  } catch {
    return null
  }
}

function loadSaved(): Saved | null {
  return readSavedKey(STORAGE_KEY)
}

/** 创意视图访问标记：回访用户的外壳值得提前载入，这是首访之外唯一的预热信号之一 */
const STUDIO_VISITED_KEY = 'sb.studioVisited'

function readStudioVisited(): boolean {
  try {
    return localStorage.getItem(STUDIO_VISITED_KEY) === '1'
  } catch {
    // 隐私模式下 localStorage 会抛错：按首访处理，最坏结果只是晚一点预热
    return false
  }
}

function markStudioVisited() {
  try {
    localStorage.setItem(STUDIO_VISITED_KEY, '1')
  } catch {
    // 存不了就只在本次会话里生效：不影响功能，只是下次启动会重新当首访
  }
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
  const relevant = (legacy.nodes ?? []).some((n) => {
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

/** 派生边（参考连线、转场参考、cast 虚线）不参与关系菜单 */
const isDerivedEdgeId = (id: string) =>
  id.startsWith('ref-') || id.startsWith('ref-tr|') || id.startsWith('cast-')

/** 画布上已有素材卡的矩形：新增卡落位时用来避让 */
const assetRectsOf = (list: ShotNodeType[]): PlacedRect[] =>
  list
    .filter((n) => (n as unknown as AssetNodeType).type === 'asset')
    .map((n) => nodeRect('asset', n.position))

const isAssetCanvasNode = (n: ShotNodeType) => (n as unknown as { type?: string }).type === 'asset'

/**
 * 造一张新素材卡：id 由新 canvasId 派生（与 `shot.refIds` 同源），位置在素材带避让。
 * 所有创建入口（加卡 / 在线素材 / 设定发布 / 表情总图）都走这里，
 * 否则又会散出四种「随机 uid + 各自内联坐标」的写法。
 */
function newAssetCard(existing: ShotNodeType[], data: Record<string, unknown>): ShotNodeType {
  const canvasId = uid()
  return {
    id: assetNodeId(canvasId),
    type: 'asset',
    position: placeNewNode('asset', assetRectsOf(existing)),
    data,
  } as unknown as ShotNodeType
}

/**
 * 画布素材卡节点 → `assets` 载荷。
 * 必须带 `canvasId`：服务端整表替换时这段是可选的兜底，但少传一次就要靠 kind+title 猜身份，
 * 标题改过就猜不回来。
 */
function assetsPayloadOf(nodes: ShotNodeType[]): ProjectAsset[] {
  const out: ProjectAsset[] = []
  for (const n of nodes) {
    if (!isAssetCanvasNode(n)) continue
    const d = n.data as unknown as {
      kind?: string
      title?: string
      url?: string
      designId?: string
      characterName?: string
    }
    const canvasId = canvasIdFromNodeId(n.id)
    out.push({
      kind: d.kind || 'image',
      title: d.title || '',
      url: d.url || '',
      ...(d.designId ? { designId: d.designId } : {}),
      ...(d.characterName ? { characterName: d.characterName } : {}),
      ...(canvasId ? { canvasId } : {}),
    })
  }
  return out
}

/**
 * 给缺 `canvasId` 的素材卡补一个并落库。
 * 补一次就固定下来：之后无论重启多少次、端口换成什么，节点 id 都不变，参考连线才不会断。
 */
async function ensureAssetCanvasIds(projectName: string, assets: ProjectAsset[]): Promise<ProjectAsset[]> {
  let missing = 0
  const next = assets.map((a) => {
    if (String(a.canvasId ?? '').trim()) return a
    missing++
    return { ...a, canvasId: uid() }
  })
  if (!missing) return next
  try {
    await patchProject(projectName, { assets: next } as never)
  } catch {
    /* 落库失败不阻塞打开：本轮仍用同一批 id，至少这一次的参考连线是对的 */
  }
  return next
}

/** 旧项目存档改名后保留的备份后缀（不删除，可回退） */
const LEGACY_PROJECT_BACKUP_SUFFIX = ':legacy-backup'

/**
 * 存量 v1 本地画布 → 项目数据的一次性迁移。
 *
 * 只在项目还没有任何布局行时执行：已经有布局行说明新版已经写过，
 * 这时旧存档再生效只会把用户后来摆的位置改回去。
 * 成功后把 v1 存档原样改名到 `:legacy-backup`，并把「边 + 集号」转存成 v2 缓存。
 */
async function migrateLegacyCanvasIfNeeded(
  projectName: string,
  project: ProjectData,
): Promise<(ReturnType<typeof planLegacyCanvasMigration> & { assets: ProjectAsset[] }) | null> {
  if ((project.canvas ?? []).length > 0) return null
  const key = projectCanvasKey(projectName)
  let raw = ''
  try {
    raw = localStorage.getItem(key) || ''
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: { version?: number; nodes?: unknown[]; edges?: unknown[]; epNo?: unknown } | null = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || Number(parsed.version) === 2) return null
  const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as never[]) : []
  if (!nodes.length) return null

  const assets = project.assets ?? []
  const plan = planLegacyCanvasMigration(nodes, assets)
  if (!plan.canvas.length && !plan.canvasIds.length) return null

  // 先写卡身份再写位置：布局行按 canvasId 命名，身份没落库坐标就成了无主行
  const byIndex = new Map(plan.canvasIds.map((c) => [c.index, c.canvasId]))
  const nextAssets = assets.map((a, i) => {
    const canvasId = byIndex.get(i)
    return canvasId && !String(a.canvasId ?? '').trim() ? { ...a, canvasId } : a
  })
  try {
    if (plan.canvasIds.length) await patchProject(projectName, { assets: nextAssets } as never)
    if (plan.canvas.length) await patchProject(projectName, { canvas: plan.canvas } as never)
  } catch {
    // 迁移失败保持原样：旧存档不动，下次打开再试
    return null
  }

  try {
    localStorage.setItem(key + LEGACY_PROJECT_BACKUP_SUFFIX, raw)
    const epNo = Number(parsed.epNo)
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
        epNo: Number.isFinite(epNo) && epNo > 0 ? epNo : 1,
      }),
    )
  } catch {
    /* 配额不足时至少数据已经进了项目库 */
  }
  return { ...plan, assets: nextAssets }
}

function Shell() {
  const saved = useMemo(loadSaved, [])
  const [nodes, setNodes, onNodesChange] = useNodesState<ShotNodeType>(saved?.nodes ?? initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<ShotEdgeType>(
    repairTransitionEdges(saved?.nodes ?? initialNodes, saved?.edges ?? initialEdges),
  )
  const [characters, setCharacters] = useState<CharacterSheet[]>(saved?.characters ?? defaultCharacters)
  /** 两级路由：#/ 是项目大厅，#/p/<项目>/<视图> 是工作区；视图完全由 route 派生 */
  const [route, setRoute] = useState<Route>(() => parseHash(
    typeof window === 'undefined' ? '#/' : window.location.hash,
  ))
  const view: ViewId = route.kind === 'project' ? route.view : 'overview'
  /**
   * 创意入口开关（灰度）：关掉时左栏不显示「创意」，直接打开旧的创意 URL 也回落到概览。
   * 值来自服务端设置而不是构建时常量，所以切换后刷新即可生效，不必重启应用。
   */
  const [studioEnabled, setStudioEnabled] = useState(true)
  /**
   * 创意视图是否常驻：首次进入后切走只隐藏、不卸载 iframe。
   * 宿主前端是几十 MB 的一份独立应用，重建一次要重新激活整棵插件树，
   * 而切页本身在应用里是亚毫秒的组件替换——常驻就是为了抹平这个差。
   * 值由服务端下发（`SB_STUDIO_NO_KEEPALIVE` 可关掉），默认开启。
   */
  const [studioKeepAlive, setStudioKeepAlive] = useState(true)
  /**
   * 是否允许在后台预热带创意外壳（`SB_STUDIO_NO_PRELOAD` 可关）。
   * 值同样由服务端下发：弱网机队或排障时改环境变量重启即可，不必重新构建前端。
   */
  const [studioPreload, setStudioPreload] = useState(true)
  /**
   * 开关是否已经从服务端拿到。
   *
   * 首帧还不知道服务端是否允许预热，必须先当「不允许」：否则默认值 `true`
   * 会抢在开关到达之前发一次探测，让「关掉预热」也留下后台请求。
   */
  const [studioFlagsLoaded, setStudioFlagsLoaded] = useState(false)
  /** 此前进入过创意：回访用户的外壳值得提前载入（`localStorage` 读不到就当首访） */
  const [studioVisited, setStudioVisited] = useState(readStudioVisited)
  /** 指针悬停或键盘聚焦过「创意」入口：首访用户的提前意图 */
  const [studioIntent, setStudioIntent] = useState(false)
  /** 首次进入创意后才挂载：应用启动就挂等于让宿主产物和首屏抢带宽 */
  const [studioMounted, setStudioMounted] = useState(view === 'creative')
  useEffect(() => {
    let alive = true
    fetch('/api/studio/enabled', { credentials: 'include' })
      .then((r) => r.json())
      .then((body) => {
        if (!alive) return
        if (typeof body?.enabled === 'boolean') setStudioEnabled(body.enabled)
        if (typeof body?.keepAlive === 'boolean') setStudioKeepAlive(body.keepAlive)
        // 缺字段按开启处理：老后端配新前端时不该因为少一个字段就悄悄失去预热
        if (typeof body?.preload === 'boolean') setStudioPreload(body.preload)
        setStudioFlagsLoaded(true)
      })
      .catch(() => {
        // 拿不到就按开启处理：隐藏入口是灰度手段，不该因一次网络抖动把功能藏掉
        if (alive) setStudioFlagsLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (view !== 'creative' || !studioEnabled) return
    // 一次性置位：之后离开创意视图只隐藏，保证宿主文档与连接存活
    setStudioMounted(true)
    // 记下「来过」：下次启动时外壳值得在后台预热（首访仍按需加载）
    markStudioVisited()
    setStudioVisited(true)
  }, [view, studioEnabled])
  /**
   * 挂载决策放在渲染前算一次：内联分支与常驻容器都读它，
   * 避免两处各写一份「什么时候该渲染」而漂移。
   */
  const studioMount = resolveStudioMount({
    enabled: studioEnabled,
    keepAlive: studioKeepAlive,
    mounted: studioMounted,
    active: view === 'creative',
  })
  /**
   * 外壳预热：把「点开创意要等 300ms 加载 + 插件树激活」挪到后台。
   *
   * 触发条件由 `resolveStudioWarmup` 决定（回访或指针/焦点意图，且链路与设备都允许），
   * 命中就提前把 `studioMounted` 置为真——渲染树与常驻容器完全不用改，
   * 整个特性只是让这个布尔值早一点变 true。
   */
  useStudioWarmup({
    enabled: studioEnabled,
    keepAlive: studioKeepAlive,
    // 开关未到达前当「不允许」：宁可晚一次渲染，也不要先漏一次探测
    preload: studioFlagsLoaded && studioPreload,
    mounted: studioMounted,
    active: view === 'creative',
    visited: studioVisited,
    intent: studioIntent,
    onMount: () => setStudioMounted(true),
  })
  useEffect(() => {
    if (studioEnabled || route.kind !== 'project' || route.view !== 'creative') return
    navigate(projectHash(route.project, 'overview'))
  }, [studioEnabled, route])
  /** 项目名是路由的派生值：大厅没有当前项目，因此不会去拉项目详情 */
  const projectName = route.kind === 'project' ? route.project : ''
  const { collapsed: railCollapsed, toggle: toggleRail } = useRailCollapsed(view)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  /** 是否已经成功拉过一次项目列表：大厅用它区分「加载中」与「一个项目都没有」 */
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  /** 已经加载完成的项目；只有它等于 projectName 时才允许写回 */
  const [readyProject, setReadyProject] = useState('')
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsInitialSection | undefined>(
    undefined,
  )
  const projectEpochRef = useRef(0)
  /** 最近一次加载的项目快照：Agent 的 ownDraft / projectSnapshot 读它 */
  const projectSnapRef = useRef<ProjectData | null>(null)
  /** 改镜号的正式处理函数（patch 层拦截，避免 Inspector 直接改本地 no） */
  const renameShotNoRef = useRef<(node: ShotNodeType, no: string) => void>(() => {})
  /** 当前集：画布 / 3D 等视图共用 */
  const [epNo, setEpNo] = useState(1)
  /** 项目镜头快照：画布、导入、Agent 写回都以它为输入（真相仍在 project.json） */
  const [projectShots, setProjectShots] = useState<ProjectShot[]>([])
  /** 项目分集快照：集摘要与目标时长从这里取 */
  const [episodes, setEpisodes] = useState<ProjectEpisode[]>([])
  /** 画布导入对话框 */
  const [intakeOpen, setIntakeOpen] = useState(false)
  /** 工作台保存后自增，用来刷新集栏的镜数 */
  const [epVersion, setEpVersion] = useState(0)
  /** 画布两阶段：集目录 → 单集 Flow；不持久化，刷新与左栏进画布回落目录 */
  const [boardPhase, setBoardPhase] = useState<'episodes' | 'canvas'>('episodes')
  const [scriptImportOpen, setScriptImportOpen] = useState(false)
  const [episodeScriptDetailEpNo, setEpisodeScriptDetailEpNo] = useState<number | null>(null)
  const [scriptHintEpNo, setScriptHintEpNo] = useState<number | undefined>()
  const [addEpisodeBusy, setAddEpisodeBusy] = useState(false)
  const [addEpisodePromptOpen, setAddEpisodePromptOpen] = useState(false)
  /** 清空画布的二次确认：要求手打当前集号 */
  const [clearPromptOpen, setClearPromptOpen] = useState(false)
  const [deleteEpisodeScriptEpNo, setDeleteEpisodeScriptEpNo] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [tool, setTool] = useState<Tool>('none')
  const [guides, setGuides] = useState(true)
  const [color, setColor] = useState(COLORS[0])
  const [relation, setRelation] = useState<Relation>('cut')
  const [selId, setSelId] = useState<string | null>(null)
  /** 选中的转场连线（与 selId 互斥）：只由右键菜单「转场设置」写入 */
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null)
  /** 连线右键菜单：同一时刻与节点右键菜单互斥 */
  const [edgeCtx, setEdgeCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  const [ratio, setRatio] = useState('16:9')
  const [refMode, setRefMode] = useState(false)
  const [marksAsGuide, setMarksAsGuide] = useState(true)
  const [candCount, setCandCount] = useState(1)
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null)
  const [vidRes, setVidRes] = useState<'480p' | '720p'>('480p')
  /**
   * 本轮由 Agent 写入的转场参考：`afterShotId|toShotId` → token 列表。
   * 刻意只放内存——标记语义是「这一轮改的」，落盘后用户手改也无法撤销。
   */
  const [transitionAgentRefs, setTransitionAgentRefs] = useState<Record<string, string[]>>({})
  const [preview, setPreview] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [assReady, setAssReady] = useState(false)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voiceProvider, setVoiceProvider] = useState('')
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  /** 素材页设定卡数量（侧栏徽标；非画布 asset 节点数） */
  const [designSheetCount, setDesignSheetCount] = useState(0)
  /** 项目画幅：白模渲染与出片共用 */
  const [projectAspect, setProjectAspect] = useState('16:9')
  const [projectStyle, setProjectStyle] = useState('')
  const assetsSnapRef = useRef('')
  /**
   * 画布布局的写回通道：
   * - `layoutSnapRef` 是「已确认落库的位置」，拖动结束只提交与它不同的 key；
   * - `layoutPendingRef` / `layoutDeleteRef` 是 400ms 合并窗口里的待提交项；
   * - 水合与载入后重置快照，因此「只是加载」不会发出任何位置写回。
   */
  const layoutSnapRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const layoutPendingRef = useRef<Map<string, CanvasSpot>>(new Map())
  const layoutDeleteRef = useRef<Set<string>>(new Set())
  const layoutTimerRef = useRef<number | null>(null)
  /** 待提交项归属的项目：切项目时仍写回原来那个，不串到新项目 */
  const layoutProjectRef = useRef('')
  /** 服务端报告的缺失媒体引用（角色三视图 / 设定图） */
  const [missingMedia, setMissingMedia] = useState<Set<string>>(new Set())
  const { fitView, setCenter, getZoom } = useReactFlow()
  const { colors: themeColors } = useTheme()
  /** 上次同步到 project.json 的业务字段快照：只有之后的改动才写回 */
  const syncedRef = useRef<Map<string, string>>(new Map())
  /** 角色上一次同步到 project.json 的快照 */
  const charSnapRef = useRef<string>('')

  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const voicesRef = useRef<VoiceOption[]>([])
  const charactersRef = useRef(characters)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  useEffect(() => {
    charactersRef.current = characters
  }, [characters])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  /** 立即提交待写回的布局：切项目、卸载前都不用等 400ms 合并窗口 */
  const flushCanvasLayout = useCallback(() => {
    if (layoutTimerRef.current !== null) {
      window.clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = null
    }
    const project = layoutProjectRef.current
    const rows = [...layoutPendingRef.current.values()]
    const deletes = [...layoutDeleteRef.current]
    layoutPendingRef.current = new Map()
    layoutDeleteRef.current = new Set()
    layoutProjectRef.current = ''
    if (!project || (!rows.length && !deletes.length)) return
    // 失败不弹错：位置是低价值数据，下一次拖动会把新值再送一遍
    void patchProject(project, {
      ...(rows.length ? { canvas: rows } : {}),
      ...(deletes.length ? { canvasDelete: deletes } : {}),
    } as never).catch(() => {})
  }, [])

  /** 把坐标 / 删除并入待提交队列：400ms 内多次拖动只发一次请求 */
  const queueCanvasLayout = useCallback(
    (rows: CanvasSpot[] = [], deletes: string[] = [], project = projectName) => {
      if (!project) return
      if (layoutProjectRef.current && layoutProjectRef.current !== project) {
        // 已经排了别的项目的写回：先把它送出去，别把 A 的位置写进 B
        flushCanvasLayout()
      }
      layoutProjectRef.current = project
      for (const row of rows) {
        layoutDeleteRef.current.delete(row.key)
        layoutPendingRef.current.set(row.key, row)
      }
      for (const key of deletes) {
        layoutPendingRef.current.delete(key)
        layoutDeleteRef.current.add(key)
      }
      if (layoutTimerRef.current !== null) window.clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = window.setTimeout(() => flushCanvasLayout(), 400)
    },
    [flushCanvasLayout, projectName],
  )

  // 卸载（含切项目）前把还没送出的位置写回去
  useEffect(() => () => flushCanvasLayout(), [flushCanvasLayout])

  /**
   * 项目列表只在大厅首屏与生命周期操作后拉取；打开项目时不再重复拉列表。
   * loaded 标记让大厅区分「加载中」与「真的一个项目都没有」。
   */
  const reloadProjects = useCallback(async () => {
    try {
      const { projects: ps } = await listProjects()
      setProjects(ps)
      setProjectsLoaded(true)
      return ps
    } catch {
      setProjects([])
      setProjectsLoaded(true)
      return [] as ProjectSummary[]
    }
  }, [])

  useEffect(() => {
    void reloadProjects()
  }, [reloadProjects])

  // hash 是唯一路由来源：冷启动、刷新、返回/前进、手输链接都走同一条解析。
  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash))
    const initial = window.location.hash
    // 地址栏规范：空 hash / 单独的 # 视为大厅，补成 #/；未知视图保留原 hash（回落概览）
    if (!initial || initial === '#' || !initial.startsWith('#/')) {
      window.history.replaceState(null, '', hubHash())
    }
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener(ROUTE_EVENT, sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener(ROUTE_EVENT, sync)
    }
  }, [])

  // 上次视图按项目记：刷新、从大厅重开都回到离开时的视图
  useEffect(() => {
    if (route.kind === 'project') writeLastView(route.project, route.view)
  }, [route])

  /** 切项目：剧本有未保存分集时先确认；切换期间禁止写回旧数据 */
  const changeProject = useCallback(
    (next: string) => {
      if (next === projectName) return
      setReadyProject('')
      navigate(projectHash(next, readLastView(next)))
    },
    [projectName],
  )

  /** 打开项目：有上次视图就恢复，没有落概览 */
  const openProject = useCallback((name: string, target?: ViewId) => {
    navigate(projectHash(name, target ?? readLastView(name)))
  }, [])

  /**
   * 项目删除后的上下文回退。顺序不能改：
   * 先把 readyProject 脱钩，画布防抖才不会再往被删项目写一次；
   * 再清浏览器画布状态与上次视图，最后才重载列表。
   * 删除的是当前项目时用 replace 回大厅，避免返回键再跳进已删项目。
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
        clearLastView(name)
      }
      await reloadProjects()
      if (gone.has(projectName)) {
        setEpNo(1)
        setNodes([])
        setEdges([])
        setProjectShots([])
        setEpisodes([])
        setCharacters([])
        setAssets([])
        setDesignSheetCount(0)
        setSelId(null)
        setSelEdgeId(null)
        setMissingMedia(new Set())
        replaceWithHub()
      }
      setEpVersion((v) => v + 1)
      setToast(names.length === 1 ? `已删除项目 ${names[0]}` : `已删除 ${names.length} 个项目`)
      window.setTimeout(() => setToast(''), 3000)
    },
    [projectName, reloadProjects],
  )

  /** 新建项目：刷新列表后直接进新项目概览，而不是像旧版那样切「当前项目」 */
  const applyProjectCreated = useCallback(
    async (name: string) => {
      await reloadProjects()
      setReadyProject('')
      navigate(projectHash(name, 'overview'))
      setToast(`已新建项目 ${name}`)
      window.setTimeout(() => setToast(''), 2800)
    },
    [reloadProjects],
  )

  const changeView = useCallback(
    (
      next: ViewId,
      opts?: { settingsSection?: SettingsInitialSection; boardPhase?: 'episodes' | 'canvas' },
    ) => {
      if (next === view && !opts?.settingsSection) {
        if (next === 'board') setBoardPhase('episodes')
        return
      }
      if (next === 'settings') {
        setSettingsInitialSection(opts?.settingsSection)
      } else {
        setSettingsInitialSection(undefined)
      }
      if (next === 'board') {
        setBoardPhase(opts?.boardPhase ?? 'episodes')
      }
      if (route.kind !== 'project') return
      navigate(projectHash(route.project, next))
    },
    [view, route],
  )

  /**
   * 唯一的「项目镜头 → 画布」水合入口：加载、导入、Agent 写回、增删镜都调它。
   * - 按 shotId 复用节点与位置，素材卡与其他卡原样保留；
   * - 保留仍然有效的连线，补齐顺序链，再按 transitionOut 修回转场；
   * - 水合后重置 syncedRef，避免防抖写回把旧值或已删镜头写回去。
   */
  const hydrateCanvasShots = useCallback(
    (shots: ProjectShot[], opts: { episode?: number; fit?: boolean } = {}) => {
      const prevNodes = nodesRef.current
      const nextNodes = composeShotCanvasNodes(prevNodes, shots)
      const shotNodes = nextNodes.filter(isShotCanvasNode)
      const nextEdges = composeShotCanvasEdges(edgesRef.current, shotNodes)
      nodesRef.current = nextNodes
      edgesRef.current = nextEdges
      setNodes(nextNodes)
      setEdges(nextEdges)
      syncedRef.current = new Map()
      // 水合后重置布局快照：这些位置来自项目/栅格，不该被当成用户改动写回去
      layoutSnapRef.current = layoutSnapshot(nextNodes)
      for (const n of shotNodes) {
        if (n.data.shotId) syncedRef.current.set(String(n.data.shotId), bizSignature(n.data))
      }
      if (!opts.fit) return
      const ep = opts.episode ?? epNo
      const targets = shotNodes
        .filter((n) => (Number(n.data.episode) || 1) === ep)
        .map((n) => ({ id: n.id }))
      if (!targets.length) return
      window.setTimeout(() => fitView({ nodes: targets, padding: 0.25, duration: 450 }), 80)
    },
    [epNo, fitView, setEdges, setNodes],
  )

  /** 进入单集画布：目录点卡或概览点集 */
  const enterBoardEpisode = useCallback(
    (no: number) => {
      setEpNo(no)
      setBoardPhase('canvas')
      hydrateCanvasShots(projectShots, { episode: no, fit: true })
    },
    [hydrateCanvasShots, projectShots],
  )

  // 打开「新增分集」输入弹窗。
  // 这里不能再用 window.prompt：Electron 桌面端未实现 prompt()，调用会直接抛
  // 「prompt() is not supported」，点击后表现为完全没有反应。
  const handleAddEpisode = useCallback(() => {
    if (!readyProject) return
    setAddEpisodePromptOpen(true)
  }, [readyProject])

  const submitAddEpisode = useCallback(
    async (title: string) => {
      setAddEpisodePromptOpen(false)
      if (!readyProject) return
      setAddEpisodeBusy(true)
      try {
        const no = nextEpisodeNo(episodes, projectShots)
        const next = [...episodes, blankEpisode(no, title.trim() || undefined)].sort((a, b) => a.no - b.no)
        await patchProject(readyProject, { episodes: next })
        setEpisodes(next)
        setEpVersion((v) => v + 1)
        setToast(`已添加 ${formatEpisodeLabel(no)}`)
        window.setTimeout(() => setToast(''), 2800)
      } catch (e) {
        setToast((e as Error).message || '添加分集失败')
        window.setTimeout(() => setToast(''), 3600)
      } finally {
        setAddEpisodeBusy(false)
      }
    },
    [readyProject, episodes, projectShots],
  )

  const handleApplyScriptEpisodes = useCallback(
    async (nextEps: ProjectEpisode[], summary: string) => {
      if (!readyProject) throw new Error('项目未就绪')
      await patchProject(readyProject, { episodes: nextEps })
      setEpisodes(nextEps)
      setEpVersion((v) => v + 1)
      setToast(summary)
      window.setTimeout(() => setToast(''), 3200)
    },
    [readyProject],
  )

  const requestDeleteEpisodeScript = useCallback(
    (no: number) => {
      if (!readyProject) {
        setToast('先在顶栏选择项目')
        window.setTimeout(() => setToast(''), 2400)
        return
      }
      if (!episodeHasScript(episodes, no)) {
        setToast(`${formatEpisodeLabel(no)} 没有分集剧本可删`)
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      setDeleteEpisodeScriptEpNo(no)
    },
    [readyProject, episodes],
  )

  const confirmDeleteEpisodeScript = useCallback(async () => {
    const no = deleteEpisodeScriptEpNo
    setDeleteEpisodeScriptEpNo(null)
    if (!readyProject || no == null) return
    const plan = planDeleteEpisodeScript(episodes, no)
    if (!plan.removed) return
    const shotCount = projectShots.filter((s) => (Number(s.episode) || 1) === no).length
    try {
      await patchProject(readyProject, { episodes: plan.episodes })
      setEpisodes(plan.episodes)
      setEpVersion((v) => v + 1)
      const tail = shotCount > 0 ? `，${shotCount} 镜分镜仍保留` : ''
      setToast(`已删除 ${formatEpisodeLabel(no)} 的分集剧本${tail}`)
      window.setTimeout(() => setToast(''), 3600)
    } catch (e) {
      setToast((e as Error).message || '删除分集剧本失败')
      window.setTimeout(() => setToast(''), 3600)
    }
  }, [deleteEpisodeScriptEpNo, readyProject, episodes, projectShots])

  const openScriptImport = useCallback(() => {
    setScriptHintEpNo(nextEpisodeNo(episodes, projectShots))
    setScriptImportOpen(true)
  }, [episodes, projectShots])

  /** 重读项目：Agent 写回后用它把新增/改动的镜头水合到画布 */
  const refreshProjectSnapshot = useCallback(
    async (opts: { fit?: boolean } = {}) => {
      if (!readyProject) return
      const p = await getProject(readyProject)
      projectSnapRef.current = p
      const shots = (p.shots ?? []) as ProjectShot[]
      setProjectShots(shots)
      setEpisodes(((p.episodes ?? []) as ProjectEpisode[]) ?? [])
      hydrateCanvasShots(shots, { episode: epNo, fit: opts.fit })
      setEpVersion((v) => v + 1)
    },
    [readyProject, epNo, hydrateCanvasShots],
  )

  /**
   * 画布导入确认：先校验镜号唯一，再落库，成功后才更新快照与水合。
   * 失败直接抛给对话框：画布与项目都不动，用户可改文件重试。
   */
  const applyShotImport = useCallback(
    async (result: {
      shots?: ProjectShot[]
      episodes?: ProjectEpisode[]
      summary: string
    }) => {
      if (!readyProject) throw new Error('项目尚未加载完成')
      let saved = projectShots
      if (result.shots) {
        const plan = planShotImport(projectShots, result.shots)
        if (plan.error) throw new Error(plan.error)
        const repaired = reconcileProjectShots(plan.shots)
        if (repaired.changed > 0) {
          setToast(`已修正 ${repaired.changed} 条镜头 id 与集号不一致`)
          window.setTimeout(() => setToast(''), 3200)
        }
        const mergeDeletes = [...new Set([...plan.deletes, ...repaired.idMap.keys()])]
        // 局部写回（不标孤儿）：导入结果只是「文件覆盖到的集」，其他集必须原样保留
        const r = await mergeProjectShots(readyProject, repaired.shots, { deleteShotIds: mergeDeletes })
        saved = r.shots
        setProjectShots(saved)
      }
      if (result.episodes) setEpisodes(result.episodes)
      setEpVersion((v) => v + 1)
      hydrateCanvasShots(saved, { episode: epNo, fit: true })
      setToast(result.summary)
      window.setTimeout(() => setToast(''), 3200)
    },
    [readyProject, projectShots, epNo, hydrateCanvasShots],
  )

  /**
   * 正式镜头写回：唯一的「镜头增删改 → project.json → 画布」通道。
   * 写入前做集内镜号唯一校验，成功后整批水合；失败不动快照与节点。
   */
  const persistProjectShots = useCallback(
    async (
      next: ProjectShot[],
      deletes: string[] = [],
      opts: { fit?: boolean } = {},
    ): Promise<ProjectShot[]> => {
      if (!readyProject) throw new Error('项目尚未加载完成')
      const repaired = reconcileProjectShots(next)
      if (repaired.changed > 0) {
        setToast(`已修正 ${repaired.changed} 条镜头 id 与集号不一致`)
        window.setTimeout(() => setToast(''), 3200)
      }
      const invalid = validateShotNos(repaired.shots)
      if (invalid) throw new Error(invalid)
      const mergeDeletes = [...new Set([...deletes, ...repaired.idMap.keys()])]
      // 整表写回：next 是重新规划后的全集，缺席即删除意图，服务端按 full 标孤儿做保护
      const r = await mergeProjectShots(readyProject, repaired.shots, { deleteShotIds: mergeDeletes, mode: 'full' })
      setProjectShots(r.shots)
      hydrateCanvasShots(r.shots, { episode: epNo, fit: opts.fit })
      setEpVersion((v) => v + 1)
      return r.shots
    },
    [readyProject, epNo, hydrateCanvasShots],
  )

  /**
   * 改镜号 = 新镜 + 删旧镜：id 由集号+镜号生成，原地改号会留下指向旧 id 的边与引用。
   * 冲突时只提示，不写入；成功后顺序边由水合重建。
   */
  const renameShotNo = useCallback(
    async (node: ShotNodeType, rawNo: string) => {
      const no = String(rawNo ?? '').trim()
      const oldId = node.data.shotId ? String(node.data.shotId) : ''
      const ep = Number(node.data.episode) || epNo
      if (!no || no === node.data.no) return
      if (!readyProject || !oldId) {
        // 无业务 ID 的实验卡仍按本地字段处理
        setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, no } } : n)))
        return
      }
      const dup = projectShots.some(
        (s) => (Number(s.episode) || 1) === ep && String(s.no ?? '').trim() === no && s.id !== oldId,
      )
      if (dup) {
        setToast(`E${String(ep).padStart(2, '0')} 已有镜号「${no}」，未修改`)
        window.setTimeout(() => setToast(''), 2600)
        return
      }
      const src = projectShots.find((s) => s.id === oldId)
      if (!src) return
      const plan = planRenameShotNo(projectShots, oldId, no)
      if (!plan.ok) {
        if (plan.error) {
          setToast(plan.error)
          window.setTimeout(() => setToast(''), 2600)
        }
        return
      }
      try {
        await persistProjectShots(plan.next, plan.deletes)
        const fresh = nodesRef.current.find((n) => n.data.shotId === plan.newId)
        if (fresh) setSelId(fresh.id)
        setToast(`镜号已改为 ${no}`)
        window.setTimeout(() => setToast(''), 2000)
      } catch (e) {
        setToast((e as Error).message || '改镜号失败')
        window.setTimeout(() => setToast(''), 3000)
      }
    },
    [readyProject, projectShots, epNo, persistProjectShots, setNodes],
  )
  renameShotNoRef.current = (node, no) => void renameShotNo(node, no)

  /** 项目切换事务：加载项目数据 + 项目级画布；旧响应按 epoch 丢弃 */
  useEffect(() => {
    const epoch = ++projectEpochRef.current
    let alive = true
    setReadyProject('')
    setBoardPhase('episodes')
    setSelId(null)
    setSelEdgeId(null)
    setProjectAspect('16:9')
    if (!projectName) {
      projectSnapRef.current = null
      setNodes(initialNodes)
      setEdges(initialEdges)
      setCharacters(defaultCharacters)
      setAssets([])
      setDesignSheetCount(0)
      setProjectShots([])
      setEpisodes([])
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
        // 迁移与补 canvasId 都会改写项目数据，所以这里用可重新赋值的局部变量承接
        let p = await getProject(projectName)
        if (!alive || epoch !== projectEpochRef.current) return
        projectSnapRef.current = p
        let shots = (p.shots ?? []) as ProjectShot[]
        const repairedOnLoad = reconcileProjectShots(shots)
        if (repairedOnLoad.changed > 0) {
          try {
            // 整表写回：进画布前的一次性对齐，提交的是项目全集，按 full 保留缺席镜
            const r = await mergeProjectShots(projectName, repairedOnLoad.shots, {
              deleteShotIds: [...repairedOnLoad.idMap.keys()],
              mode: 'full',
            })
            shots = r.shots
            setToast(`已修正 ${repairedOnLoad.changed} 条镜头 id 与集号不一致`)
            window.setTimeout(() => setToast(''), 3600)
          } catch {
            shots = repairedOnLoad.shots
          }
        }
        // 存量 v1 本地画布 → 项目库的一次性迁移（只在项目还没有布局行时跑）。
        // 必须排在读素材卡之前：它会把旧节点 uid 写回 assets.canvas_id，位置写进 canvas。
        const legacy = await migrateLegacyCanvasIfNeeded(projectName, p)
        if (!alive || epoch !== projectEpochRef.current) return
        if (legacy) {
          p = { ...p, assets: legacy.assets, canvas: legacy.canvas }
          console.info('[canvas] 旧画布迁移报告', {
            命中素材卡: legacy.matchedCards,
            未匹配素材卡: legacy.unmatchedCards,
            遗留节点: legacy.droppedNodes,
          })
          const unmatched = legacy.unmatchedCards.length
            ? `，${legacy.unmatchedCards.length} 张卡在素材库里找不到对应项（${legacy.unmatchedCards.slice(0, 2).join('、')}${legacy.unmatchedCards.length > 2 ? '…' : ''}）`
            : ''
          const dropped = legacy.droppedNodes.length ? `，忽略 ${legacy.droppedNodes.length} 个无业务 id 的遗留节点` : ''
          setToast(`已把旧画布的 ${legacy.matchedCards} 张素材卡位置并入项目${unmatched}${dropped}`)
          window.setTimeout(() => setToast(''), 5200)
        }
        const stored = loadProjectSaved(projectName, shots)
        // 素材卡由 `project.assets` + `canvasId` 构建：节点 id 稳定为 `asset-<canvasId>`，
        // 与 shot.refIds 里的 token 同源，重启/换端口/换机器都不会断链。
        const projectAssets = await ensureAssetCanvasIds(projectName, (p.assets ?? []) as ProjectAsset[])
        if (!alive || epoch !== projectEpochRef.current) return
        p = { ...p, assets: projectAssets }
        const assetCards = assetNodesFromAssets(projectAssets)
        const sheets = readCharacters(p.characters)
        const epSet = new Set<number>()
        for (const e of p.episodes ?? []) epSet.add(Number(e.no) || 1)
        for (const s of shots) epSet.add(Number(s.episode) || 1)
        const maxEp = Math.max(1, ...epSet)
        const wantedEp = Number(stored?.epNo) || 1

        // 与导入/Agent 写回共用同一条水合路径：项目是唯一真源，画布只是它的投影
        // 清空已经是真删：画布只反映项目里现存镜头，不再有「存档说清空过」这层状态
        // 位置最后用项目里的布局行覆盖：缺行的节点保留落位规则算出的栅格位置
        const loadedNodes = applyLayout(composeShotCanvasNodes(assetCards, shots), p.canvas)
        const shotNodes = loadedNodes.filter(isShotCanvasNode)
        setNodes(loadedNodes)
        setEdges(composeShotCanvasEdges(stored?.edges?.length ? stored.edges : [], shotNodes))
        setCharacters(sheets)
        setAssets(projectAssets)
        setDesignSheetCount((p.designs ?? []).length)
        setProjectAspect(p.aspect || '16:9')
        setProjectStyle(String(p.style || ''))
        setProjectShots(shots)
        setEpisodes(((p.episodes ?? []) as ProjectEpisode[]) ?? [])
        const focusEp = Math.min(Math.max(1, wantedEp), maxEp)
        setEpNo(focusEp)
        syncedRef.current = new Map()
        for (const n of shotNodes) {
          if (n.data.shotId) syncedRef.current.set(String(n.data.shotId), bizSignature(n.data))
        }
        // 切项目后视口要跟到新项目：只渲染可视元素时，沿用上一个项目的缩放会把镜头挡在画外
        const focusTargets = shotNodes
          .filter((n) => (Number(n.data.episode) || 1) === focusEp)
          .map((n) => ({ id: n.id }))
        if (focusTargets.length) {
          window.setTimeout(() => fitView({ nodes: focusTargets, padding: 0.25, minZoom: 0.4, duration: 400 }), 80)
        }
        charSnapRef.current = JSON.stringify(sheets.map(toProject))
        // 载荷用节点反推：含 canvasId，且与 assets 同步通道的签名算法一致，避免刚载入就触发一次写回
        assetsSnapRef.current = JSON.stringify(assetsPayloadOf(assetCards))
        // 布局快照：水合/载入后重置，此刻不发起任何位置写回
        layoutSnapRef.current = layoutSnapshot(loadedNodes)
        // 迁移与补 id 改写过项目数据，快照要跟上（后面「素材页发布新卡」会读它的 canvas）
        projectSnapRef.current = p
        setMissingMedia(new Set(Array.isArray(p.media?.missing) ? p.media.missing : []))
        if (p.media?.migrated) {
          setToast(`已把 ${p.media.migrated} 张参考图收进项目目录`)
          window.setTimeout(() => setToast(''), 3600)
        }
        setReadyProject(projectName)
      } catch (e) {
        if (!alive || epoch !== projectEpochRef.current) return
        projectSnapRef.current = null
        setNodes([])
        setEdges([])
        setCharacters([])
        setAssets([])
        setDesignSheetCount(0)
        setProjectAspect('16:9')
        setProjectStyle('')
        setProjectShots([])
        setEpisodes([])
        setMissingMedia(new Set())
        // 深链指向不存在的项目：回大厅并把地址规范成 #/，别停在半截工作区
        if (String((e as Error)?.message || '').includes('项目不存在')) {
          replaceWithHub()
          return
        }
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

  useEffect(() => {
    checkHealth().then((h) => {
      setHasKey(h ? h.hasKey : null)
      setAssReady(Boolean((h as any)?.ffmpegAss))
    })
  }, [])

  const patch = useCallback(
    (id: string, p: Partial<ShotData>) => {
      // 改镜号要动 shotId：走高层的「新镜 + 删旧镜」，不能只改本地字段
      if (p.no !== undefined) {
        const node = nodesRef.current.find((n) => n.id === id)
        if (node && node.data.shotId && String(node.data.no ?? '') !== String(p.no)) {
          renameShotNoRef.current(node, String(p.no))
          return
        }
      }
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)))
    },
    [setNodes],
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

  /** 转场专属参考：写入 generated.refIds，不污染镜头 refIds */
  const toggleTransitionRef = useCallback(
    (edgeId: string, refSourceId: string) => {
      if (!isTransitionDedicatedRefToken(refSourceId)) return
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, to } = pair
      writeTransition(source.id, to, (cur) => {
        const g = normalizeGenerated(cur.generated)
        const curIds = g.refIds ?? []
        const nextIds = curIds.includes(refSourceId)
          ? curIds.filter((x) => x !== refSourceId)
          : [...curIds, refSourceId]
        return {
          ...cur,
          mode: 'generated',
          generated: {
            ...g,
            refIds: nextIds,
            bridging: g.bridging ?? 'morph',
          },
        }
      })
    },
    [transitionPair, writeTransition],
  )

  const removeTransitionRef = useCallback(
    (edgeId: string, refSourceId: string) => {
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, to } = pair
      writeTransition(source.id, to, (cur) => {
        const g = normalizeGenerated(cur.generated)
        const nextIds = (g.refIds ?? []).filter((x) => x !== refSourceId)
        if (nextIds.length === (g.refIds ?? []).length) return cur
        return { ...cur, generated: { ...g, refIds: nextIds } }
      })
    },
    [transitionPair, writeTransition],
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
  /** 从全部镜头 refIds 移除引用（画布内存 + 项目 shots 落库） */
  const purgeRefIds = useCallback(
    async (tokens: string[]) => {
      const drop = new Set(tokens.filter(Boolean))
      if (!drop.size) return
      setNodes((ns) =>
        ns.map((n) => {
          const cur = (n.data as unknown as { refIds?: string[] }).refIds
          if (!cur?.some((x) => drop.has(x))) return n
          return {
            ...n,
            data: { ...n.data, refIds: cur.filter((x) => !drop.has(x)) },
          } as typeof n
        }),
      )
      setSelRef(null)
      try {
        const p = await getProject(projectName)
        const changed = (p.shots ?? [])
          .filter((s) => (s.refIds ?? []).some((x) => drop.has(x)))
          .map((s) => ({
            ...s,
            refIds: (s.refIds ?? []).filter((x) => !drop.has(x)),
          }))
        // 局部写回（不标孤儿）：只发受影响的镜
        if (changed.length) await mergeProjectShots(projectName, changed)
      } catch {
        /* 落库失败不阻塞删卡；下次打开仍可从 refIds 看到旧值 */
      }
    },
    [projectName],
  )

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
        // 局部写回（不标孤儿）：只发受影响的镜
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
      label: entry.label,
      model: entry.model,
      providerKind: provider?.kind,
      audioOut: entry.features?.audioOut,
      supportsVideoRef: entry.supportsVideoRef,
      features: entry.features,
    }
  }, [modelPick.video, appSettings])

  /** 无防抖：落库后立即推实况，避免旧 revision 盖住新 DB */
  const pushStudioCanvasNow = useCallback(() => {
    if (!projectName || readyProject !== projectName) {
      void postStudioCanvasContext({
        name: '',
        episode: epNo,
        nodes: [],
        characters: [],
        missingMedia: [],
        videoModel: null,
        resolution: '',
        projectRevision: 0,
      })
      return
    }
    void postStudioCanvasContext({
      name: projectName,
      episode: epNo,
      nodes,
      characters,
      missingMedia: [...missingMedia],
      videoModel: selectedVideoModel,
      resolution: vidRes,
      projectRevision: Number(projectSnapRef.current?.revision) || 0,
    })
  }, [
    projectName,
    readyProject,
    epNo,
    nodes,
    characters,
    missingMedia,
    selectedVideoModel,
    vidRes,
  ])

  useStudioProjectSync({
    projectName: readyProject,
    studioMounted: studioMounted && studioEnabled,
    studioVisible: studioMount.visible,
    getLocalRevision: () => Number(projectSnapRef.current?.revision) || 0,
    onRefresh: () => refreshProjectSnapshot(),
    onPushCanvas: pushStudioCanvasNow,
  })

  /** 画布实况推给创意宿主：读工具与出片拼装对齐当前节点与模型（防抖） */
  useEffect(() => {
    if (!projectName || readyProject !== projectName) {
      void postStudioCanvasContext({
        name: '',
        episode: epNo,
        nodes: [],
        characters: [],
        missingMedia: [],
        videoModel: null,
        resolution: '',
        projectRevision: 0,
      })
      return
    }
    const timer = window.setTimeout(() => {
      void postStudioCanvasContext({
        name: projectName,
        episode: epNo,
        nodes,
        characters,
        missingMedia: [...missingMedia],
        videoModel: selectedVideoModel,
        resolution: vidRes,
        projectRevision: Number(projectSnapRef.current?.revision) || 0,
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [projectName, readyProject, epNo, nodes, characters, missingMedia, selectedVideoModel, vidRes])

  const bumpProjectRevision = useCallback((revision: number | undefined) => {
    if (typeof revision !== 'number' || !Number.isFinite(revision)) return
    if (projectSnapRef.current) projectSnapRef.current = { ...projectSnapRef.current, revision }
  }, [])

  const reloadSettings = useCallback(() => {
    getSettings()
      .then(async ({ settings }) => {
        setAppSettings(settings as AppSettings)
        await refreshPromptRenderTemplateVersion().catch(() => {})
      })
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

  /** Inspector 无角色映射时的音色列表：仅跟设置页默认配音模型 */
  const defaultAudioModelKey = appSettings?.defaults?.audio || ''
  useEffect(() => {
    let alive = true
    listVoicesCached(defaultAudioModelKey || undefined).then((v) => {
      if (!alive) return
      setVoices(v.voices)
      setVoiceProvider(v.provider)
    })
    return () => {
      alive = false
    }
  }, [defaultAudioModelKey])

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

  /** 单击连线 → 关系菜单；与节点右键菜单互斥 */
  const openEdgeMenu = useCallback((e: { clientX: number; clientY: number }, id: string) => {
    if (isDerivedEdgeId(id)) return
    setCtx(null)
    setEdgeCtx({ x: e.clientX, y: e.clientY, id })
  }, [])

  const onConnect = useCallback(
    (c: Connection) => {
      const src = nodesRef.current.find((n) => n.id === c.source) as unknown as AssetNodeType | undefined
      const srcType = (src as unknown as { type?: string } | undefined)?.type
      // 角色/素材 → 分镜：不进 edges 状态，写进目标镜头的 refIds（随镜头落库），边由 refEdges 派生
      if ((srcType === 'char' || srcType === 'asset') && c.target && c.source) {
        const activeEdge = selEdgeId ? edges.find((e) => e.id === selEdgeId) : null
        if (
          activeEdge &&
          (activeEdge.data?.relation ?? 'cut') === 'transition' &&
          (c.target === activeEdge.source || c.target === activeEdge.target)
        ) {
          const up = nodesRef.current.find((n) => n.id === activeEdge.source)
          const down = nodesRef.current.find((n) => n.id === activeEdge.target)
          if (up && down) {
            const to = down.data.shotId || down.id
            const t = normalizeTransitionOut(up.data.transitionOut, to)
            if (t.mode !== 'generated') {
              setToast('请先将转场设为「生成」再连参考')
              window.setTimeout(() => setToast(''), 2200)
              return
            }
            const g = normalizeGenerated(t.generated)
            const curIds = g.refIds ?? []
            if (!curIds.includes(c.source)) {
              toggleTransitionRef(activeEdge.id, c.source)
              setToast(`已连为转场参考（共 ${curIds.length + 1} 张）`)
              window.setTimeout(() => setToast(''), 1800)
            }
          }
          return
        }
        const tgt = nodesRef.current.find((n) => n.id === c.target)
        if (!tgt) return
        const tgtType = (tgt as unknown as { type?: string }).type
        if (tgtType !== 'shot') return
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
    [relation, setEdges, patch, selEdgeId, edges, toggleTransitionRef],
  )

  /** 单条连线的删除副作用：参考连线移出 refIds，转场连线清掉源镜头的 transitionOut */
  const applyEdgeRemoval = useCallback(
    (e: Edge) => {
      const tr = parseTransitionRefEdgeId(e.id)
      if (tr) {
        removeTransitionRef(tr.edgeId, tr.refSourceId)
        return
      }
      if (e.id.startsWith('ref-')) {
        const tgt = nodesRef.current.find((n) => n.id === e.target)
        if (!tgt) return
        const cur = (tgt.data as unknown as { refIds?: string[] }).refIds ?? []
        if (cur.includes(e.source)) patch(e.target, { refIds: cur.filter((x) => x !== e.source) } as never)
        return
      }
      const src = nodesRef.current.find((n) => n.id === e.source)
      const tgt = nodesRef.current.find((n) => n.id === e.target)
      if (!src || !tgt) return
      const to = tgt.data.shotId || tgt.id
      if (src.data.transitionOut?.to !== to) return
      patch(src.id, { transitionOut: undefined })
    },
    [patch, removeTransitionRef],
  )

  /** 删除参考连线 = 从目标镜头的 refIds 里移除；删除转场连线 = 清掉源镜头的 transitionOut */
  const onEdgesDeleted = useCallback(
    (eds: Edge[]) => {
      for (const e of eds) applyEdgeRemoval(e)
    },
    [applyEdgeRemoval],
  )

  /** 删除已生成关键帧/视频的转场连线要二次确认（菜单与 Delete 共用一份判定） */
  const needsEdgeDeleteConfirm = useCallback((e: Edge) => {
    if (e.id.startsWith('ref-') || parseTransitionRefEdgeId(e.id)) return false
    if ((e.data?.relation ?? 'cut') !== 'transition') return false
    const src = nodesRef.current.find((n) => n.id === e.source)
    const tgt = nodesRef.current.find((n) => n.id === e.target)
    if (!src || !tgt) return false
    const to = tgt.data.shotId || tgt.id
    const cur = src.data.transitionOut
    return Boolean(
      cur && cur.to === to && (cur.generated?.video?.url || cur.generated?.keyframe?.candidates?.length),
    )
  }, [])

  /** 菜单「删除连线」：先按需确认，再移边并清掉对应的持久化字段 */
  const deleteEdgeFromMenu = useCallback(
    (id: string) => {
      const e = edges.find((x) => x.id === id)
      if (!e) return
      if (needsEdgeDeleteConfirm(e) && !window.confirm('删除这条转场连线会同时清除已生成的关键帧/视频配置。继续？')) {
        return
      }
      setEdges((eds) => eds.filter((x) => x.id !== id))
      applyEdgeRemoval(e)
      setSelEdgeId((curId) => (curId === id ? null : curId))
      setEdgeCtx(null)
    },
    [edges, setEdges, applyEdgeRemoval, needsEdgeDeleteConfirm],
  )
  /** 新增镜头：生成正式 `E{集}-{镜号}` 镜头并落库，再水合到画布 */
  const addShot = async (prodKind: ShotProdKind) => {
    if (!readyProject) {
      setToast('先选择项目再新增镜头')
      window.setTimeout(() => setToast(''), 2200)
      return
    }
    const { shot, next } = planAddShot(projectShots, epNo, prodKind)
    try {
      await persistProjectShots(next, [], { fit: true })
      const fresh = nodesRef.current.find((n) => n.data.shotId === shot.id)
      if (fresh) setSelId(fresh.id)
      setToast(`已新增${prodKind === 'video' ? '出片' : '生图'}镜 E${String(epNo).padStart(2, '0')}·${shot.no}`)
      window.setTimeout(() => setToast(''), 2200)
    } catch (e) {
      setToast((e as Error).message || '新增镜头失败')
      window.setTimeout(() => setToast(''), 3200)
    }
  }

  /** 在某镜之后插入：镜号避让已有值，成功后顺序边由水合重建 */
  const insertShotAfter = async (afterShotId: string) => {
    if (!readyProject) {
      setToast('先选择项目再插入镜头')
      window.setTimeout(() => setToast(''), 2200)
      return
    }
    const target = projectShots.find((s) => s.id === afterShotId)
    if (!target) return
    const plan = planInsertAfter(projectShots, afterShotId)
    if (!plan) return
    const { shot } = plan
    try {
      await persistProjectShots(plan.next, [], { fit: false })
      const fresh = nodesRef.current.find((n) => n.data.shotId === shot.id)
      if (fresh) setSelId(fresh.id)
      setToast(`已在 ${target.no} 之后插入 ${shot.no}`)
      window.setTimeout(() => setToast(''), 2400)
    } catch (e) {
      setToast((e as Error).message || '插入镜头失败')
      window.setTimeout(() => setToast(''), 3200)
    }
  }

  /**
   * 加一张素材卡（场景/道具/图/视频）。
   * 节点 id 由新生成的 canvasId 派生；位置由「新增即写位置」的副作用补写。
   */
  const addAsset = () => {
    const card = newAssetCard(nodesRef.current, { title: '新素材', kind: 'image', url: '' })
    setNodes((ns) => [...ns, card])
    setSelId(card.id)
  }

  const removeShot = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id)
    const isAsset = (node as unknown as { type?: string })?.type === 'asset'
    if (isAsset) {
      void purgeRefIds([id])
      setToast('已删除素材卡，相关镜头参考连线已解除')
      window.setTimeout(() => setToast(''), 2600)
      // 删卡要连布局行一起删，否则下次同名位置行会把它「复活」到旧坐标上
      const key = nodeKeyOf(node)
      if (key) {
        layoutSnapRef.current.delete(key)
        queueCanvasLayout([], [key])
      }
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
      setSelId(null)
      return
    }
    const shotId = node?.data.shotId ? String(node.data.shotId) : ''
    if (!shotId || !readyProject) {
      // 无业务 ID 的实验卡：只从画布移除
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
      setSelId(null)
      return
    }
    const label = node?.data.no || shotId
    if (!window.confirm(`删除 ${label}？项目里的该镜头与指向它的转场会一并移除。`)) return
    // 上一镜指向它的 transition_out 必须一起清掉，否则水合时会把边修回来
    const plan = planDeleteShot(projectShots, shotId)
    void persistProjectShots(plan.next, plan.deletes)
      .then(() => {
        setSelId(null)
        setToast(`已删除 ${label}`)
        window.setTimeout(() => setToast(''), 2200)
      })
      .catch((e: Error) => {
        setToast(e.message || '删除镜头失败')
        window.setTimeout(() => setToast(''), 3200)
      })
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
        charPos[c.id] ?? charSlotPosition(i),
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
          charPos[`miss:${name}`] ?? charSlotPosition(characters.length + i),
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

  /**
   * 画布素材卡 → 素材库（DB assets 表）：卡片只是视图，数据落库才能跨会话/跨集复用。
   * 载荷必须带 `canvasId`（由节点 id 反解），否则整表替换会把这张卡换成新身份。
   */
  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const cards = assetsPayloadOf(assetNodes)
    const sig = JSON.stringify(cards)
    if (sig === assetsSnapRef.current) return
    const t = window.setTimeout(() => {
      assetsSnapRef.current = sig
      setAssets(cards)
      patchProject(projectName, { assets: cards } as never).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [assetNodes, projectName])

  /**
   * 新增素材卡即写位置：任何创建入口（手动加卡 / 在线素材 / 设定发布 / 表情总图）
   * 都会产出快照里没有的 key，这里统一补一行，避免各入口各写一遍。
   * 只在「快照里没有」时触发，所以加载与拖动都不会被这里重复写回。
   */
  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const rows: CanvasSpot[] = []
    for (const n of assetNodes) {
      const key = nodeKeyOf(n)
      if (!key || layoutSnapRef.current.has(key)) continue
      layoutSnapRef.current.set(key, { ...n.position })
      rows.push({ key, x: n.position.x, y: n.position.y })
    }
    if (rows.length) queueCanvasLayout(rows)
  }, [assetNodes, projectName, readyProject, queueCanvasLayout])

  /**
   * 素材库里已经有卡、画布上却一张都没有时，把卡片补进画布。
   * 正常载入不会走到这里（载入阶段就由 `project.assets` 建好卡了）；
   * 留给「素材页在画布已打开时发布新卡」这条路径。
   */
  useEffect(() => {
    if (!projectName || readyProject !== projectName || assets.length === 0 || assetNodes.length > 0) return
    const cards = applyLayout(assetNodesFromAssets(assets), projectSnapRef.current?.canvas)
    if (!cards.length) return
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
  /** 菜单「转场设置…」：非转场先落到默认转场，再打开面板 */
  const openTransitionFromMenu = useCallback(
    (id: string) => {
      const e = edges.find((x) => x.id === id)
      setEdgeCtx(null)
      if (e && (e.data?.relation ?? 'cut') !== 'transition') setEdgeRelation(id, 'transition')
      openTransition(id)
    },
    [edges, setEdgeRelation, openTransition],
  )
  const focusShotFromTransition = useCallback((nodeId: string) => {
    saveInspectorPrefs({ ...loadInspectorPrefs(), tab: 'outgoing' })
    setSelEdgeId(null)
    setSelRef(null)
    setSelId(nodeId)
  }, [])
  const refEdges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    const inCanvas = new Set(canvasNodes.map((n) => n.id))
    const shotsById = new Map(shownNodes.map((n) => [n.id, n]))
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
    for (const e of edges) {
      if ((e.data?.relation ?? 'cut') !== 'transition') continue
      const src = shotsById.get(e.source)
      const tgt = shotsById.get(e.target)
      if (!src || !tgt) continue
      const to = tgt.data.shotId || tgt.id
      const t = normalizeTransitionOut(src.data.transitionOut, to)
      if (t.mode !== 'generated') continue
      const refIds = normalizeGenerated(t.generated).refIds ?? []
      for (const rid of refIds) {
        if (!isTransitionDedicatedRefToken(rid)) continue
        if (!inCanvas.has(rid)) continue
        const eid = transitionRefEdgeId(e.id, rid)
        const on = selRef === eid
        out.push({
          id: eid,
          source: rid,
          target: e.source,
          type: 'default',
          style: {
            stroke: 'var(--ref-edge)',
            strokeWidth: on ? 3 : 1.6,
            strokeDasharray: '4 3',
            filter: on ? 'drop-shadow(0 0 6px var(--ref-edge))' : undefined,
          },
          label: '转场参考',
          labelStyle: { fill: 'var(--ref-edge)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--ref-label-bg)' },
        } as unknown as Edge)
      }
    }
    return out
  }, [canvasNodes, shownNodes, selRef, edges])

  /** Delete/Backspace 删掉选中的参考连线（边是派生的，不走 React Flow 的选中删除） */
  useEffect(() => {
    if (!selRef) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const tr = parseTransitionRefEdgeId(selRef)
      if (tr) {
        ev.preventDefault()
        removeTransitionRef(tr.edgeId, tr.refSourceId)
        setSelRef(null)
        return
      }
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
  }, [selRef, patch, removeTransitionRef])

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
    if (selEdgeId && (type === 'char' || type === 'asset')) {
      const edge = edges.find((e) => e.id === selEdgeId)
      if (edge && (edge.data?.relation ?? 'cut') === 'transition') {
        const up = shownNodes.find((n) => n.id === edge.source)
        const down = shownNodes.find((n) => n.id === edge.target)
        if (up && down) {
          const to = down.data.shotId || down.id
          const t = normalizeTransitionOut(up.data.transitionOut, to)
          const refIds = normalizeGenerated(t.generated).refIds ?? []
          return {
            mode: 'transition-pick' as const,
            edgeId: selEdgeId,
            headTitle: `转场 ${up.data.no}→${down.data.no}`,
            headSub: '点选画布中的角色/素材卡，加入或移出本条转场出片',
            sectionTitle: '画布里的参考源',
            emptyText: '先添加素材卡或给角色出图',
            hint: '仅写入转场 generated.refIds，不改动镜头 refIds。也可拖线：先点选转场边，再从角色/素材连到上/下镜。',
            items: refCards.map((c) => ({ ...c, on: refIds.includes(c.id) })),
          }
        }
      }
    }
    if (type === 'shot') {
      const mine = d.refIds ?? []
      const shotNode = node as ShotNodeType
      const isVideoShot = effectiveProdKind(shotNode.data) === 'video'
      const neighborItems = isVideoShot
        ? neighborReferenceItems(shotNode, shownNodes as ShotNodeType[]).map((c) => ({
            ...c,
            on: mine.includes(c.id),
          }))
        : []
      return {
        mode: 'shot' as const,
        targetId: node.id,
        nodeType: 'shot' as const,
        headTitle: d.no ? `${d.no} 的参考` : '镜头参考',
        headSub: '点选画布中的卡片作为参考图',
        sectionTitle: '参考画布里的卡片',
        emptyText: '画布上还没有可用作参考的图：先加素材卡，或给角色生成图',
        hint: isVideoShot
          ? '上一镜/下一镜取邻镜静帧；多选可叠加，再点一次取消。出片仅认连线，不自动用本镜预览图。'
          : '生图镜仅用角色与素材参考，不含上一镜/下一镜。',
        items: [...neighborItems, ...refCards.map((c) => ({ ...c, on: mine.includes(c.id) }))],
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
      hint: '连线后，出片与出图（多参考）会使用该图；须先连线再出片。',
      items: shownNodes.map((n) => ({
        id: n.id,
        title: `${n.data.no}${n.data.size ? ' · ' + n.data.size : ''}`,
        tag: (n.data.prompt ?? '').slice(0, 14),
        img: n.data.refImage,
        on: (n.data.refIds ?? []).includes(node.id),
      })),
    }
  }, [ctx, canvasNodes, refCards, shownNodes, selEdgeId, edges])

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

  /** 右键「连线」：把该参考写入分镜 refIds（出片只认连线，不写 refImage） */
  const useAsFirstFrame = useCallback(
    (shotNodeId: string, sourceId: string) => {
      const t = nodesRef.current.find((n) => n.id === shotNodeId)
      if (!t) return
      const cur = (t.data as unknown as { refIds?: string[] }).refIds ?? []
      if (cur.includes(sourceId)) {
        setToast('该参考已连线')
        window.setTimeout(() => setToast(''), 2000)
        return
      }
      toggleRef(shotNodeId, sourceId)
      setToast('已加入视频出片参考连线')
      window.setTimeout(() => setToast(''), 2000)
    },
    [toggleRef],
  )

  /** 其他集各有多少张卡：当前集为空时用来提示「不是丢了，是切集了」 */
  /** 当前选中的卡片（⌘/Shift 点选 或 Shift 框选） */
  const selectedNodes = useMemo(() => shownNodes.filter((n) => n.selected), [shownNodes])
  const [selBusy, setSelBusy] = useState('')
  /** 运行中的出图请求：同一镜只允许一个在途请求 */
  const activeImgRef = useRef<Map<string, { token: number; controller: AbortController; taskId: string }>>(new Map())
  type TransitionVideoRun = {
    controller: AbortController
    taskId: string
    sourceId: string
    to: string
    edgeId: string
  }
  const activeTransitionVideoRef = useRef<Map<string, TransitionVideoRun>>(new Map())
  const transitionVideoRunKey = (sourceId: string, to: string) => `${sourceId}\0${to}`
  const registerTransitionVideoRun = (rec: TransitionVideoRun) => {
    const m = activeTransitionVideoRef.current
    m.set(rec.edgeId, rec)
    m.set(transitionVideoRunKey(rec.sourceId, rec.to), rec)
  }
  const unregisterTransitionVideoRun = (rec: TransitionVideoRun) => {
    const m = activeTransitionVideoRef.current
    m.delete(rec.edgeId)
    m.delete(transitionVideoRunKey(rec.sourceId, rec.to))
  }
  const lookupTransitionVideoRun = (edgeId: string, sourceId?: string, to?: string) => {
    const m = activeTransitionVideoRef.current
    return m.get(edgeId) ?? (sourceId && to ? m.get(transitionVideoRunKey(sourceId, to)) : undefined)
  }
  const imgTokenRef = useRef(0)
  const batchAbortRef = useRef<AbortController | null>(null)

  /** 对选中的卡片批量执行 */
  const runOnSelected = async () => {
    if (selBusy) return
    const list = nodesRef.current.filter(
      (n) => n.selected && isShotCanvasNode(n) && effectiveProdKind(n.data) === 'image',
    )
    if (list.length === 0) return
    const ac = new AbortController()
    batchAbortRef.current = ac
    setSelBusy(`出图 0/${list.length}`)
    let i = 0
    let cancelled = false
    try {
      for (const n of list) {
        if (ac.signal.aborted) {
          cancelled = true
          break
        }
        await generateOne(n.id, { signal: ac.signal })
        if (ac.signal.aborted) {
          cancelled = true
          break
        }
        i += 1
        setSelBusy(`出图 ${i}/${list.length}`)
      }
    } finally {
      batchAbortRef.current = null
      setSelBusy('')
    }
    setToast(cancelled ? '已取消批量出图' : `已对 ${list.length} 张执行出图`)
    window.setTimeout(() => setToast(''), 2400)
  }

  const cancelBatch = () => {
    if (!batchAbortRef.current) return
    batchAbortRef.current.abort()
    setToast('正在取消批量出图…')
  }

  const deleteSelected = () => {
    const sel = nodesRef.current.filter((n) => n.selected)
    if (sel.length === 0) return
    const ids = new Set(sel.map((n) => n.id))
    const shotIds = sel
      .map((n) => (n.data.shotId ? String(n.data.shotId) : ''))
      .filter(Boolean)
    // 素材卡的布局行要跟着删：留着会成为无主行，下次同 canvasId 复用时位置会被「复活」
    const assetKeys = sel.filter(isAssetCanvasNode).map((n) => nodeKeyOf(n)).filter(Boolean)
    const dropAssetLayout = () => {
      if (!assetKeys.length) return
      for (const key of assetKeys) layoutSnapRef.current.delete(key)
      queueCanvasLayout([], assetKeys)
    }
    if (shotIds.length > 0 && readyProject) {
      if (!window.confirm(`删除所选 ${sel.length} 张卡片？其中 ${shotIds.length} 镜会从项目里移除。`)) return
      const gone = new Set(shotIds)
      const plan = planDeleteShots(projectShots, shotIds)
      void persistProjectShots(plan.next, plan.deletes)
        .then(() => {
          // 素材卡 / 实验卡不在项目里，单独从画布移除
          dropAssetLayout()
          setNodes((ns) => ns.filter((n) => !ids.has(n.id) || Boolean(n.data.shotId)))
          setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
          setSelId(null)
          setToast(`已删除 ${sel.length} 张`)
          window.setTimeout(() => setToast(''), 2200)
        })
        .catch((e: Error) => {
          setToast(e.message || '删除镜头失败')
          window.setTimeout(() => setToast(''), 3200)
        })
      return
    }
    dropAssetLayout()
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)))
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
    setSelId(null)
    setToast(`已删除 ${ids.size} 张`)
    window.setTimeout(() => setToast(''), 2000)
  }

  /** 连续性诊断 */
  const [diagOn, setDiagOn] = useState(false)
  const issues = useMemo(() => (diagOn ? diagnose(shownNodes) : []), [diagOn, shownNodes])

  /**
   * 其他集的镜数：真相取 project.json 的镜头，不看画布节点。
   * 画布是投影，清空后节点全没了；用节点统计会让「其他集还有 …」一起消失。
   */
  const otherEpCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of projectShots) {
      const e = Number(s.episode) || 1
      m.set(e, (m.get(e) ?? 0) + 1)
    }
    return [...m.entries()].filter(([e]) => e !== epNo).sort((a, b) => a[0] - b[0])
  }, [projectShots, epNo])

  /** 当前集的项目镜头（真相在 project.json，不是画布节点） */
  const epProjectShots = useMemo(
    () => projectShots.filter((s) => (Number(s.episode) || 1) === epNo),
    [projectShots, epNo],
  )
  /** 当前集画布上的分镜卡片数：用来判断「项目里有、画布上没有」需要引导重建 */
  const epCanvasCards = useMemo(
    () => nodes.filter((n) => n.data.shotId && (Number(n.data.episode) || 1) === epNo).length,
    [nodes, epNo],
  )
  /**
   * 切集：只在该集画布上确实没有卡片时才水合。
   * 已有卡片的集不重建，避免覆盖用户手工调整过的位置。
   */
  const focusEpisode = useCallback(
    (no: number) => {
      setEpNo(no)
      const hasCards = nodesRef.current.some(
        (n) => n.data.shotId && (Number(n.data.episode) || 1) === no,
      )
      if (hasCards) return
      if (!projectShots.some((s) => (Number(s.episode) || 1) === no)) return
      hydrateCanvasShots(projectShots, { episode: no, fit: true })
    },
    [projectShots, hydrateCanvasShots],
  )
  const charsForAudit = characters
  /** 集摘要口径与画布一致：空首帧只用于提示，不拦水合 */
  const epPromptStat = useMemo(() => {
    const audits = epProjectShots.map((s) => auditKeyframePrompt(s, characters))
    return {
      empty: audits.filter((a) => a.empty).length,
      miss: audits.filter((a) => !a.empty && a.missing.length > 0).length,
    }
  }, [epProjectShots, characters])
  const epSeconds = useMemo(
    () => epProjectShots.reduce((a, s) => a + (Number(s.seconds) || 0), 0),
    [epProjectShots],
  )
  const epTargetSeconds = resolveEpisodeTarget(episodes, epNo)

  /** 目标时长：写回当前集元数据，其他集不动 */
  const changeEpisodeTarget = async (raw: number) => {
    if (!readyProject) return
    const next = setEpisodeTargetSeconds(episodes, epNo, raw)
    setEpisodes(next)
    try {
      await patchProject(readyProject, { episodes: next })
      setEpVersion((v) => v + 1)
    } catch (e) {
      setToast((e as Error).message || '目标时长保存失败')
      window.setTimeout(() => setToast(''), 3000)
    }
  }

  /** 补齐锚点：只作用于当前集，把无法展开的角色占位换成外观锚点并标记人改 */
  const fixEpisodeAnchors = async () => {
    if (!readyProject) {
      setToast('先选择项目')
      window.setTimeout(() => setToast(''), 2200)
      return
    }
    const plan = planFixAnchors(projectShots, epNo, characters)
    if (plan.fixed === 0) {
      setToast(epPromptStat.miss > 0 ? '缺失角色没有可用的外观锚点' : '当前集没有需要补的锚点')
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    try {
      await persistProjectShots(plan.shots)
      setToast(`已为 ${plan.fixed} 镜补齐角色锚点`)
      window.setTimeout(() => setToast(''), 2600)
    } catch (e) {
      setToast((e as Error).message || '补齐锚点失败')
      window.setTimeout(() => setToast(''), 3200)
    }
  }

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
        // 分镜边不可选：单击只弹关系菜单，不产生选中态；高亮只跟随「正在编辑的转场边」
        const relation: Relation = e.data?.relation ?? 'cut'
        const src = shotsById.get(e.source)
        const tgt = shotsById.get(e.target)
        const sequenceSolid = Boolean(
          src &&
            tgt &&
            effectiveProdKind(src.data) === 'video' &&
            effectiveProdKind(tgt.data) === 'video',
        )
        const base = {
          ...e,
          selectable: false,
          className: `edge-rel-${relation}`,
          data: { ...e.data, active: e.id === selEdgeId, sequenceSolid },
        }
        if (relation !== 'transition') return base as Edge
        if (!src || !tgt) return base as Edge
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
        // 状态只用线条样式表达：类名既给 CSS 着色，也给回归脚本作稳定钩子
        return {
          ...base,
          className: `edge-rel-${relation} edge-state-${state}`,
          data: { ...base.data, state },
        } as Edge
      })
    return [...decorated, ...castEdges, ...refEdges]
  }, [edges, canvasNodes, castEdges, refEdges, episodeShots, inactiveEdgeIds, selEdgeId])

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
        // 逐个落位：新卡要看到前面几张刚算出的位置，否则批量发布会互相压住
        for (const design of fresh) {
          out.push(
            newAssetCard(out, {
              title: design.name,
              kind: design.kind,
              url: design.image,
              designId: design.id,
            }),
          )
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

  /**
   * 素材卡写回后同步画布：先按 `canvasId`（真实身份）对齐，其次才按「标题 + 类型」；
   * 全新卡片沿用载荷里的 `canvasId`，绝不另生成一个。
   *
   * 为什么身份优先：节点 id 是 `shot.refIds` 里 `asset-<canvasId>` 的锚点。
   * 只按标题匹配时，同一张卡在素材页改个名字就会被当成新卡、换一个 uid，
   * 之前连到分镜的参考连线会当场消失；带 `canvasId` 的卡若在画布上不存在，
   * 也必须用这个 id 建节点，否则 agent 刚写下的 refIds 同样接不上。
   */
  const syncAssetCards = useCallback(
    (next: ProjectAsset[]) => {
      if (!next.length) return
      const keyOf = (title: string, kind: string) => `${kind}::${title}`
      setNodes((prev) => {
        const out = [...prev]
        const byTitle = new Map<string, number>()
        const byCanvasId = new Map<string, number>()
        out.forEach((n, i) => {
          if ((n as unknown as AssetNodeType).type !== 'asset') return
          const d = n.data as unknown as { title?: string; kind?: string }
          if (d.title) byTitle.set(keyOf(d.title, String(d.kind ?? 'image')), i)
          const cid = canvasIdFromNodeId(n.id)
          if (cid) byCanvasId.set(cid, i)
        })
        for (const asset of next) {
          const kind = String(asset.kind ?? 'image')
          const canvasId = String(asset.canvasId ?? '').trim()
          const at = (canvasId ? byCanvasId.get(canvasId) : undefined) ?? byTitle.get(keyOf(asset.title, kind))
          const fields = {
            title: asset.title,
            kind,
            url: asset.url,
            ...(asset.designId ? { designId: asset.designId } : {}),
            ...(asset.characterName ? { characterName: asset.characterName } : {}),
          }
          if (at !== undefined) {
            const node = out[at]
            // 只用载荷覆盖内容，节点 id 不动：改 id 等于把画布上的连线全部拆掉
            out[at] = { ...node, data: { ...node.data, ...fields } } as unknown as ShotNodeType
            if (canvasId && !byCanvasId.has(canvasId)) byCanvasId.set(canvasId, at)
            byTitle.set(keyOf(asset.title, kind), at)
            continue
          }
          if (canvasId) {
            // 新卡但身份已存在：用载荷的 canvasId 建节点，refIds 才不会指向空节点
            out.push({
              id: assetNodeId(canvasId),
              type: 'asset',
              position: placeNewNode('asset', assetRectsOf(out)),
              data: fields,
            } as unknown as ShotNodeType)
            byCanvasId.set(canvasId, out.length - 1)
          } else {
            out.push(newAssetCard(out, fields))
          }
          byTitle.set(keyOf(asset.title, kind), out.length - 1)
        }
        return out
      })
    },
    [setNodes],
  )

  /** 在线素材导入 → 直接生成一张素材卡（不建连线，不覆盖已手改内容） */
  const addAssetCardFromStock = useCallback(
    (input: { title: string; kind: string; url: string }) => {
      setNodes((prev) => [
        ...prev,
        newAssetCard(prev, { title: input.title, kind: input.kind, url: input.url }),
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
        setNodes((prev) => [
          ...prev,
          newAssetCard(prev, {
            title,
            kind: 'expression-sheet',
            url: sheet.image,
            characterName: character.name,
          }),
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
      // 局部写回（不标孤儿）：这里只发本次真正改过的镜，未改的必须原样保留
      mergeProjectShots(projectName, changed)
        .then((r) => {
          bumpProjectRevision(r.revision)
          pushStudioCanvasNow()
        })
        .catch(() => {
          /* 写回失败不打断画布操作，工作台「重新加载」可看到差异 */
        })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [nodes, projectName, readyProject, view, bumpProjectRevision, pushStudioCanvasNow])

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
      if (effectiveProdKind(node.data) === 'video') {
        patch(id, { genState: 'error', genError: '出片镜请用侧栏生成视频，或新建生图镜' })
        return
      }
      if (activeImgRef.current.has(id)) return
      // prompt 可能缺失（旧项目镜头没有 keyframe_prompt 且 desc 为空时 shotToData 会给出 undefined）
      const prompt = String(node.data.prompt ?? '').trim()
      if (!prompt) {
        patch(id, { genState: 'error', genError: '请先填写画面提示词' })
        return
      }
      if (!projectName) {
        patch(id, { genState: 'error', genError: '先选择项目再生成图片' })
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
        // 角色/相邻分镜/素材统一由共享解析器排序；当前镜预览 ref 仅作 Seedream 输入，不占视频 slot。
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
          project: projectName,
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
    [patch, ratio, refMode, marksAsGuide, candCount, charImages, characters, modelPick, price, missingMedia, cancelGenerate, projectName],
  )

  /**
   * 图生视频：预览与实际请求共用 buildShotVideoRequest。
   * 有手改快照时逐字发送手改正文；附件仍由当前连线与开关决定。
   */
  const generateVideoOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      if (effectiveProdKind(node.data) === 'image') {
        patch(id, { vidState: 'error', vidError: '生图镜不能主出片，请新建出片镜或改镜头类型' })
        return
      }
      const request = buildShotVideoRequest({
        data: node.data,
        nodeId: node.id,
        nodes: nodesRef.current,
        characters: charactersRef.current,
        missingMedia,
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
      const omittedNotes = videoOmitToastMessages(request)
      if (omittedNotes.length) {
        setToast(omittedNotes.join('；'))
        window.setTimeout(() => setToast(''), 4200)
      }
      patch(id, {
        vidState: 'running',
        vidError: undefined,
        vidAt: Date.now(),
        videoUrl: undefined,
        videoUpstreamRecover: undefined,
      })
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
        // 服务端不再改写正文；仍优先记录它回报的 prompt（与提交值逐字相同），便于核对
        const submittedPrompt = String(res.prompt || effective.text)
        const taskId = res.id
        const done = await waitVideo(taskId, (elapsed) =>
          patch(id, { vidAt: Date.now() - elapsed * 1000 }),
        )
        const createdAt = new Date().toISOString()
        patch(id, {
          videoUrl: done.url,
          vidState: 'idle',
          vidAt: undefined,
          videoUpstreamRecover: undefined,
          videoMeta: {
            url: done.url,
            prompt: submittedPrompt,
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
        const recover = resolveVideoUpstreamRecover(e, modelKey, selectedVideoModel?.providerKind)
        patch(id, {
          vidState: 'error',
          vidError: (e as Error).message,
          vidAt: undefined,
          ...(recover ? { videoUpstreamRecover: recover } : {}),
        })
        endTask(tid, (e as Error).message)
      }
    },
    [patch, ratio, vidRes, selectedVideoModel, projectAspect, missingMedia],
  )

  /** 本地轮询超时但上游已完成时，凭 task_id 拉取成片 */
  const recoverVideoOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const stored = node.data.videoUpstreamRecover
      const modelKey = stored?.modelKey || selectedVideoModel?.key || ''
      const recover = stored || resolveVideoUpstreamRecover(new Error(node.data.vidError || ''), modelKey, selectedVideoModel?.providerKind)
      if (!recover) {
        setToast('没有可恢复的上游 task_id')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      patch(id, { vidState: 'running', vidError: undefined, vidAt: Date.now() })
      const tid = startTask('video', `${node.data.no} 拉取成片`, {
        retry: () => void recoverVideoOne(id),
      })
      try {
        const done = await recoverVideo({
          upstreamTaskId: recover.upstreamTaskId,
          modelKey,
          providerKind: recover.providerKind,
        })
        const prevMeta = node.data.videoMeta
        patch(id, {
          videoUrl: done.url,
          vidState: 'idle',
          vidAt: undefined,
          vidError: undefined,
          videoUpstreamRecover: undefined,
          videoMeta: prevMeta
            ? { ...prevMeta, url: done.url, createdAt: new Date().toISOString() }
            : {
                url: done.url,
                prompt: '',
                fingerprint: '',
                modelKey,
                createdAt: new Date().toISOString(),
              },
        })
        endTask(tid)
        setToast('成片已拉回')
        window.setTimeout(() => setToast(''), 2400)
      } catch (e) {
        patch(id, { vidState: 'error', vidError: (e as Error).message, vidAt: undefined })
        endTask(tid, (e as Error).message)
      }
    },
    [patch, selectedVideoModel],
  )

  const cancelTransitionVideo = useCallback(
    (edgeId: string) => {
      const pair = transitionPair(edgeId)
      const rec = lookupTransitionVideoRun(edgeId, pair?.source.id, pair?.to)
      const g = pair ? normalizeGenerated(pair.source.data.transitionOut?.generated) : null
      if (!rec && (!pair || g?.video?.state !== 'running')) return

      if (rec) {
        unregisterTransitionVideoRun(rec)
        rec.controller.abort()
        cancelTask(rec.taskId)
      }

      const sourceId = rec?.sourceId ?? pair!.source.id
      const to = rec?.to ?? pair!.to
      writeTransition(sourceId, to, (cur) => ({
        ...cur,
        generated: {
          ...normalizeGenerated(cur.generated),
          video: {
            ...(cur.generated?.video ?? {}),
            state: 'idle',
            error: undefined,
            at: undefined,
          },
        },
      }))
      setToast(rec ? '已取消转场出片' : '已清除转场生成状态')
      window.setTimeout(() => setToast(''), 2200)
    },
    [writeTransition, transitionPair],
  )

  const generateTransitionVideo = useCallback(
    async (edgeId: string) => {
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, target, to } = pair
      const base = normalizeTransitionOut(source.data.transitionOut, to)
      const g = normalizeGenerated(base.generated)
      const legacyKeyframe = g.bridging === 'keyframe' ? g.keyframe?.image || g.keyframe?.candidates?.[g.keyframe?.activeIdx ?? 0] : undefined
      if (lookupTransitionVideoRun(edgeId, source.id, to)) return
      if (g.video?.state === 'running') {
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            video: {
              ...(cur.generated?.video ?? {}),
              state: 'idle',
              error: undefined,
              at: undefined,
            },
          },
        }))
        return
      }
      const controller = new AbortController()
      const videoKey = modelPick.video || appSettings?.defaults?.video || ''
      const entry = appSettings?.models.find((m) => m.key === videoKey)
      const videoProvider = appSettings?.providers.find((p) => p.id === entry?.provider)
      const transitionModel = entry
        ? { ...entry, providerKind: videoProvider?.kind, features: entry.features }
        : null
      const submitsLastFrame = Boolean(g.boundary?.out && g.boundary?.in)
      const req = transitionRequestSeconds(g.targetSeconds, entry?.model, submitsLastFrame, {
        nativeAudio: g.audioMode === 'native',
      })
      const preBundle = buildTransitionVideoRequest({
        source,
        target,
        generated: g,
        model: transitionModel,
        nodes: nodesRef.current,
        characters,
        missingMedia,
      })
      const preBlocked = preBundle.blocking[0]
      if (preBlocked) {
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            video: {
              ...(cur.generated?.video ?? {}),
              state: 'error',
              error: preBlocked.message,
            },
          },
        }))
        setToast(preBlocked.message)
        window.setTimeout(() => setToast(''), 3600)
        return
      }
      const omitNotes = videoOmitToastMessages(preBundle)
      if (omitNotes.length) {
        setToast(omitNotes.join('；'))
        window.setTimeout(() => setToast(''), 4200)
      }
      writeTransition(source.id, to, (cur) => ({
        ...cur,
        mode: 'generated',
        generated: {
          ...normalizeGenerated(cur.generated),
          video: {
            ...(cur.generated?.video ?? {}),
            state: 'running',
            error: undefined,
            upstreamRecover: undefined,
            at: Date.now(),
            modelKey: videoKey,
            seconds: req.seconds,
            ...(req.trimTo ? { trimTo: req.trimTo } : {}),
          },
        },
      }))
      const tid = startTask('video', `转场 ${source.data.no}→${target.data.no}`, {
        cost: videoCost(price, req.seconds, vidRes),
        retry: () => void generateTransitionVideo(edgeId),
        cancel: () => cancelTransitionVideo(edgeId),
      })
      const run: TransitionVideoRun = { controller, taskId: tid, sourceId: source.id, to, edgeId }
      registerTransitionVideoRun(run)
      try {
        const bridging = legacyKeyframe ? 'keyframe' : 'morph'
        if (controller.signal.aborted) return
        const bundle = buildTransitionVideoRequest({
          source,
          target,
          generated: g,
          model: transitionModel,
          nodes: nodesRef.current,
          characters,
          missingMedia,
        })
        const nativeOn = g.audioMode === 'native' && Boolean(g.audioRef?.url)
        const res = await startVideo({
          transition: {
            boundaryOut: g.boundary?.out,
            boundaryIn: g.boundary?.in,
            ...(legacyKeyframe ? { keyframe: legacyKeyframe } : {}),
            bridging,
          },
          prompt: bundle.prompt,
          ...(bundle.refImages.length ? { refImages: bundle.refImages } : {}),
          ...(bundle.refVideos.length ? { refVideos: bundle.refVideos } : {}),
          ...(nativeOn ? { generateAudio: true, audioRef: g.audioRef!.url } : {}),
          seconds: req.seconds,
          ratio: projectAspect,
          resolution: vidRes,
          cameraFixed: false,
          modelKey: videoKey,
        })
        const done = await waitVideo(res.id, undefined, 12 * 60 * 1000, controller.signal)
        if (controller.signal.aborted) return
        writeTransition(source.id, to, (cur) => {
          const generated = {
            ...normalizeGenerated(cur.generated),
            video: {
              url: done.url,
              modelKey: videoKey,
              seconds: req.seconds,
              ...(req.trimTo ? { trimTo: req.trimTo } : {}),
              state: 'idle' as const,
              upstreamRecover: undefined,
              videoMeta: {
                url: done.url,
                prompt: bundle.prompt,
                fingerprint: bundle.promptFingerprint,
                modelKey: videoKey,
                createdAt: new Date().toISOString(),
              },
            },
          }
          return {
            ...cur,
            mode: 'generated',
            generated,
            meta: {
              fingerprint: transitionFingerprint(
                source.data,
                target.data,
                generated,
                undefined,
                transitionStyleRefTokens(source, target, nodesRef.current, characters, missingMedia, generated),
              ),
              modelKey: videoKey,
              createdAt: new Date().toISOString(),
            },
          }
        })
        endTask(tid)
      } catch (e) {
        if ((e as Error).name === 'AbortError' || controller.signal.aborted) return
        const message = (e as Error).message || '转场视频生成失败'
        const recover = resolveVideoUpstreamRecover(e, videoKey, videoProvider?.kind)
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            video: {
              ...(cur.generated?.video ?? {}),
              state: 'error',
              error: message,
              ...(recover ? { upstreamRecover: recover } : {}),
            },
          },
        }))
        endTask(tid, message)
      } finally {
        unregisterTransitionVideoRun(run)
      }
    },
    [transitionPair, writeTransition, modelPick, appSettings, projectAspect, vidRes, price, cancelTransitionVideo, characters, missingMedia],
  )

  const recoverTransitionVideo = useCallback(
    async (edgeId: string) => {
      const pair = transitionPair(edgeId)
      if (!pair) return
      const { source, target, to } = pair
      const base = normalizeTransitionOut(source.data.transitionOut, to)
      const g = normalizeGenerated(base.generated)
      const videoKey = g.video?.modelKey || modelPick.video || appSettings?.defaults?.video || ''
      const entry = appSettings?.models.find((m) => m.key === videoKey)
      const videoProvider = appSettings?.providers.find((p) => p.id === entry?.provider)
      const stored = g.video?.upstreamRecover
      const recover =
        stored ||
        resolveVideoUpstreamRecover(new Error(g.video?.error || ''), videoKey, videoProvider?.kind)
      if (!recover) {
        setToast('没有可恢复的上游 task_id')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      writeTransition(source.id, to, (cur) => ({
        ...cur,
        generated: {
          ...normalizeGenerated(cur.generated),
          video: {
            ...(cur.generated?.video ?? {}),
            state: 'running',
            error: undefined,
            at: Date.now(),
          },
        },
      }))
      const tid = startTask('video', `转场 ${source.data.no}→${target.data.no} 拉取成片`, {
        retry: () => void recoverTransitionVideo(edgeId),
      })
      try {
        const done = await recoverVideo({
          upstreamTaskId: recover.upstreamTaskId,
          modelKey: videoKey,
          providerKind: recover.providerKind,
        })
        writeTransition(source.id, to, (cur) => ({
          ...cur,
          generated: {
            ...normalizeGenerated(cur.generated),
            video: {
              ...(cur.generated?.video ?? {}),
              url: done.url,
              state: 'idle' as const,
              error: undefined,
              upstreamRecover: undefined,
              at: undefined,
              videoMeta: cur.generated?.video?.videoMeta
                ? {
                    ...cur.generated.video.videoMeta,
                    url: done.url,
                    createdAt: new Date().toISOString(),
                  }
                : {
                    url: done.url,
                    prompt: '',
                    fingerprint: '',
                    modelKey: videoKey,
                    createdAt: new Date().toISOString(),
                  },
            },
          },
        }))
        endTask(tid)
        setToast('转场成片已拉回')
        window.setTimeout(() => setToast(''), 2400)
      } catch (e) {
        const message = (e as Error).message
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
    [transitionPair, writeTransition, modelPick, appSettings],
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
      const charOf = (speaker: string) => charactersRef.current.find((c) => c.name === speaker)
      const modelKeyForSpeaker = (speaker: string) =>
        resolveCharacterAudioModelKey(charOf(speaker), appSettings)
      const pick = available.find((v) => v.id === node.data.voiceName) ?? available[0]
      const resolutions = lines.map((line) => {
        const char = charOf(line.speaker)
        const lineModelKey = modelKeyForSpeaker(line.speaker)
        const lineProvider = providerIdForAudioModelKey(appSettings, lineModelKey)
        return resolveVoiceForSpeaker({
          character: char,
          currentProviderId: lineProvider,
          fallbackVoice: pick?.id,
        })
      })
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
      const firstModelKey =
        lines.length > 0
          ? modelKeyForSpeaker(lines[0].speaker)
          : resolveCharacterAudioModelKey(undefined, appSettings)
      const modelKeysUsed = new Set<string>()
      const payload = lines.length > 1
        ? {
            lines: lines.map((l, i) => {
              const mk = modelKeyForSpeaker(l.speaker)
              if (mk) modelKeysUsed.add(mk)
              return {
                text: l.text,
                voice: voiceOf(l.speaker),
                rate: node.data.voiceRate ?? 180,
                modelKey: mk || undefined,
                ...deliveries[i],
              }
            }),
          }
        : {
            text: lines[0]?.text ?? text,
            voice: voiceOf(lines[0]?.speaker ?? ''),
            rate: node.data.voiceRate ?? 180,
            performance: deliveries[0],
          }
      if (firstModelKey) modelKeysUsed.add(firstModelKey)
      const bodyModelKey =
        lines.length <= 1
          ? firstModelKey || undefined
          : modelKeysUsed.size === 1
            ? [...modelKeysUsed][0]
            : undefined

      try {
        const r = await generateVoice({ ...payload, modelKey: bodyModelKey })
        const metaModel =
          modelKeysUsed.size === 1
            ? [...modelKeysUsed][0]
            : modelKeysUsed.size > 1
              ? 'mixed'
              : firstModelKey || undefined
        patch(id, {
          voiceUrl: r.url,
          voiceState: 'idle',
          voiceSeconds: r.seconds,
          voiceMeta: {
            engine: r.engine,
            model: metaModel,
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
    [patch, appSettings],
  )

  const generateAll = async () => {
    if (batch) return
    const list = nodesRef.current.filter(
      (n) => isShotCanvasNode(n) && n.data.shotId && effectiveProdKind(n.data) === 'image',
    )
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

  /**
   * 清空画布 = 删除当前集全部镜头（真删，不可撤销）。
   *
   * 走与「删除选中」同一条写回通道（planDeleteShots → persistProjectShots），
   * 服务端会先落镜头快照再删，并清掉所有指向被删镜头的转场（含跨集边界）。
   * 确定性由数据层保证：刷新、重启、换浏览器都回不来，不再依赖浏览器存档标记。
   *
   * 入口只做前置校验并开确认框：手打当前集号才生效（见 clearPromptExpected）。
   */
  const clearCanvas = () => {
    if (!readyProject) {
      setToast('先在顶栏选择项目')
      window.setTimeout(() => setToast(''), 2400)
      return
    }
    if (epProjectShots.length === 0) {
      setToast(`${formatEpisodeLabel(epNo)} 在项目里没有镜头，无需清空`)
      window.setTimeout(() => setToast(''), 2400)
      return
    }
    setClearPromptOpen(true)
  }

  /** 清空确认真正执行的部分：手打集号通过后才会到这里 */
  const confirmClearCanvas = () => {
    setClearPromptOpen(false)
    if (!readyProject || epProjectShots.length === 0) return
    const ids = epProjectShots.map((s) => String(s.id))
    const plan = planDeleteShots(projectShots, ids)
    void persistProjectShots(plan.next, plan.deletes, { fit: false })
      .then(() => {
        // 素材卡不在项目里，按节点类型单独保留
        setNodes((ns) => ns.filter((n) => (n as unknown as AssetNodeType).type === 'asset'))
        setEdges([])
        setSelId(null)
        setToast(`已删除 ${formatEpisodeLabel(epNo)} 的 ${ids.length} 镜（其他集与素材卡保留）`)
        window.setTimeout(() => setToast(''), 3600)
      })
      .catch((e: Error) => {
        setToast(e.message || '清空失败')
        window.setTimeout(() => setToast(''), 3600)
      })
  }

  /**
   * 整理画布：按类型重排位置（分镜按镜号、素材向上生长、角色单行）。
   * 只改位置，不动任何业务数据；不弹确认，因为重复点击结果完全一致。
   */
  const tidyCanvas = () => {
    const all = nodesRef.current
    const items: ArrangeItem[] = []
    for (const n of all) {
      const type = (n as unknown as { type?: string }).type
      if (type === 'asset') {
        items.push({ id: n.id, kind: 'asset', ...nodeRect('asset', n.position) })
      } else if (isShotCanvasNode(n) && n.data?.shotId) {
        // 手搓的无业务 ID 实验卡不参与：它们没有镜号，重排会打乱用户临时摆的对照组
        items.push({
          id: n.id,
          kind: 'shot',
          ...nodeRect('shot', n.position, { seconds: Number(n.data.seconds) || 3 }),
          episode: Number(n.data.episode) || 1,
          no: String(n.data.no ?? ''),
          seconds: Number(n.data.seconds) || 3,
        })
      }
    }
    for (const n of charNodes) {
      items.push({ id: n.id, kind: 'char', ...nodeRect('char', n.position) })
    }
    if (!items.length) return

    const placed = arrangeAll(items)
    const arranged = nodesRef.current.map((n) => {
      const p = placed.get(n.id)
      return p ? { ...n, position: p } : n
    })
    setNodes(arranged)
    // 整理后的位置也要落库：位置已从 localStorage 搬到项目里，这里不写就等于白整理
    const moved = diffLayout(arranged, layoutSnapRef.current)
    for (const row of moved) layoutSnapRef.current.set(row.key, { x: row.x, y: row.y })
    if (moved.length) queueCanvasLayout(moved)
    // 角色位置单独的真相源：不同步写回就会出现「一半排好一半没动」
    setCharPos((prev) => {
      const next = { ...prev }
      for (const n of charNodes) {
        const p = placed.get(n.id)
        if (!p) continue
        next[n.id.startsWith('char-') ? n.id.slice(5) : n.id] = p
      }
      try {
        localStorage.setItem('storyboard-char-pos', JSON.stringify(next))
      } catch {
        /* 配额不足时只改内存，不影响本次整理 */
      }
      return next
    })
    setToast(`已整理 ${items.length} 张卡片`)
    window.setTimeout(() => setToast(''), 2400)
    window.setTimeout(() => fitView({ padding: 0.15, minZoom: 0.3, duration: 420 }), 80)
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

  /**
   * 导出当前集：数据取自项目级镜头（含画面描述与完整提示词），
   * 不用画布节点——节点没有 desc，且只覆盖当前集的一部分。
   */
  const exportEpisode = () => {
    const doc = downloadEpisodeMarkdown(
      {
        projectName: currentSummary.title || projectName || '未命名',
        style: projectStyle,
        aspect: projectAspect,
        episodes,
        shots: projectShots,
        // 素材标题只在画布节点上，导出侧只做查表，不碰节点
        refIndex: buildShotRefIndex(characters, nodes),
      },
      epNo,
    )
    setToast(`已导出 ${doc.fileName}`)
    window.setTimeout(() => setToast(''), 2800)
  }


  useEffect(() => {
    if (!projectName || readyProject !== projectName) return
    const t = window.setTimeout(() => {
      try {
        // 项目模式只缓存边与集号：节点位置在 canvas_layouts，素材卡身份在 assets.canvas_id。
        // 关窗口前先把未提交的位置 flush 掉，否则最后一次拖动会留在 400ms 窗口里丢掉。
        flushCanvasLayout()
        localStorage.setItem(
          projectCanvasKey(projectName),
          JSON.stringify({ version: 2, edges, epNo }),
        )
      } catch {
        /* 图片过大超出配额时静默失败，不影响使用 */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [nodes, edges, characters, epNo, projectName, readyProject, flushCanvasLayout])

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
      generate: generateOne,
      cancelGenerate,
    }),
    [
      tool,
      guides,
      color,
      charImages,
      patch,
      generateOne,
      cancelGenerate,
    ],
  )
  const selected = nodes.find((n) => n.id === selId) ?? null
  /** 选中镜头的出片请求预览；与 generateVideoOne 调用同一个纯拼装器 */
  const selectedVideoRequest = useMemo(() => {
    const type = (selected as unknown as { type?: string } | null)?.type
    if (!selected || (type && type !== 'shot')) return null
    return buildShotVideoRequest({
      data: selected.data,
      nodeId: selected.id,
      nodes,
      characters,
      missingMedia,
      model: selectedVideoModel,
      resolution: vidRes,
    })
  }, [selected, nodes, characters, missingMedia, selectedVideoModel, vidRes])
  const selEdge = selEdgeId ? edges.find((e) => e.id === selEdgeId) ?? null : null
  const selEdgeSource = selEdge ? nodes.find((n) => n.id === selEdge.source) ?? null : null
  const selEdgeTarget = selEdge ? nodes.find((n) => n.id === selEdge.target) ?? null : null

  /** 连线右键菜单的数据：两镜、当前关系、接缝摘要与是否参与成片 */
  const edgeCtxData = useMemo(() => {
    if (!edgeCtx) return null
    const e = edges.find((x) => x.id === edgeCtx.id)
    if (!e) return null
    const src = nodes.find((n) => n.id === e.source)
    const tgt = nodes.find((n) => n.id === e.target)
    if (!src || !tgt) return null
    const relation: Relation = e.data?.relation ?? 'cut'
    const to = tgt.data.shotId || tgt.id
    const summary =
      relation === 'transition' ? transitionSummary(normalizeTransitionOut(src.data.transitionOut, to)) : '直接拼接'
    const stateText =
      relation !== 'transition' ? '不参与成片' : inactiveEdgeIds.has(e.id) ? '未参与成片' : '已参与成片'
    return {
      id: e.id,
      relation,
      headTitle: `${src.data.no} → ${tgt.data.no}`,
      headSub: `${summary} · ${stateText}`,
      options: [
        { id: 'cut', label: '硬切', note: relation === 'cut' ? '当前' : '直接拼接' },
        {
          id: 'transition',
          label: '转场',
          note: relation === 'transition' ? summary : '叠化 0.5s 起',
        },
        { id: 'flashback', label: '闪回', note: '叙事标注' },
        { id: 'branch', label: '分支', note: '叙事标注' },
      ],
    }
  }, [edgeCtx, edges, nodes, inactiveEdgeIds])

  /** 概览页要项目摘要：列表还没回来时用占位，避免整页空白 */
  const currentSummary: ProjectSummary = useMemo(
    () =>
      projects.find((p) => p.name === projectName) ??
      ({
        name: projectName,
        title: projectName,
        aspect: projectAspect,
        style: projectStyle,
      } as ProjectSummary),
    [projects, projectName, projectAspect, projectStyle],
  )

  return (
    <CanvasCtx.Provider value={api}>
      {route.kind === 'hub' ? (
        <div className="app">
          <ProjectHub
            projects={projects}
            loaded={projectsLoaded}
            onOpen={openProject}
            onCreate={applyProjectCreated}
            onDeleted={applyProjectDeletion}
            themeToggle={<ThemeToggle />}
          />
        </div>
      ) : (
      <AppShell
        view={view}
        projectTitle={currentSummary.title || projectName}
        onNavigate={changeView}
        onReturnHub={replaceWithHub}
        projectSlot={
          <ProjectMenu
            currentProjectName={projectName}
            projects={projects}
            variant="rail"
            onOpenProject={changeProject}
            onReturnHub={replaceWithHub}
            onCreated={applyProjectCreated}
            onDeleted={applyProjectDeletion}
          />
        }
        episodeSlot={
          EPISODE_VIEWS.includes(view) && view !== 'board' ? (
            <EpPicker projectName={projectName} epNo={epNo} setEpNo={setEpNo} version={epVersion} />
          ) : null
        }
        globalTools={
          <>
            {hasKey === false && (
              <span className="warn-chip" title="未在 ~/.canghe-skills/.env 找到 ARK_API_KEY">
                未配置密钥
              </span>
            )}
            <TaskCenter />
          </>
        }
        railFooter={<ThemeToggle />}
        counts={{ assets: designSheetCount + characters.length }}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
        hiddenViews={studioEnabled ? [] : ['creative']}
        onIntent={(target) => {
          // 只关心创意入口：其它视图是亚毫秒的组件替换，没有可预热的成本
          if (target === 'creative') setStudioIntent(true)
        }}
      >
        {view === 'overview' ? (
          <OverviewPage
            project={currentSummary}
            shots={projectShots}
            episodes={episodes}
            charactersCount={characters.length}
            onNavigate={changeView}
            onIntake={() => setIntakeOpen(true)}
            onOpenEpisode={(no) => {
              changeView('board', { boardPhase: 'canvas' })
              enterBoardEpisode(no)
            }}
          />
        ) : view === 'creative' ? (
          // 常驻模式下由下面的 keepalive 容器承担渲染，这里留空避免落进画布分支
          studioMount.mode === 'inline' ? (
            // 创意会话整体交给宿主：这里只放容器与错误态
            <StudioFrame projectName={projectName} />
          ) : null
        ) : view === 'account' ? (
          <AccountPage
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2800)
            }}
          />
        ) : view === 'settings' ? (
          <Settings
            currentProjectName={projectName}
            initialSection={settingsInitialSection}
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
            settings={appSettings}
            onDesignCountChange={setDesignSheetCount}
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
            projectAspect={projectAspect}
            characters={characters}
            patch={patchCharacter}
            selectedShot={selected ? { id: selected.id, no: selected.data.no } : null}
            selectedShotBudget={
              selectedVideoRequest
                ? {
                    used: selectedVideoRequest.refs.length,
                    max: null,
                    expression: Boolean(selected?.data.useExpressionRef),
                    omitted: selectedVideoRequest.omitted.length,
                  }
                : null
            }
            onInject={injectCharacter}
            onAdd={addCharacter}
            onDelete={deleteCharacter}
            onRename={renameCharacter}
            viewModel={modelPick.view}
            onPickViewModel={(key) => pickModelKey('view', key)}
            onPersist={saveCharactersNow}
            onPublishSheet={publishExpressionSheet}
            charsOn={charsOn}
            onToggleChars={toggleChars}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3000)
            }}
          />
        ) : view === 'board' && boardPhase === 'episodes' ? (
          <BoardEpisodeGrid
            projectReady={readyProject === projectName && Boolean(projectName)}
            episodes={episodes}
            shots={projectShots}
            onPick={enterBoardEpisode}
            onAddEpisode={() => void handleAddEpisode()}
            onImportScript={openScriptImport}
            onViewEpisodeScript={setEpisodeScriptDetailEpNo}
            addBusy={addEpisodeBusy}
            projectTitle={currentSummary.title || projectName}
            refIndex={buildShotRefIndex(characters, nodes)}
            onNotice={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3200)
            }}
          />
        ) : (
        <div className="canvas-workspace" data-canvas-shots data-board-phase="canvas">
            <WorkbenchBar
              scope={
                <>
                  <button
                    type="button"
                    className="btn-ghost board-ep-back"
                    onClick={() => setBoardPhase('episodes')}
                    title="返回分集目录"
                  >
                    ← 集列表
                  </button>
                  <span className="wb-bar-title">画布 · 分镜</span>
                  <button
                    type="button"
                    className="ep-chip ep-chip-script"
                    data-board-ep-label
                    data-has-script={episodeScriptUi(episodes, epNo).hasScript ? 'true' : 'false'}
                    title="查看本集剧本大纲（标题、场次）；分镜仍在画布编辑"
                    onClick={() => setEpisodeScriptDetailEpNo(epNo)}
                  >
                    <span className="ep-chip-no">{formatEpisodeLabel(epNo)}</span>
                    <span className="ep-chip-script-badge">
                      剧本 · {episodeScriptUi(episodes, epNo).badge}
                    </span>
                  </button>
                </>
              }
              scopeDetail={
                epProjectShots.length === 0 ? (
                  <>0 镜</>
                ) : (
                  <>
                    {epProjectShots.length} 镜 · 总时长{' '}
                    <b className={epSeconds > epTargetSeconds ? 'over' : ''}>{epSeconds.toFixed(1)}s</b> / 目标{' '}
                    {epTargetSeconds}s
                    {epSeconds > epTargetSeconds ? (
                      <span className="wb-warn">超 {(epSeconds - epTargetSeconds).toFixed(1)}s</span>
                    ) : null}
                    {' · '}缺首帧 <b className={epPromptStat.empty ? 'over' : ''}>{epPromptStat.empty}</b>
                    {' · '}缺锚点 <b className={epPromptStat.miss ? 'over' : ''}>{epPromptStat.miss}</b>
                  </>
                )
              }
              settings={
                <div className="wb-field">
                  <span className="label">目标时长</span>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    key={`${epNo}:${epTargetSeconds}`}
                    defaultValue={epTargetSeconds}
                    onBlur={(e) => void changeEpisodeTarget(Number(e.target.value) || epTargetSeconds)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    style={{ width: 64 }}
                    aria-label="当前集目标时长（秒）"
                  />
                  <span className="label">秒</span>
                </div>
              }
              actions={
                <>
                  <button
                    className="btn"
                    disabled={!readyProject || epProjectShots.length === 0}
                    title={
                      !readyProject
                        ? '先在顶栏选择项目'
                        : epProjectShots.length === 0
                          ? '当前集没有镜头，无可导出内容'
                          : '把当前集导出为分镜表 Markdown，可直接回灌导入入口'
                    }
                    onClick={exportEpisode}
                  >
                    导出
                  </button>
                  <button
                    className="btn"
                    disabled={!readyProject}
                    title={readyProject ? '上传或粘贴分镜表，确认后直接写入项目并出现在画布' : '先在顶栏选择项目'}
                    onClick={() => setIntakeOpen(true)}
                  >
                    导入
                  </button>
                  <button
                    className="btn"
                    disabled={epPromptStat.miss === 0}
                    onClick={() => void fixEpisodeAnchors()}
                    title="把首帧提示词里无法展开的角色占位替换为外观锚点（只作用于当前集）"
                  >
                    补齐锚点
                  </button>
                  <button
                    className="btn"
                    disabled={!selected || !selected.data.shotId || !readyProject}
                    onClick={() => {
                      const sid = selected?.data.shotId
                      if (sid) void insertShotAfter(String(sid))
                    }}
                    title="在所选镜头之后插入一个正式镜头"
                  >
                    插入
                  </button>
                </>
              }
            />
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
                charsOn={charsOn}
                diagOn={diagOn}
                onAddImageShot={() => void addShot('image')}
                onAddVideoShot={() => void addShot('video')}
                onGenAll={generateAll}
                onUnifyTransitions={unifyTransitions}
                onFit={() => fitView({ padding: 0.2, duration: 400 })}
                onTidy={tidyCanvas}
                onToggleChars={toggleChars}
                onToggleDiag={() => setDiagOn((v) => !v)}
                onClear={clearCanvas}
                clear={{
                  available: Boolean(readyProject) && epProjectShots.length > 0,
                  episodeLabel: formatEpisodeLabel(epNo),
                  count: epProjectShots.length,
                  reason: readyProject ? '' : '先在顶栏选择项目',
                }}
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
            {epCanvasCards === 0 && (readyProject || otherEpCounts.length > 0) && (
              <div className="canvas-hint">
                <b>{formatEpisodeLabel(epNo)} 还没有镜头</b>
                <span>项目里这一集确实没有镜头：导入分镜表或新建镜头后卡片会自动出现。</span>
                <button className="btn-mini" onClick={() => void addShot('image')}>
                  新建生图镜
                </button>
                <button className="btn-mini" onClick={() => void addShot('video')}>
                  新建出片镜
                </button>
                {otherEpCounts.length > 0 && (
                  <>
                    <span>其他集还有：</span>
                    {otherEpCounts.map(([e, c]) => (
                      <button
                        key={e}
                        className="btn-mini"
                        onClick={() => focusEpisode(e)}
                        title={`切到 ${formatEpisodeLabel(e)}`}
                      >
                        {formatEpisodeLabel(e)} · {c} 镜
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {selectedNodes.length > 0 && (
              <div className="selbar">
                <b>{selectedNodes.length} 张已选</b>
                <button className="btn-mini" onClick={() => void runOnSelected()} disabled={!!selBusy}>
                  出图
                </button>
                {selBusy && (
                  <button className="btn-mini" onClick={cancelBatch}>
                    取消出图
                  </button>
                )}
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
                  return
                }
                // 分镜 / 素材卡：用落点覆盖后再与快照比对，只提交坐标真的变了的 key。
                // 一次拖动 = 一行请求；水合后快照被重置，所以「只是加载」不会发请求。
                const withDrop = nodesRef.current.map((n) =>
                  n.id === node.id ? { ...n, position: node.position } : n,
                )
                const changed = diffLayout(withDrop, layoutSnapRef.current)
                if (!changed.length) return
                for (const row of changed) layoutSnapRef.current.set(row.key, { x: row.x, y: row.y })
                queueCanvasLayout(changed)
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
                const risky = delEdges.some((e) => needsEdgeDeleteConfirm(e))
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
              onEdgeClick={(e, ed) => {
                // 参考连线仍以单击选中
                if (ed.id.startsWith('ref-') || ed.id.startsWith('ref-tr|')) {
                  setSelId(null)
                  setSelEdgeId(null)
                  setSelRef(ed.id)
                  return
                }
                if (isDerivedEdgeId(ed.id)) return
                // 分镜连线：单击弹出关系菜单。只开菜单，不改数据也不动正在编辑的转场边
                setSelId(null)
                setSelRef(null)
                openEdgeMenu(e, ed.id)
              }}
              onEdgeContextMenu={(e, ed) => {
                // 分镜连线不再用右击：只拦掉浏览器原生菜单，避免掉出无关菜单
                if (!isDerivedEdgeId(ed.id)) e.preventDefault()
              }}
              onPaneClick={() => {
                setSelRef(null)
                setSelId(null)
                setSelEdgeId(null)
                setCtx(null)
                setEdgeCtx(null)
              }}
              onNodeContextMenu={(e, n) => {
                e.preventDefault()
                setSelRef(null)
                setSelEdgeId(null)
                setEdgeCtx(null)
                setSelId(n.id)
                setCtx({ x: e.clientX, y: e.clientY, id: n.id })
              }}
              onPaneContextMenu={() => {
                setCtx(null)
                setEdgeCtx(null)
              }}
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
              <Controls
                showInteractive={false}
                position="top-left"
                fitViewOptions={{ padding: 0.12, minZoom: 0.66 }}
                style={{ top: '50%', left: 12, bottom: 'auto', transform: 'translateY(-50%)' }}
              />
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
                onClickItem={(id) => {
                  if (ctxData.mode === 'transition-pick') {
                    toggleTransitionRef(ctxData.edgeId, id)
                    return
                  }
                  if (ctxData.mode === 'shot') toggleRef(ctxData.targetId, id)
                  else toggleRef(id, ctxData.targetId)
                }}
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

            {edgeCtx && edgeCtxData && (
              <EdgeContextMenu
                x={edgeCtx.x}
                y={edgeCtx.y}
                headTitle={edgeCtxData.headTitle}
                headSub={edgeCtxData.headSub}
                sectionTitle="关系"
                options={edgeCtxData.options}
                value={edgeCtxData.relation}
                onPick={(id) => setEdgeRelation(edgeCtxData.id, id as Relation)}
                extraActions={[
                  {
                    key: 'panel',
                    label: '转场设置…',
                    hint: edgeCtxData.relation === 'transition' ? '打开转场面板' : '会先落到转场',
                    onClick: () => openTransitionFromMenu(edgeCtxData.id),
                  },
                ]}
                onDelete={() => deleteEdgeFromMenu(edgeCtxData.id)}
                onClose={() => setEdgeCtx(null)}
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
              nodes={nodes}
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
              onGenerateVideo={generateTransitionVideo}
              onRecoverVideo={recoverTransitionVideo}
              onCancelVideo={cancelTransitionVideo}
              onFocusShot={focusShotFromTransition}
              onPick={pickModelKey}
              onVidResChange={setVidRes}
              projectStyle={projectStyle}
              stagePick={stagePick}
              onPickStage={pickStageModel}
              agentRefTokens={
                transitionAgentRefs[
                  `${String(selEdgeSource.data.shotId || selEdgeSource.id)}|${String(selEdgeTarget.data.shotId || selEdgeTarget.id)}`
                ] ?? []
              }
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
            onRecoverVideo={recoverVideoOne}
            projectAspect={projectAspect}
            price={price}
            projectName={projectName}
            characters={characters}
            videoRequest={selectedVideoRequest}
            projectStyle={projectStyle}
            stagePick={stagePick}
            onPickStage={pickStageModel}
            settings={appSettings}
            pick={modelPick}
            onPick={pickModelKey}
            onAddAssetCard={addAssetCardFromStock}
          />
          )}
        </main>
        </div>
        )}

        {/*
          创意会话常驻：`display: none` 不销毁 iframe 的浏览上下文，
          所以会话列表、滚动位置、输入草稿与 WebSocket 都还在，切回即用。
          只在首次进入后挂载——启动就挂会拖慢首屏。
        */}
        {studioMount.mode === 'keepalive' ? (
          <div className="view-keepalive" data-active={studioMount.visible ? 'true' : 'false'}>
            <StudioFrame active={studioMount.visible} projectName={projectName} />
          </div>
        ) : null}
      </AppShell>
      )}

        {episodeScriptDetailEpNo != null ? (
          <EpisodeScriptDetailDialog
            epNo={episodeScriptDetailEpNo}
            episode={findEpisode(episodes, episodeScriptDetailEpNo)}
            episodes={episodes}
            shotCount={
              projectShots.filter((s) => (Number(s.episode) || 1) === episodeScriptDetailEpNo).length
            }
            onClose={() => setEpisodeScriptDetailEpNo(null)}
            onImportScript={() => {
              setScriptHintEpNo(episodeScriptDetailEpNo)
              setScriptImportOpen(true)
            }}
            onEnterBoard={() => {
              const n = episodeScriptDetailEpNo
              setEpisodeScriptDetailEpNo(null)
              if (n != null) enterBoardEpisode(n)
            }}
            onDeleteEpisodeScript={() => {
              const n = episodeScriptDetailEpNo
              setEpisodeScriptDetailEpNo(null)
              if (n != null) requestDeleteEpisodeScript(n)
            }}
          />
        ) : null}

        {scriptImportOpen ? (
          <EpisodeScriptImportDialog
            projectName={readyProject}
            episodes={episodes}
            hintEpNo={scriptHintEpNo}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 3000)
            }}
            onClose={() => setScriptImportOpen(false)}
            onApply={handleApplyScriptEpisodes}
          />
        ) : null}

        {intakeOpen ? (
          <IntakeDialog
            target="shots"
            projectName={readyProject}
            epNo={epNo}
            settings={appSettings}
            stagePick={stagePick}
            shots={projectShots}
            episodes={episodes}
            chars={characters}
            characterSheets={characters}
            refIndex={buildShotRefIndex(characters, nodes)}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2800)
            }}
            onClose={() => setIntakeOpen(false)}
            onApply={applyShotImport}
          />
        ) : null}

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
          />
        )}

        {toast && <div className="toast">{toast}</div>}

        <PromptDialog
          open={addEpisodePromptOpen}
          title="新增分集"
          label="分集标题"
          hint="可留空，留空时按集号自动命名"
          placeholder="如 第一集 · 雨夜"
          confirmText="创建"
          onCancel={() => setAddEpisodePromptOpen(false)}
          onConfirm={(value) => void submitAddEpisode(value)}
        />

        {/*
          清空画布不可撤销（服务端只留快照，界面没有恢复入口），
          所以要求手打当前集号：既拦误点，也避免清错集。
        */}
        <PromptDialog
          open={deleteEpisodeScriptEpNo != null}
          title={
            deleteEpisodeScriptEpNo != null
              ? `删除 ${formatEpisodeLabel(deleteEpisodeScriptEpNo)} 的分集剧本`
              : '删除分集剧本'
          }
          label={
            deleteEpisodeScriptEpNo != null
              ? `输入 ${formatEpisodeLabel(deleteEpisodeScriptEpNo)} 确认`
              : '确认'
          }
          hint={
            deleteEpisodeScriptEpNo != null
              ? (() => {
                  const n = deleteEpisodeScriptEpNo
                  const cnt = projectShots.filter((s) => (Number(s.episode) || 1) === n).length
                  return `只移除标题、钩子与场次大纲，不删分镜镜头${
                    cnt > 0 ? `（本集仍有 ${cnt} 镜）` : ''
                  }；与「清空画布」不同。`
                })()
              : ''
          }
          placeholder={deleteEpisodeScriptEpNo != null ? formatEpisodeLabel(deleteEpisodeScriptEpNo) : ''}
          confirmText="删除剧本"
          validate={(v) =>
            deleteEpisodeScriptEpNo != null
              ? v.trim().toUpperCase() === formatEpisodeLabel(deleteEpisodeScriptEpNo)
              : false
          }
          onCancel={() => setDeleteEpisodeScriptEpNo(null)}
          onConfirm={() => void confirmDeleteEpisodeScript()}
        />

        <PromptDialog
          open={clearPromptOpen}
          title={`清空 ${formatEpisodeLabel(epNo)} 的分镜`}
          label={`输入 ${formatEpisodeLabel(epNo)} 确认`}
          hint={`将删除本集 ${epProjectShots.length} 镜，不可撤销；素材卡与其他集保留，指向本集的转场会被清空。服务端会先留一份镜头快照。`}
          placeholder={formatEpisodeLabel(epNo)}
          confirmText={`删除 ${epProjectShots.length} 镜`}
          validate={(v) => v.trim().toUpperCase() === formatEpisodeLabel(epNo)}
          onCancel={() => setClearPromptOpen(false)}
          onConfirm={confirmClearCanvas}
        />
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

