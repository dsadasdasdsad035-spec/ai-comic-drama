import { useCallback, useMemo, useRef, useState } from 'react'
import type { ShotEdgeType, ShotNodeType } from './data'
import type { ShotData } from './types'
import { buildEditList } from './editList'
import { activeVideoUrl } from './lipSync'
import { buildShotCaptions, type CaptionCue } from './captions'

type Props = {
  nodes: ShotNodeType[]
  edges: ShotEdgeType[]
  activeId: string | null
  /** 角色名 → 头像图，角色轨用 */
  charImages?: Record<string, string>
  onPick: (id: string) => void
  onPatch: (id: string, p: Partial<ShotData>) => void
  /** 点转场块打开转场面板 */
  onOpenTransition?: (edgeId: string) => void
}

type Kind = 'voice' | 'sub'

type Clip = {
  id: string
  no: string
  /** 绝对起点（秒），由镜号顺序累加得来 */
  start: number
  dur: number
  hasVideo: boolean
  hasImage: boolean
  voiceUrl?: string
  voiceSec: number
  voiceOffset: number
  subOffset: number
  dialogue: string
  captions: CaptionCue[]
  cast: string
  hasPrompt: boolean
  size: string
  move: string
}

const TRACK_H = 24
const MIN_ZOOM = 12
const MAX_ZOOM = 160

/** 时间 → 像素 */
const px = (sec: number, zoom: number) => sec * zoom
/** 吸附到 0.1s，避免拖出 0.033333 这种脏值 */
const snap = (sec: number) => Math.round(sec * 10) / 10

