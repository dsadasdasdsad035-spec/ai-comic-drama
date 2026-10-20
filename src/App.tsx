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
} from '@xyflow/react'

import '@xyflow/react/dist/style.css'
import './theme.css'

import ShotNode from './ShotNode'
import ShotEdge from './ShotEdge'
import Inspector from './Inspector'
import Timeline from './Timeline'
import CharacterBoard from './CharacterBoard'
import Preview from './Preview'
import ShotTable from './ShotTable'
import { defaultCharacters, type CharacterSheet } from './characters'
import { CanvasCtx } from './ctx'
import { initialEdges, initialNodes, type ShotEdgeType, type ShotNodeType } from './data'
import { cardWidth, migrateMarks, uid, type Relation, type ShotData, type Tool } from './types'
import {
  checkHealth,
  generateImage,
  generateVoice,
  listVoices,
  mergeProjectShots,
  startVideo,
  waitVideo,
  type ProjectShot,
  type VoiceOption,
} from './api'
import { dialogueToText, parseDialogue } from './prompts'
import { COMPOSE_HINT, composeReference } from './compose'
import { bizSignature, nodeToShot, shotToData } from './shotSync'

const nodeTypes = { shot: ShotNode }
const edgeTypes = { shot: ShotEdge }

const COLORS = ['#fbbf24', '#f87171', '#38bdf8', '#a3e635', '#c084fc']
const STORAGE_KEY = 'storyboard-canvas-v1'

