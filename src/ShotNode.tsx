import { useContext, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Stage, Layer, Image as KImage, Line, Rect as KRect, Group } from 'react-konva'
import type Konva from 'konva'
import { CanvasCtx } from './ctx'
import { cardWidth, uid, type Mark } from './types'
import type { ShotNodeType } from './data'

type Draft =
  | { kind: 'pen'; points: number[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | null

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!src) {
      setImg(null)
      return
    }
    let alive = true
    const i = new window.Image()
    i.onload = () => {
      if (alive) setImg(i)
    }
    i.src = src
    return () => {
      alive = false
    }
  }, [src])
  return img
}

export default function ShotNode({ id, data, selected }: NodeProps<ShotNodeType>) {
  const { tool, guides, color, patch, generate, generateVideo } = useContext(CanvasCtx)
  const img = useImage(data.refImage)
  const [draft, setDraft] = useState<Draft>(null)
  const [showVideo, setShowVideo] = useState(true)
  const [vidDur, setVidDur] = useState(0)
  const origin = useRef({ x: 0, y: 0 })
  const lastPt = useRef({ x: 0, y: 0 })

  /** 卡片宽度随镜头时长变化，画面固定 16:9 */
  const cardW = cardWidth(data.seconds)
  const W = cardW - 16
  const H = Math.round((W * 9) / 16)

  /** 归一化坐标（0..1），卡片宽度变化 / 画幅变化都不影响标注 */
  const pos = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return null
    const rect = stage.container().getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: (e.evt.clientX - rect.left) / rect.width,
      y: (e.evt.clientY - rect.top) / rect.height,
    }
  }

  const down = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'none') return
    const p = pos(e)
    if (!p) return
    origin.current = p
    lastPt.current = p
    if (tool === 'pen') setDraft({ kind: 'pen', points: [p.x, p.y, p.x + 0.0001, p.y + 0.0001] })
    else setDraft({ kind: 'rect', x: p.x, y: p.y, w: 0, h: 0 })
  }

  const move = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draft) return
    const p = pos(e)
    if (!p) return
    if (draft.kind === 'pen') {
      const dx = (p.x - lastPt.current.x) * W
      const dy = (p.y - lastPt.current.y) * H
      if (dx * dx + dy * dy < 4) return
      lastPt.current = p
      setDraft((d) => (d && d.kind === 'pen' ? { ...d, points: [...d.points, p.x, p.y] } : d))
      e.evt.preventDefault()
    } else {
      setDraft((d) =>
        d && d.kind === 'rect' ? { ...d, w: p.x - origin.current.x, h: p.y - origin.current.y } : d,
      )
    }
  }

  const finish = () => {
    if (!draft) return
    const marks = data.marks
    if (draft.kind === 'pen' && draft.points.length >= 6) {
      const m: Mark = { id: uid(), kind: 'pen', color, points: draft.points }
      patch(id, { marks: [...marks, m] })
    } else if (draft.kind === 'rect' && Math.abs(draft.w) > 0.025 && Math.abs(draft.h) > 0.025) {
      const x = Math.min(draft.x, draft.x + draft.w)
      const y = Math.min(draft.y, draft.y + draft.h)
      const m: Mark = {
        id: uid(),
        kind: 'rect',
        color,
        x,
        y,
        w: Math.abs(draft.w),
        h: Math.abs(draft.h),
      }
      patch(id, { marks: [...marks, m] })
    }
    setDraft(null)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () =>
      patch(id, {
        refImage: String(reader.result),
        candidates: undefined,
        activeIdx: 0,
        videoUrl: undefined,
        vidState: 'idle',
      })
    reader.readAsDataURL(file)
  }

  const candidates = data.candidates ?? []
  const activeIdx = data.activeIdx ?? 0
  const hasVideo = Boolean(data.videoUrl)
  /** 配音比镜头长 → 成片会被截断 */
  const voiceOver = (data.voiceSeconds ?? 0) > data.seconds + 0.2
  const vidRunning = data.vidState === 'running'

  // 出片期间每秒重算已等待时长
  const [, tick] = useState(0)
  useEffect(() => {
    if (!vidRunning) return
    const t = window.setInterval(() => tick((v) => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [vidRunning])
  const vidSecs = data.vidAt ? Math.max(0, Math.round((Date.now() - data.vidAt) / 1000)) : 0

  return (
    <div
      className={`shot ${selected ? 'is-selected' : ''}`}
      style={{ width: cardW }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="shot-head">
        <span className="shot-no">{data.no}</span>
        <span className="shot-dur">{data.seconds.toFixed(1)}s</span>
        <span className="shot-meta">
          {data.size} · {data.move}
        </span>
        <button
          className="shot-gen nodrag"
          title="用这条提示词生成画面"
          disabled={data.genState === 'running'}
          onClick={(e) => {
            e.stopPropagation()
            generate(id)
          }}
        >
          {data.genState === 'running' ? '…' : '生成'}
        </button>
        {data.marks.length > 0 && (
          <button
            className="shot-clear nodrag"
            title="清除构图标注"
            onClick={(e) => {
              e.stopPropagation()
              patch(id, { marks: [] })
            }}
          >
            清 {data.marks.length}
          </button>
        )}
      </div>

      {/* drawing 时加 nodrag/nowheel，让 Konva 吃掉鼠标事件；否则穿透给 React Flow 拖动节点 */}
      <div
        className={`stage-wrap ${tool !== 'none' ? 'drawing nodrag nowheel' : ''}`}
        style={{ width: W, height: H }}
      >
        <Stage
          width={W}
          height={H}
          pixelRatio={2}
          listening={tool !== 'none'}
          onMouseDown={down}
          onMouseMove={move}
          onMouseUp={finish}
          onMouseLeave={finish}
        >
          <Layer>
            {img ? (
              <KImage
                image={img}
                {...(() => {
                  const s = Math.max(W / img.width, H / img.height)
                  const dw = img.width * s
                  const dh = img.height * s
                  return { x: (W - dw) / 2, y: (H - dh) / 2, width: dw, height: dh }
                })()}
              />
            ) : (
              <KRect x={0} y={0} width={W} height={H} fill="#0b1220" />
            )}

            {/* 三分线 + 安全框 */}
            {guides && (
              <Group listening={false} opacity={0.5}>
                <Line points={[W / 3, 0, W / 3, H]} stroke="#ffffff" strokeWidth={0.7} dash={[4, 4]} />
                <Line points={[(W * 2) / 3, 0, (W * 2) / 3, H]} stroke="#ffffff" strokeWidth={0.7} dash={[4, 4]} />
                <Line points={[0, H / 3, W, H / 3]} stroke="#ffffff" strokeWidth={0.7} dash={[4, 4]} />
                <Line points={[0, (H * 2) / 3, W, (H * 2) / 3]} stroke="#ffffff" strokeWidth={0.7} dash={[4, 4]} />
                <KRect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} stroke="#ffffff" strokeWidth={0.8} opacity={0.4} />
              </Group>
            )}

            {/* 已提交的标注（归一化 → 像素） */}
            <Group listening={false}>
              {data.marks.map((m) =>
                m.kind === 'pen' ? (
                  <Line
                    key={m.id}
                    points={(m.points ?? []).map((v, i) => (i % 2 === 0 ? v * W : v * H))}
                    stroke={m.color}
                    strokeWidth={2}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.35}
                    shadowColor={m.color}
                    shadowBlur={6}
                    shadowOpacity={0.5}
                  />
                ) : (
                  <KRect
                    key={m.id}
                    x={(m.x ?? 0) * W}
                    y={(m.y ?? 0) * H}
                    width={(m.w ?? 0) * W}
                    height={(m.h ?? 0) * H}
                    stroke={m.color}
                    strokeWidth={2}
                    dash={[7, 5]}
                    shadowColor={m.color}
                    shadowBlur={6}
                    shadowOpacity={0.5}
                  />
                ),
              )}
            </Group>

            {/* 正在画的笔画 */}
            <Group listening={false}>
              {draft?.kind === 'pen' && (
                <Line
                  points={draft.points.map((v, i) => (i % 2 === 0 ? v * W : v * H))}
                  stroke={color}
                  strokeWidth={2}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.35}
                />
              )}
              {draft?.kind === 'rect' && (
                <KRect
                  x={Math.min(draft.x, draft.x + draft.w) * W}
                  y={Math.min(draft.y, draft.y + draft.h) * H}
                  width={Math.abs(draft.w) * W}
                  height={Math.abs(draft.h) * H}
                  stroke={color}
                  strokeWidth={2}
                  dash={[7, 5]}
                />
              )}
            </Group>
          </Layer>
        </Stage>

        {/* 出片后视频盖在静帧上播放，Konva 的标注层留在下面 */}
        {hasVideo && showVideo && (
          <video
            className="vid-preview"
            src={data.videoUrl}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setVidDur(e.currentTarget.duration || 0)}
          />
        )}

        {hasVideo && (
          <div className="vid-bar nodrag nowheel">
            <span className="vid-tag">▶ {(vidDur > 0 ? vidDur : data.seconds).toFixed(1)}s</span>
            <button
              className="vid-btn"
              onClick={(e) => {
                e.stopPropagation()
                setShowVideo((v) => !v)
              }}
            >
              {showVideo ? '看静帧' : '看视频'}
            </button>
          </div>
        )}

        {data.genState === 'running' && (
          <div className="gen-overlay">
            <span className="spinner" />
            生成中
          </div>
        )}
        {vidRunning && (
          <div className="gen-overlay vid">
            <span className="spinner" />
            出片中 {vidSecs}s
          </div>
        )}
        {data.genState === 'error' && (
          <div className="gen-error-badge" title={data.genError}>
            !
          </div>
        )}

        {candidates.length > 1 && (
          <div className="cand-bar nodrag nowheel">
            {candidates.map((c, i) => (
              <button
                key={c}
                className={`cand-dot ${i === activeIdx ? 'on' : ''}`}
                title={`候选 ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  patch(id, { activeIdx: i, refImage: c, videoUrl: undefined, vidState: 'idle' })
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shot-foot">
        <span className="shot-dialogue">{data.dialogue || '（无台词）'}</span>
        {candidates.length > 1 && (
          <span className="shot-cand-count">
            {activeIdx + 1}/{candidates.length}
          </span>
        )}
        {data.voiceUrl && (
          <span
            className={`shot-voice ${voiceOver ? 'over' : ''}`}
            title={
              voiceOver
                ? `配音 ${(data.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 ${data.seconds.toFixed(1)}s，会被截断`
                : `配音 ${(data.voiceSeconds ?? 0).toFixed(1)}s`
            }
          >
            {voiceOver ? '♪⚠' : '♪'}
          </span>
        )}
        <button
          className={`shot-vid nodrag ${hasVideo ? 'has' : ''}`}
          title={
            data.refImage
              ? '以当前画面为首帧生成动态视频（Seedance 图生视频）'
              : '先生成画面，才能出片'
          }
          disabled={vidRunning || !data.refImage}
          onClick={(e) => {
            e.stopPropagation()
            generateVideo(id)
          }}
        >
          {vidRunning ? '出片中' : hasVideo ? '重出片' : '出片'}
        </button>
      </div>

      {data.vidState === 'error' && data.vidError && (
        <div className="vid-error">{data.vidError}</div>
      )}

      <Handle type="target" position={Position.Left} className="shot-handle" />
      <Handle type="source" position={Position.Right} className="shot-handle" />
    </div>
  )
}
