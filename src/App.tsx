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

import ShotNode from './ShotNode'
import CharNode from './CharNode'
import ShotEdge from './ShotEdge'
import Inspector from './Inspector'
import Timeline from './Timeline'
import CharacterBoard from './CharacterBoard'
import Preview from './Preview'
import ShotTable from './ShotTable'
import PromptTable from './PromptTable'
import EpisodeBar from './EpisodeBar'
import ScriptBoard from './ScriptBoard'
import TaskCenter from './TaskCenter'
import ToolMenu from './ToolMenu'
import BoardMenu from './BoardMenu'
import { endTask, startTask } from './tasks'
import { DiagnosticsPanel, diagnose } from './Diagnostics'
import { defaultCharacters, type CharacterSheet } from './characters'
import { CanvasCtx } from './ctx'
import { initialEdges, initialNodes, type CharNodeType, type ShotEdgeType, type ShotNodeType } from './data'
import { PRICE_PER_IMAGE, cardWidth, migrateMarks, uid, type Relation, type ShotData, type Tool } from './types'
import {
  checkHealth,
  generateImage,
  generateVoice,
  listProjects,
  listVoices,
  getProject,
  mergeProjectShots,
  patchProject,
  startVideo,
  waitVideo,
  type ProjectShot,
  type VoiceOption,
} from './api'
import { dialogueToText, parseDialogue } from './prompts'
import { COMPOSE_HINT, composeReference } from './compose'
import { bizSignature, nodeToShot, shotToData } from './shotSync'
import { toProject, toSheet, type ProjectChar } from './charMap'

const nodeTypes = { shot: ShotNode, char: CharNode }
const edgeTypes = { shot: ShotEdge }

const COLORS = ['#fbbf24', '#f87171', '#38bdf8', '#a3e635', '#c084fc']
const STORAGE_KEY = 'storyboard-canvas-v1'

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

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!Array.isArray(p?.nodes)) return null
    if (p.nodes.length === 0 && p.cleared !== true) return null
    // epNo 单独恢复（见下方 useEffect）
    return {
      nodes: p.nodes.map((n: ShotNodeType) => ({
        ...n,
        data: { ...n.data, marks: migrateMarks(n.data?.marks ?? []) },
      })),
      edges: p.edges ?? [],
      characters: Array.isArray(p.characters) ? p.characters : defaultCharacters,
      cleared: p.cleared === true,
      epNo: Number.isFinite(Number(p.epNo)) && Number(p.epNo) > 0 ? Number(p.epNo) : 1,
    }
  } catch {
    return null
  }
}