type Saved = {
  nodes: ShotNodeType[]
  edges: ShotEdgeType[]
  characters: CharacterSheet[]
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!Array.isArray(p?.nodes) || p.nodes.length === 0) return null
    return {
      nodes: p.nodes.map((n: ShotNodeType) => ({
        ...n,
        data: { ...n.data, marks: migrateMarks(n.data?.marks ?? []) },
      })),
      edges: p.edges ?? [],
      characters: Array.isArray(p.characters) ? p.characters : defaultCharacters,
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
  const [view, setView] = useState<'board' | 'chars' | 'table'>('board')
  const [projectName, setProjectName] = useState('')
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
  const [vidRes, setVidRes] = useState<'480p' | '720p'>('480p')
  const [preview, setPreview] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [assReady, setAssReady] = useState(false)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voiceProvider, setVoiceProvider] = useState('')
  const { fitView, setCenter, getZoom } = useReactFlow()
  /** 上次同步到 project.json 的业务字段快照：只有之后的改动才写回 */
  const syncedRef = useRef<Map<string, string>>(new Map())

  const nodesRef = useRef(nodes)
  const voicesRef = useRef<VoiceOption[]>([])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

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
      const order: Relation[] = ['cut', 'transition', 'flashback']
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

  /** 画布上已有的业务 ID，给工作台标「在画布」 */
  const onCanvasIds = useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) if (n.data.shotId) s.add(n.data.shotId)
    return s
  }, [nodes])

  /** 工作台 → 画布：按 shot.id 幂等推送，本次没推到的旧节点只标灰不删 */
  const pushShotsToCanvas = useCallback(
    (shots: ProjectShot[]) => {
      setNodes((prev) => {
        const byShot = new Map<string, ShotNodeType>()
        for (const n of prev) if (n.data.shotId) byShot.set(n.data.shotId, n)
        const incoming = new Set(shots.map((s) => s.id))

        const next: ShotNodeType[] = shots.map((s, i) => {
          const old = byShot.get(s.id)
          const base: ShotData = old?.data ?? {
            no: s.no ?? `S${String(i + 1).padStart(2, '0')}`,
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
            position: old?.position ?? { x: i * 380, y: i % 2 === 0 ? 0 : 96 },
            data: shotToData(s, base),
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
            marks: [],
          }),
        )
      }
      syncedRef.current = snap
      setToast(`已推送 ${shots.length} 镜到画布`)
      window.setTimeout(() => setToast(''), 2200)
      window.setTimeout(() => fitView({ padding: 0.2, minZoom: 0.55, duration: 400 }), 80)
    },
    [setNodes, fitView],
  )

  /**
   * 画布侧改动 → 写回 project.json。
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
      } catch (e) {
        patch(id, { vidState: 'error', vidError: (e as Error).message, vidAt: undefined })
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
      try {
        const r = await generateVoice({
          text,
          voice: pick.id,
          rate: node.data.voiceRate ?? 180,
        })
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
      await generateVoiceOne(n.id)
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
      await generateOne(n.id)
      setBatch((b) => (b ? { ...b, done: b.done + 1 } : b))
      await new Promise((r) => setTimeout(r, 350))
    }
    setBatch(null)
  }

  const pickShot = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    setSelId(id)
    setCenter(n.position.x + cardWidth(n.data.seconds) / 2, n.position.y + 100, {
      zoom: Math.max(0.7, getZoom()),
      duration: 420,
    })
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, characters }))
      } catch {
        /* 图片过大超出配额时静默失败，不影响使用 */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [nodes, edges, characters])

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
    () => ({ tool, guides, color, patch, cycleEdge, generate: generateOne, generateVideo: generateVideoOne }),
    [tool, guides, color, patch, cycleEdge, generateOne, generateVideoOne],
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
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
              分镜
            </button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
              拆镜
            </button>
            <button className={view === 'chars' ? 'on' : ''} onClick={() => setView('chars')}>
              角色
            </button>
          </div>

          {view === 'board' && (
            <>
              <div className="tools">
                <button className={tool === 'none' ? 'on' : ''} onClick={() => setTool('none')} title="选择 (V)">选择</button>
                <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="画笔 (P)">画笔</button>
                <button className={tool === 'rect' ? 'on' : ''} onClick={() => setTool('rect')} title="框选 (R)">框选</button>
              </div>

              <div className="swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  />
                ))}
              </div>

              <label className="toggle">
                <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
                三分线 <kbd>G</kbd>
              </label>

              <div className="tools">
                <span className="label">新连线</span>
                <select value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
                  <option value="cut">硬切</option>
                  <option value="transition">转场</option>
                  <option value="flashback">闪回</option>
                </select>
              </div>
            </>
          )}

          <div className="spacer" />

          {hasKey === false && (
            <span className="warn-chip" title="未在 ~/.canghe-skills/.env 找到 ARK_API_KEY">
              未配置密钥
            </span>
          )}
          {view === 'board' ? (
            <>
              <button className="btn" onClick={addShot}>+ 镜头</button>
              <button
                className="btn"
                onClick={generateAll}
                disabled={!!batch || hasKey === false}
                title="按顺序逐镜生成画面（约 ¥0.22/张）"
              >
                {batch ? `生成中 ${batch.done}/${batch.total}` : '批量生成'}
              </button>
              <button
                className="btn"
                onClick={voiceAll}
                disabled={!!vbatch}
                title="为所有带台词的镜头生成配音（当前引擎：macOS TTS）"
              >
                {vbatch ? `配音 ${vbatch.done}/${vbatch.total}` : '批量配音'}
              </button>
              <button className="btn" onClick={() => fitView({ padding: 0.2, duration: 400 })}>适配</button>
              <button
                className="btn"
                onClick={() => setPreview(true)}
                title="按时间尺顺序连播：有视频放视频，没视频按镜头时长定格"
              >
                ▶ 连播
              </button>
            </>
          ) : view === 'table' ? (
            <span className="board-count">{projectName || '未选项目'}</span>
          ) : (
            <span className="board-count">{characters.length} 个角色</span>
          )}
          <button className="btn primary" onClick={exportJson}>导出 JSON</button>
        </header>

        {view === 'table' ? (
          <ShotTable
            projectName={projectName}
            setProjectName={setProjectName}
            onCanvas={onCanvasIds}
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
          />
        ) : (
        <main className="main">
          <div className="canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, n) => setSelId(n.id)}
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
              <Panel position="bottom-center">
                <Timeline nodes={nodes} activeId={selId} onPick={pickShot} />
              </Panel>
            </ReactFlow>
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