export default function Timeline({
  nodes,
  edges,
  activeId,
  charImages = {},
  onPick,
  onPatch,
  onOpenTransition,
}: Props) {
  const [zoom, setZoom] = useState(40)
  // 常驻 186px 会吃掉画布视野，允许收起
  const [open, setOpen] = useState(true)
  /** 拖动中的实时位移（只用于渲染，不写数据） */
  const [live, setLive] = useState<{ id: string; kind: Kind; dx: number } | null>(null)
  const dragRef = useRef<{ id: string; kind: Kind; x0: number } | null>(null)

  /** 唯一剪辑序列：效果转场重叠、生成转场插入，起点不再原地累加 */
  const edit = useMemo(() => buildEditList(nodes, edges), [nodes, edges])
  const clips: Clip[] = useMemo(
    () =>
      edit.items
        .filter((x) => x.kind === 'shot' && x.node)
        .map((x) => {
          const d = x.node!.data
          return {
            id: x.node!.id,
            no: String(d.no),
            start: Math.round(x.start * 100) / 100,
            dur: x.duration,
            hasVideo: Boolean(activeVideoUrl(d)),
            hasImage: Boolean(d.refImage),
            voiceUrl: d.voiceUrl,
            voiceSec: Number(d.voiceSeconds) || 0,
            voiceOffset: Number(d.voiceOffset) || 0,
            subOffset: Number(d.subOffset) || 0,
            dialogue: String(d.dialogue || ''),
            captions: buildShotCaptions({
              shotId: x.node!.id,
              dialogue: String(d.dialogue || ''),
              shotSeconds: x.duration,
              voiceSeconds: Number(d.voiceSeconds) || 0,
              voiceOffset: Number(d.voiceOffset) || 0,
              subOffset: Number(d.subOffset) || 0,
              audioMode: d.audioMode === 'native' ? 'native' : 'off',
            }),
            cast: (d.cast ?? []).join('、'),
            hasPrompt: Boolean(String(d.prompt || '').trim()),
            size: String(d.size || ''),
            move: String(d.move || ''),
          }
        }),
    [edit],
  )
  const transitionItems = useMemo(
    () => edit.items.filter((x) => x.kind === 'transition'),
    [edit],
  )
  const fades = useMemo(
    () =>
      edit.items
        .filter((x) => x.kind === 'shot' && x.joinIn.kind === 'effect')
        .map((x) => ({ id: x.id, start: x.start, join: x.joinIn })),
    [edit],
  )

  const total = edit.total
  const width = Math.max(320, px(total, zoom))

  const ticks = useMemo(() => {
    const step = zoom >= 80 ? 1 : zoom >= 40 ? 2 : zoom >= 20 ? 5 : 10
    const out: number[] = []
    for (let t = 0; t <= total + step; t += step) out.push(t)
    return out
  }, [total, zoom])

  const overflow = useMemo(
    () => clips.filter((c) => c.voiceUrl && c.voiceSec > c.dur + 0.2).length,
    [clips],
  )

  const startDrag = (e: React.PointerEvent, clip: Clip, kind: Kind) => {
    e.stopPropagation()
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 指针捕获不可用时仍按旧行为拖动 */
    }
    dragRef.current = { id: clip.id, kind, x0: e.clientX }
    setLive({ id: clip.id, kind, dx: 0 })
    onPick(clip.id)
  }

  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setLive({ id: d.id, kind: d.kind, dx: e.clientX - d.x0 })
  }

  const endDrag = useCallback(() => {
    const d = dragRef.current
    const cur = live
    dragRef.current = null
    setLive(null)
    if (!d || !cur) return

    const deltaSec = snap(cur.dx / zoom)
    const clip = clips.find((c) => c.id === d.id)
    if (!clip || Math.abs(deltaSec) < 0.1) return

    if (d.kind === 'voice') {
      // 允许负偏移（台词提前），但不能跑到 0 之前
      const next = Math.max(-clip.start, snap(clip.voiceOffset + deltaSec))
      onPatch(clip.id, { voiceOffset: next })
    } else {
      const next = Math.max(-clip.start, snap(clip.subOffset + deltaSec))
      onPatch(clip.id, { subOffset: next })
    }
  }, [live, clips, zoom, onPatch])

  if (clips.length === 0) return null

  return (
    <div className={`ntl ${open ? '' : 'collapsed'}`}>
      <div className="ntl-head">
        <button
          className="btn-mini"
          onClick={() => setOpen((v) => !v)}
          title={open ? '收起时间线' : '展开时间线'}
        >
          {open ? '▾' : '▸'}
        </button>
        <b>时间线</b>
        <span className="ntl-sum">
          {clips.length} 镜{edit.transitions ? ` · ${edit.transitions} 转场` : ''} · <b>{total.toFixed(1)}s</b>
        </span>
        <span className="ntl-order" title="播放顺序按镜号，拖动不改顺序">按镜号</span>
        {overflow > 0 && <span className="ntl-warn">{overflow} 条配音超出镜头</span>}
        {edit.inactive.length > 0 && (
          <span className="ntl-warn">{edit.inactive.length} 条转场未参与</span>
        )}
        <div className="spacer" />
        <button
          className="btn-mini"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round(z / 1.5)))}
          title="缩小"
        >
          −
        </button>
        <span className="ntl-zoom">{zoom}px/s</span>
        <button
          className="btn-mini"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round(z * 1.5)))}
          title="放大"
        >
          +
        </button>
      </div>

      {open && <div className="ntl-body">
        <div className="ntl-labels">
          <div className="ntl-ruler-gap" />
          {['画面', '配音', '字幕', '角色', '提示词'].map((t) => (
            <div key={t} className="ntl-label" style={{ height: TRACK_H }}>
              {t}
            </div>
          ))}
        </div>

        <div className="ntl-scroll">
          <div className="ntl-canvas" style={{ width }}>
            <div className="ntl-ruler">
              {ticks.map((t) => (
                <span key={t} className="ntl-tick" style={{ left: px(t, zoom) }}>
                  {t}s
                </span>
              ))}
            </div>

            {/* 画面轨：视频蓝 / 静帧灰 / 空 */}
            <div className="ntl-track" style={{ height: TRACK_H }}>
              {clips.map((c) => (
                <button
                  key={c.id}
                  className={`ntl-clip pic ${c.hasVideo ? 'vid' : c.hasImage ? 'img' : 'empty'} ${
                    activeId === c.id ? 'on' : ''
                  }`}
                  style={{ left: px(c.start, zoom), width: Math.max(18, px(c.dur, zoom)) }}
                  onClick={() => onPick(c.id)}
                  title={`${c.no} · ${c.dur}s · ${c.size} ${c.move}（播放顺序按镜号）`}
                >
                  <span className="ntl-clip-t">{c.no}</span>
                </button>
              ))}
              {fades.map((f) => {
                const j = f.join
                return j.kind === 'effect' ? (
                  <button
                    key={`fade-${f.id}`}
                    className="ntl-xfade"
                    style={{
                      left: px(f.start, zoom),
                      width: Math.max(6, px(j.seconds, zoom)),
                    }}
                    onClick={() => j.edgeId && onOpenTransition?.(j.edgeId)}
                    title={`效果转场 ${j.xfade} · ${j.seconds.toFixed(1)}s`}
                  />
                ) : null
              })}
              {transitionItems.map((t) => (
                <button
                  key={t.id}
                  className={`ntl-clip transition ${t.stale ? 'stale' : ''}`}
                  style={{
                    left: px(t.start, zoom),
                    width: Math.max(18, px(t.duration, zoom)),
                  }}
                  onClick={() => t.edgeId && onOpenTransition?.(t.edgeId)}
                  title={`生成转场 ${t.duration.toFixed(1)}s${t.stale ? ' · 需重生成' : ''}`}
                >
                  <span className="ntl-clip-t">转场</span>
                </button>
              ))}
            </div>

            {/* 配音轨：宽度是音频真实时长，可左右拖改偏移 */}
            <div className="ntl-track" style={{ height: TRACK_H }}>
              {clips
                .filter((c) => c.voiceUrl)
                .map((c) => {
                  const shift = live?.kind === 'voice' && live.id === c.id ? live.dx : 0
                  return (
                    <button
                      key={c.id}
                      className={`ntl-clip voice ${c.voiceSec > c.dur + 0.2 ? 'over' : ''} ${
                        activeId === c.id ? 'on' : ''
                      }`}
                      style={{
                        left: px(Math.max(0, c.start + c.voiceOffset), zoom) + shift,
                        width: Math.max(14, px(c.voiceSec || 1, zoom)),
                      }}
                      onPointerDown={(e) => startDrag(e, c, 'voice')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      title={`${c.no} 配音 ${c.voiceSec.toFixed(1)}s${
                        c.voiceOffset ? ` · 偏移 ${c.voiceOffset}s` : ''
                      }（左右拖动改偏移）`}
                    >
                      <span className="ntl-clip-t">{c.voiceSec.toFixed(1)}s</span>
                    </button>
                  )
                })}
            </div>

            {/* 字幕轨：每条 cue 一个块；拖动仍作为整镜 subOffset */}
            <div className="ntl-track" style={{ height: TRACK_H }}>
              {clips.flatMap((c) =>
                c.captions.map((cue, cueIndex) => {
                  const shift = live?.kind === 'sub' && live.id === c.id ? live.dx : 0
                  return (
                    <button
                      key={`${c.id}-cue-${cueIndex}`}
                      className={`ntl-clip sub ${activeId === c.id ? 'on' : ''} ${
                        cue.estimated ? 'estimated' : ''
                      }`}
                      style={{
                        left: px(Math.max(0, c.start + cue.startOffsetMs / 1000), zoom) + shift,
                        width: Math.max(
                          14,
                          px((cue.endOffsetMs - cue.startOffsetMs) / 1000, zoom),
                        ),
                      }}
                      onPointerDown={(e) => startDrag(e, c, 'sub')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      title={`${cue.text}${cue.speaker ? ` · ${cue.speaker}` : ''}${
                        cue.estimated ? ' · 估算' : ''
                      }（左右拖动改整镜字幕偏移）`}
                    >
                      <span className="ntl-clip-t">{cue.text.slice(0, 16)}</span>
                    </button>
                  )
                }),
              )}
            </div>

            {/* 角色轨：只读，有头像显示头像，无图退回名字 */}
            <div className="ntl-track info" style={{ height: TRACK_H }}>
              {clips
                .filter((c) => c.cast)
                .map((c) => (
                  <span
                    key={c.id}
                    className="ntl-chip cast"
                    style={{ left: px(c.start, zoom), width: Math.max(24, px(c.dur, zoom)) }}
                    title={`${c.no} 出场：${c.cast}`}
                  >
                    {c.cast.split('、').map((name) =>
                      charImages[name] ? (
                        <img key={name} src={charImages[name]} alt={name} draggable={false} />
                      ) : (
                        <i key={name}>{name}</i>
                      ),
                    )}
                  </span>
                ))}
            </div>

            {/* 提示词轨：有/无标记 */}
            <div className="ntl-track info" style={{ height: TRACK_H }}>
              {clips.map((c) => (
                <span
                  key={c.id}
                  className={`ntl-mark ${c.hasPrompt ? 'has' : ''}`}
                  style={{ left: px(c.start, zoom) }}
                  title={c.hasPrompt ? `${c.no} 有首帧提示词` : `${c.no} 缺首帧提示词`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>}
    </div>
  )
}