function Shell() {
  const saved = useMemo(loadSaved, [])
  const [nodes, setNodes, onNodesChange] = useNodesState<ShotNodeType>(saved?.nodes ?? initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<ShotEdgeType>(saved?.edges ?? initialEdges)
  const [characters, setCharacters] = useState<CharacterSheet[]>(saved?.characters ?? defaultCharacters)
  const [view, setView] = useState<'board' | 'chars' | 'table' | 'prompts' | 'script'>('board')
  const [projectName, setProjectName] = useState('')
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
  const [ratio, setRatio] = useState('16:9')
  const [refMode, setRefMode] = useState(false)
  const [marksAsGuide, setMarksAsGuide] = useState(true)
  const [candCount, setCandCount] = useState(4)
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null)
  const [vbatch, setVbatch] = useState<{ total: number; done: number } | null>(null)
  const [vidBatch, setVidBatch] = useState<{ total: number; done: number } | null>(null)
  const [vidRes, setVidRes] = useState<'480p' | '720p'>('480p')
  const [preview, setPreview] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [assReady, setAssReady] = useState(false)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voiceProvider, setVoiceProvider] = useState('')
  const { fitView, setCenter, getZoom } = useReactFlow()
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
  useEffect(() => {
    listProjects()
      .then(({ projects }) => {
        setProjectName((cur) => cur || projects[0]?.name || '')
      })
      .catch(() => {
        /* 没有项目目录时不阻塞画布使用 */
      })
  }, [])

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
    listVoices().then((v) => {
      setVoices(v.voices)
      setVoiceProvider(v.provider)
    })
  }, [])

  const patch = useCallback(
    (id: string, p: Partial<ShotData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n))),
    [setNodes],
  )

  const patchCharacter = useCallback(
    (id: string, p: Partial<CharacterSheet>) =>
      setCharacters((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c))),
    [],
  )

  // 角色以 project.json 为准：绑定项目后加载进来，替换掉 localStorage 的那份
  useEffect(() => {
    if (!projectName) return
    let alive = true
    getProject(projectName)
      .then((p) => {
        if (!alive) return
        const list = (p.characters ?? []) as ProjectChar[]
        if (list.length > 0) {
          // 项目文件里可能没有图（历史数据 / dataURL 不落盘），此时保留本地已有的图，
          // 否则每次刷新三视图都会"消失"
          const prev = charactersRef.current
          const sheets = list.map((c) => {
            const s = toSheet(c)
            const old = prev.find((x) => x.id === s.id || x.name === s.name)
            if (!old) return s
            return {
              ...s,
              image: s.image || old.image,
              candidates: s.candidates?.length ? s.candidates : old.candidates,
              activeIdx: s.activeIdx ?? old.activeIdx,
            }
          })
          setCharacters(sheets)
          charSnapRef.current = JSON.stringify(sheets.map(toProject))
        } else {
          // 项目里还没角色：把画布现有的写上去，建立单一真相源
          const seed = charactersRef.current.map(toProject)
          charSnapRef.current = JSON.stringify(seed)
          patchProject(projectName, { characters: seed }).catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectName])

  // 角色改动回写（防抖 + 快照比对，避免首屏把整份角色重写一遍）
  useEffect(() => {
    if (!projectName) return
    const payload = characters.map(toProject)
    const sig = JSON.stringify(payload)
    if (sig === charSnapRef.current) return
    const t = window.setTimeout(() => {
      charSnapRef.current = sig
      patchProject(projectName, { characters: payload }).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [characters, projectName])

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

  const cycleEdge = useCallback(
    (id: string) => {
      const order: Relation[] = ['cut', 'transition', 'flashback', 'branch']
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== id) return e
          const cur = e.data?.relation ?? 'cut'
          return { ...e, data: { relation: order[(order.indexOf(cur) + 1) % order.length] } }
        }),
      )
    },
    [setEdges],
  )

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) => addEdge({ ...c, type: 'shot', data: { relation } } as ShotEdgeType, eds)),
    [relation, setEdges],
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
        { name: c.name, role: c.role, image: c.image },
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
  }, [characters, charPos, shownNodes])

  /** 角色节点加入渲染（不进 nodes 状态，避免污染镜头同步/持久化） */
  const canvasNodes = useMemo(
    () => (charsOn ? ([...charNodes, ...shownNodes] as unknown as ShotNodeType[]) : shownNodes),
    [charsOn, charNodes, shownNodes],
  )

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
            stroke: card ? '#34d399' : '#8aa0b8',
            strokeWidth: 1.4,
            strokeDasharray: '6 4',
            opacity: card ? 1 : 0.65,
          },
        })
      }
    }
    return out
  }, [charsOn, characters, shownNodes])
  /** 其他集各有多少张卡：当前集为空时用来提示「不是丢了，是切集了」 */
  /** 当前选中的卡片（⌘/Shift 点选 或 Shift 框选） */
  const selectedNodes = useMemo(() => shownNodes.filter((n) => n.selected), [shownNodes])
  const [selBusy, setSelBusy] = useState('')

  /** 对选中的卡片批量执行 */
  const runOnSelected = async (kind: 'image' | 'video' | 'voice') => {
    if (selBusy) return
    const list = nodesRef.current.filter((n) => n.selected)
    if (list.length === 0) return
    const label = { image: '出图', video: '出片', voice: '配音' }[kind]
    setSelBusy(`${label} 0/${list.length}`)
    let i = 0
    for (const n of list) {
      if (kind === 'image') await generateOne(n.id)
      else if (kind === 'video') await generateVideoOne(n.id)
      else await generateVoiceOne(n.id)
      i += 1
      setSelBusy(`${label} ${i}/${list.length}`)
    }
    setSelBusy('')
    setToast(`已对 ${list.length} 张执行${label}`)
    window.setTimeout(() => setToast(''), 2400)
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

  const shownEdges = useMemo<Edge[]>(() => {
    const ids = new Set(shownNodes.map((n) => n.id))
    return [...edges.filter((e) => ids.has(e.source) && ids.has(e.target)), ...castEdges]
  }, [edges, shownNodes, castEdges])

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
          chain.push({
            id: `seq-${ids[i - 1]}-${ids[i]}`,
            source: ids[i - 1],
            target: ids[i],
            type: 'shot',
            data: { relation: 'cut' },
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
    if (!charsOn || !projectName) return
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
  }, [charsOn, projectName, setNodes])

  /** 画布侧改动 → 写回 project.json。
   * 只在有实质性业务字段变化时才写，且靠快照对比避免首屏把所有镜头重写一遍。
   */
  useEffect(() => {
    if (!projectName || view !== 'board') return
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
  }, [nodes, projectName, view])

  const generateOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const prompt = node.data.prompt.trim()
      if (!prompt) {
        patch(id, { genState: 'error', genError: '请先填写画面提示词' })
        return
      }
      patch(id, { genState: 'running', genError: undefined })
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
        const res = await generateImage({
          prompt: composed ? prompt + COMPOSE_HINT : prompt,
          ratio,
          refImage: ref,
          n: candCount,
        })
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
      } catch (e) {
        patch(id, { genState: 'error', genError: (e as Error).message })
      }
    },
    [patch, ratio, refMode, marksAsGuide, candCount],
  )

  /** 图生视频：以卡片当前画面为首帧，提交后轮询出片 */
  const generateVideoOne = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const first = node.data.refImage
      if (!first) {
        patch(id, { vidState: 'error', vidError: '先生成画面，出片需要首帧' })
        return
      }
      patch(id, { vidState: 'running', vidError: undefined, vidAt: Date.now(), videoUrl: undefined })
      const motion = node.data.prompt.trim()
      const fallback = `${node.data.size}，${node.data.move === '固定' ? '镜头固定，人物与环境的细微动态' : `镜头${node.data.move}`}，电影感光影，自然的空气与光尘流动`
      const tid = startTask('video', `${node.data.no} 出片`, {
        retry: () => void generateVideoOne(id),
      })
      try {
        const taskId = await startVideo({
          image: first,
          prompt: motion || fallback,
          seconds: Math.round(node.data.seconds),
          ratio,
          resolution: vidRes,
          cameraFixed: node.data.move === '固定',
        })
        const url = await waitVideo(taskId, (elapsed) =>
          patch(id, { vidAt: Date.now() - elapsed * 1000 }),
        )
        patch(id, { videoUrl: url, vidState: 'idle', vidAt: undefined })
        endTask(tid)
      } catch (e) {
        patch(id, { vidState: 'error', vidError: (e as Error).message, vidAt: undefined })
        endTask(tid, (e as Error).message)
      }
    },
    [patch, ratio, vidRes],
  )

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
      if (available.length === 0) {
        patch(id, { voiceState: 'error', voiceError: '当前没有可用音色（未配置 TTS 引擎）' })
        return
      }
      // 旧数据里的 voiceName 可能已不可用（如未下载的 say 音色），回落到首个可用音色
      const pick = available.find((v) => v.id === node.data.voiceName) ?? available[0]
      patch(id, { voiceState: 'running', voiceError: undefined, voiceName: pick.id })

      // 一镜多说话人：按行拆开，各自用角色的音色；只有一行就走单句
      const lines = parseDialogue(text)
      const multi = lines.length > 1
      const usable = (v?: string) => (v && available.some((x) => x.id === v) ? v : undefined)
      const payload = multi
        ? {
            lines: lines.map((l) => {
              const ch = charactersRef.current.find((c) => c.name === l.speaker)
              return {
                text: l.text,
                voice: usable(ch?.voiceId) ?? pick.id,
                rate: node.data.voiceRate ?? 180,
              }
            }),
          }
        : { text, voice: pick.id, rate: node.data.voiceRate ?? 180 }

      try {
        const r = await generateVoice(payload)
        patch(id, { voiceUrl: r.url, voiceState: 'idle', voiceSeconds: r.seconds })
      } catch (e) {
        patch(id, { voiceState: 'error', voiceError: (e as Error).message })
      }
    },
    [patch],
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
      const tid = startTask('image', `${n.data.no} 出图`, {
        cost: PRICE_PER_IMAGE,
        retry: () => void generateOne(n.id),
      })
      try {
        await generateOne(n.id)
        const after = nodesRef.current.find((x) => x.id === n.id)
        endTask(tid, after?.data.genState === 'error' ? after.data.genError || '出图失败' : undefined)
      } catch (e: any) {
        endTask(tid, String(e?.message || e))
      }
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
  const reorderShot = useCallback((id: string, toIndex: number) => {
    setNodes((prev) => {
      const from = prev.findIndex((n) => n.id === id)
      if (from < 0) return prev
      const to = Math.max(0, Math.min(prev.length - 1, toIndex))
      if (to === from) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [setNodes])

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
    setNodes([])
    setEdges([])
    setSelId(null)
    setToast('画布已清空（project.json 未改动）')
    window.setTimeout(() => setToast(''), 2600)
  }

  const resetAll = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setNodes(initialNodes)
    setEdges(initialEdges)
    setSelId(null)
    setTool('none')
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
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ nodes, edges, characters, cleared: nodes.length === 0, epNo }),
        )
      } catch {
        /* 图片过大超出配额时静默失败，不影响使用 */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [nodes, edges, characters, epNo])

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

  const charImages = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of characters) if (c.name && c.image) m[c.name] = c.image
    return m
  }, [characters])

  const api = useMemo(
    () => ({
      tool,
      guides,
      color,
      charImages,
      patch,
      cycleEdge,
      generate: generateOne,
      generateVideo: generateVideoOne,
    }),
    [tool, guides, color, charImages, patch, cycleEdge, generateOne, generateVideoOne],
  )
  const selected = nodes.find((n) => n.id === selId) ?? null

  return (
    <CanvasCtx.Provider value={api}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-dot" />
            <b>分镜画布</b>
            <span className="brand-sub">React Flow × Konva</span>
          </div>

          <div className="viewtabs">
            <button className={view === 'script' ? 'on' : ''} onClick={() => setView('script')}>
              剧本
            </button>
            <button className={view === 'chars' ? 'on' : ''} onClick={() => setView('chars')}>
              角色
            </button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
              镜头表
            </button>
            <button className={view === 'prompts' ? 'on' : ''} onClick={() => setView('prompts')}>
              提示词
            </button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
              画布
            </button>
          </div>

          {view === 'board' && (
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
          )}

          <div className="spacer" />

          {hasKey === false && (
            <span className="warn-chip" title="未在 ~/.canghe-skills/.env 找到 ARK_API_KEY">
              未配置密钥
            </span>
          )}
          {view === 'board' ? (
            <>
              <BoardMenu
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
                onFit={() => fitView({ padding: 0.2, duration: 400 })}
                onToggleChars={toggleChars}
                onToggleDiag={() => setDiagOn((v) => !v)}
                onClear={clearCanvas}
              />
              <button
                className="btn"
                onClick={() => setPreview(true)}
                title="按时间尺顺序连播：有视频放视频，没视频按镜头时长定格"
              >
                ▶ 连播
              </button>
            </>
          ) : view === 'table' || view === 'prompts' || view === 'script' ? (
            <span className="board-count">{projectName || '未选项目'}</span>
          ) : (
            <span className="board-count">{characters.length} 个角色</span>
          )}
          <TaskCenter />
          <button className="btn primary" onClick={exportJson}>导出 JSON</button>
        </header>

        {/* 画布也按集过滤，所以集栏必须在画布上也能用，否则切不了集、也看不出当前是哪一集 */}
        {(view === 'board' || view === 'table' || view === 'prompts' || view === 'script') && (
          <EpisodeBar
            projectName={projectName}
            epNo={epNo}
            setEpNo={setEpNo}
            version={epVersion}
          />
        )}

        {view === 'table' ? (
          <ShotTable
            projectName={projectName}
            setProjectName={setProjectName}
            onCanvas={onCanvasIds}
            epNo={epNo}
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
            onGotoShotTable={() => setView('table')}
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
            onPush={pushShotsToCanvas}
            toast={(m) => {
              setToast(m)
              window.setTimeout(() => setToast(''), 2600)
            }}
          />
        ) : view === 'chars' ? (
          <CharacterBoard
            characters={characters}
            patch={patchCharacter}
            selectedShot={selected ? { id: selected.id, no: selected.data.no } : null}
            onInject={injectCharacter}
            voices={voices}
          />
        ) : (
        <main className="main">
          <div className="canvas">
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
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, n) => {
                if (n.id.startsWith('char-')) focusChar(charNameOf(n.id))
                else setSelId(n.id)
              }}
              onPaneClick={() => setSelId(null)}
              onNodesDelete={() => setSelId(null)}
              defaultEdgeOptions={{ type: 'shot' }}
              connectionLineStyle={{ stroke: '#38bdf8', strokeWidth: 2 }}
              proOptions={{ hideAttribution: true }}
              minZoom={0.2}
              maxZoom={2.2}
              fitView
              fitViewOptions={{ padding: 0.12, minZoom: 0.66 }}
              deleteKeyCode={['Backspace', 'Delete']}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              selectionKeyCode="Shift"
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#1e2a38" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                position="top-right"
                nodeColor="#1f3b52"
                maskColor="rgba(6,10,16,.72)"
                style={{ background: '#0b1220' }}
              />
            </ReactFlow>

            <Timeline
              nodes={shownNodes}
              activeId={selId}
              charImages={charImages}
              onPick={pickShot}
              onPatch={patch}
              onReorder={reorderShot}
            />
          </div>

          <Inspector
            node={selected}
            patch={patch}
            onDelete={removeShot}
            onReset={resetAll}
            onGenerate={generateOne}
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
            onVoice={generateVoiceOne}
            voices={voices}
            voiceProvider={voiceProvider}
          />
        </main>
        )}

        {preview && (
          <Preview
            nodes={nodes}
            startId={selId}
            onClose={() => setPreview(false)}
            onPick={pickShot}
            assReady={assReady}
            epNo={epNo}
            onEpChange={setEpNo}
          />
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </CanvasCtx.Provider>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
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
