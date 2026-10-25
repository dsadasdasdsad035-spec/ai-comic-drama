import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShotEdgeType, ShotNodeType } from './data'
import { assembleAnimatic, type ExportJoin, type ExportSegment } from './api'
import { EXPORT_SIZES, renderSubtitlePng } from './subtitles'
import { buildEditList, type EditJoin } from './editList'
import type { TransitionEffect } from './types'
import { activeVideoUrl } from './lipSync'
import {
  buildShotCaptions,
  CAPTION_STYLE,
  validateCaptions,
  type CaptionCue,
  type CaptionIssue,
} from './captions'

type Item = {
  id: string
  no: string
  kind: 'shot' | 'transition'
  /** 名义镜头时长 */
  seconds: number
  duration: number
  start: number
  end: number
  node?: ShotNodeType
  src?: string
  isVideo: boolean
  /** 生成转场只取前 N 秒 */
  trim?: number
  stale?: boolean
  dialogue: string
  size: string
  move: string
  audio: 'tts' | 'native' | 'none'
  voice?: string
  voiceSeconds: number
  voiceOffset: number
  joinIn: EditJoin
  captions: CaptionCue[]
  /** 到下一个条目的接缝（用于预览近似提示） */
  joinOut?: { kind: 'effect'; effect: TransitionEffect; seconds: number; xfade: string }
}

/**
 * 分镜顺序 = 节点数组顺序；接缝由 buildEditList 统一给出。
 * 生成转场作为独立条目进入播放列表，效果转场以 joinOut 表示。
 */
export function buildPlaylist(nodes: ShotNodeType[], edges: ShotEdgeType[] = []): Item[] {
  const list = buildEditList(nodes, edges)
  const items: Item[] = list.items.map((x) => {
    if (x.kind === 'transition') {
      return {
        id: x.id,
        no: '转场',
        kind: 'transition',
        seconds: x.duration,
        duration: x.duration,
        start: x.start,
        end: x.end,
        src: x.media,
        isVideo: true,
        ...(x.trimTo ? { trim: x.trimTo } : {}),
        ...(x.stale ? { stale: true } : {}),
        dialogue: '',
        size: '',
        move: '',
        audio: 'none',
        voiceSeconds: 0,
        voiceOffset: 0,
        joinIn: x.joinIn,
        captions: [],
      }
    }
    const n = x.node!
    const video = activeVideoUrl(n.data)
    const audio = n.data.audioMode === 'native' ? 'native' : n.data.voiceUrl ? 'tts' : 'none'
    return {
      id: n.id,
      no: n.data.no,
      kind: 'shot',
      seconds: n.data.seconds,
      duration: x.duration,
      start: x.start,
      end: x.end,
      node: n,
      src: video || n.data.refImage,
      isVideo: Boolean(video),
      dialogue: n.data.dialogue,
      size: n.data.size,
      move: n.data.move,
      audio,
      voice: audio === 'tts' ? n.data.voiceUrl : undefined,
      voiceSeconds: Number(n.data.voiceSeconds) || 0,
      voiceOffset: Number(n.data.voiceOffset) || 0,
      joinIn: x.joinIn,
      captions: buildShotCaptions({
        shotId: n.id,
        dialogue: n.data.dialogue,
        shotSeconds: x.duration,
        voiceSeconds: Number(n.data.voiceSeconds) || 0,
        voiceOffset: Number(n.data.voiceOffset) || 0,
        subOffset: Number(n.data.subOffset) || 0,
        audioMode: n.data.audioMode === 'native' ? 'native' : 'off',
      }),
    }
  })
  for (let i = 0; i < items.length - 1; i++) {
    const j = items[i + 1].joinIn
    if (j.kind === 'effect') {
      items[i].joinOut = {
        kind: 'effect',
        effect: j.effect,
        seconds: j.seconds,
        xfade: j.xfade,
      }
    }
  }
  return items
}

/** 视频元数据到达后，用真实片长重算每个条目的起点/总长 */
function layoutItems(items: Item[], durFix: Record<string, number>): Item[] {
  let cursor = 0
  return items.map((item, index) => {
    const fixed = durFix[item.id]
    const duration = Math.max(
      0.2,
      item.kind === 'transition'
        ? (item.trim ?? fixed ?? item.duration)
        : (fixed ?? item.duration),
    )
    const join = item.joinIn.kind === 'effect' ? item.joinIn.seconds : 0
    const start = index === 0 ? 0 : Math.max(0, cursor - join)
    const end = start + duration
    cursor = end
    const captions =
      item.kind === 'shot' && item.node
        ? buildShotCaptions({
            shotId: item.id,
            dialogue: item.node.data.dialogue,
            shotSeconds: duration,
            voiceSeconds: Number(item.node.data.voiceSeconds) || 0,
            voiceOffset: Number(item.node.data.voiceOffset) || 0,
            subOffset: Number(item.node.data.subOffset) || 0,
            audioMode: item.node.data.audioMode === 'native' ? 'native' : 'off',
          })
        : []
    return { ...item, duration, start, end, captions }
  })
}

function fadeClass(effect: TransitionEffect): string {
  if (effect.type === 'wipe') return `pv-fade pv-fade-wipe-${effect.dir || 'left'}`
  if (effect.type === 'slide') return `pv-fade pv-fade-slide-${effect.dir || 'left'}`
  return 'pv-fade pv-fade-dissolve'
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** 点击分段/换镜时落到该段自己的可见区间，跳过入场的转场重叠 */
function itemStart(item: Item) {
  return item.start + (item.joinIn.kind === 'effect' ? item.joinIn.seconds : 0)
}

function activeAt(items: Item[], time: number): Item | null {
  const active = items.filter((item) => time >= item.start - 0.001 && time < item.end)
  return active[0] ?? items[items.length - 1] ?? null
}

export default function Preview({
  nodes,
  edges = [],
  startId,
  onClose,
  onPick,
  assReady,
  epNo,
  onEpChange,
}: {
  nodes: ShotNodeType[]
  edges?: ShotEdgeType[]
  startId?: string | null
  onClose: () => void
  onPick: (id: string) => void
  /** ffmpeg 是否带 libass 且检测到 CJK 字体（带则服务端走 SRT，前端无需渲 PNG） */
  assReady?: boolean
  /** 当前集：连播与导出都只处理这一集 */
  epNo: number
  onEpChange: (n: number) => void
}) {
  const epOf = useCallback((n: ShotNodeType) => Number(n.data.episode) || 1, [])
  const epList = useMemo(() => {
    const set = new Set(nodes.map(epOf))
    return [...set].sort((a, b) => a - b)
  }, [nodes, epOf])

  const epNodes = useMemo(() => nodes.filter((n) => epOf(n) === epNo), [nodes, epNo, epOf])
  const playlist = useMemo(() => buildPlaylist(epNodes, edges), [epNodes, edges])
  const [durFix, setDurFix] = useState<Record<string, number>>({})
  const items = useMemo(() => layoutItems(playlist, durFix), [playlist, durFix])
  const total = items.length ? items[items.length - 1].end : 0

  const startItem = useMemo(() => (startId ? items.find((item) => item.id === startId) : null), [items, startId])
  const [playhead, setPlayhead] = useState(() => (startItem ? itemStart(startItem) : 0))
  const playheadRef = useRef(playhead)
  const [paused, setPaused] = useState(false)
  const [ended, setEnded] = useState(false)
  const [seekNonce, setSeekNonce] = useState(0)

  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [captionPreviewOn, setCaptionPreviewOn] = useState(true)
  const [burnSubs, setBurnSubs] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const shellRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const mainVideoRef = useRef<HTMLVideoElement>(null)
  const overlayVideoRef = useRef<HTMLVideoElement>(null)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const pickedRef = useRef<string | null>(null)
  const [stageHeight, setStageHeight] = useState(0)

  // 导出
  const [expRes, setExpRes] = useState<'480p' | '720p' | '1080p'>('720p')
  const [expBusy, setExpBusy] = useState(false)
  const [expStartedAt, setExpStartedAt] = useState(0)
  const [expElapsed, setExpElapsed] = useState(0)
  const [expUrl, setExpUrl] = useState('')
  const [expSrtUrl, setExpSrtUrl] = useState('')
  const [expMsg, setExpMsg] = useState('')
  const [expWarn, setExpWarn] = useState('')

  const activeItems = useMemo(
    () => items.filter((item) => playhead >= item.start - 0.001 && playhead < item.end),
    [items, playhead],
  )
  const current = activeItems[0] ?? items[items.length - 1] ?? null
  const incoming = activeItems.length > 1 ? activeItems[1] : null
  const nextItem = useMemo(() => {
    if (!current) return null
    const index = items.findIndex((item) => item.id === current.id)
    return index >= 0 ? items[index + 1] ?? null : null
  }, [items, current?.id])

  const activeCaption = useMemo(() => {
    const hits: { cue: CaptionCue; item: Item; start: number }[] = []
    for (const item of activeItems) {
      if (item.kind !== 'shot') continue
      for (const cue of item.captions) {
        const start = item.start + cue.startOffsetMs / 1000
        const end = item.start + cue.endOffsetMs / 1000
        if (playhead >= start && playhead < end) hits.push({ cue, item, start })
      }
    }
    hits.sort((a, b) => a.start - b.start)
    return hits[hits.length - 1]?.cue ?? null
  }, [activeItems, playhead])

  const seekTo = useCallback(
    (time: number) => {
      const next = clamp(time, 0, total)
      playheadRef.current = next
      setPlayhead(next)
      setEnded(next >= total - 0.01)
      setSeekNonce((n) => n + 1)
    },
    [total],
  )

  const togglePlay = useCallback(() => {
    if (ended) {
      seekTo(0)
      setPaused(false)
      return
    }
    setPaused((p) => !p)
  }, [ended, seekTo])

  const goPrev = useCallback(() => {
    const at = playheadRef.current
    const idx = items.findIndex((item) => at >= item.start && at < item.end)
    const prev = items[Math.max(0, idx - 1)]
    seekTo(prev ? itemStart(prev) : 0)
  }, [items, seekTo])

  const goNext = useCallback(() => {
    const at = playheadRef.current
    const idx = items.findIndex((item) => at >= item.start && at < item.end)
    const next = items[Math.min(items.length - 1, idx + 1)]
    seekTo(next ? itemStart(next) : total)
  }, [items, seekTo, total])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await shellRef.current?.requestFullscreen()
    } catch {
      /* 浏览器不允许全屏时保持普通窗口 */
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // 集切换：播放头归零并清掉上一集的真实时长缓存
  const epRef = useRef(epNo)
  useEffect(() => {
    if (epRef.current === epNo) return
    epRef.current = epNo
    setDurFix({})
    seekTo(0)
    setPaused(false)
  }, [epNo, seekTo])

  // 片长变化后夹住播放头
  useEffect(() => {
    if (playheadRef.current <= total) return
    playheadRef.current = total
    setPlayhead(total)
    setEnded(true)
  }, [total])

  // 单一 rAF 播放头；主项是视频时以视频 currentTime 为主，静帧按真实时间推进
  useEffect(() => {
    if (paused || ended || !items.length) return
    let raf = 0
    let last = performance.now()
    let uiLast = 0
    const tick = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const at = playheadRef.current
      const main = activeAt(items, at)
      let next = at + dt
      if (main?.isVideo && mainVideoRef.current) {
        const video = mainVideoRef.current
        if (video.readyState >= 2 && !video.paused) {
          next = main.start + Math.min(main.duration, video.currentTime || 0)
        } else {
          next = at
        }
      }
      if (next >= total) {
        playheadRef.current = total
        setPlayhead(total)
        setEnded(true)
        return
      }
      playheadRef.current = next
      if (now - uiLast > 33) {
        uiLast = now
        setPlayhead(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, ended, items, total])

  // 主视频播放/暂停与 seek
  useEffect(() => {
    const video = mainVideoRef.current
    if (!video || !current?.isVideo) return
    if (paused) video.pause()
    else if (video.paused) video.play().catch(() => {})
  }, [current?.id, paused])

  useEffect(() => {
    const video = mainVideoRef.current
    if (!video || !current?.isVideo) return
    const target = clamp(playhead - current.start, 0, current.duration)
    if (Math.abs(video.currentTime - target) > 0.12) video.currentTime = target
  }, [seekNonce, current?.id, current?.start, current?.duration])

  // 转场 overlay 视频同步
  useEffect(() => {
    const video = overlayVideoRef.current
    if (!video || !incoming?.isVideo) return
    const target = clamp(playhead - incoming.start, 0, incoming.duration)
    if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target
    if (paused) video.pause()
    else if (video.paused) video.play().catch(() => {})
  }, [seekNonce, incoming?.id, incoming?.start, incoming?.duration, paused, playhead])

  // 音频池：所有视频静音，TTS/native 音频按各自段起点调度
  useEffect(() => {
    for (const item of activeItems) {
      const audio = audioRefs.current[item.id]
      if (!audio) continue
      const offset = item.start + (item.audio === 'tts' ? Math.max(0, item.voiceOffset) : 0)
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.duration
      const target = clamp(playhead - offset, 0, duration)
      if (Math.abs(audio.currentTime - target) > 0.15) audio.currentTime = target
      audio.muted = muted
      audio.volume = volume
      if (paused || target >= duration - 0.02) audio.pause()
      else if (audio.paused) audio.play().catch(() => {})
    }
  }, [activeItems, playhead, paused, muted, volume])

  // 舞台高度用于字幕字号/安全区；ResizeObserver 保证拖宽后仍和导出比例一致
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height
      if (h) setStageHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 同步当前镜头到画布选择
  useEffect(() => {
    if (current?.kind !== 'shot') return
    if (pickedRef.current === current.id) return
    pickedRef.current = current.id
    onPick(current.id)
  }, [current?.id, current?.kind, onPick])

  // 模态焦点：打开聚焦播放，Tab 循环，关闭归还
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = shellRef.current
    root?.querySelector<HTMLElement>('[data-pv-play]')?.focus()
    return () => {
      try {
        previous?.focus?.()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const root = shellRef.current
    if (!root) return
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0)
    if (!nodes.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // 键盘：空格/方向键/Esc/M/F
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const k = e.key
      if (k === 'Escape') {
        // 全屏时 Esc 只退出全屏，不关闭连播
        if (document.fullscreenElement) {
          e.preventDefault()
          e.stopPropagation()
          void document.exitFullscreen().catch(() => {})
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (![' ', 'ArrowRight', 'ArrowLeft', 'm', 'M', 'f', 'F'].includes(k)) return
      e.preventDefault()
      e.stopPropagation()
      if (k === ' ') togglePlay()
      else if (k === 'ArrowRight') goNext()
      else if (k === 'ArrowLeft') goPrev()
      else if (k === 'm' || k === 'M') setMuted((v) => !v)
      else if (k === 'f' || k === 'F') void toggleFullscreen()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [goNext, goPrev, onClose, toggleFullscreen, togglePlay])

  useEffect(() => {
    if (!expBusy) return
    const timer = window.setInterval(() => setExpElapsed((Date.now() - expStartedAt) / 1000), 500)
    return () => window.clearInterval(timer)
  }, [expBusy, expStartedAt])

  const doExport = async () => {
    const [W, H] = EXPORT_SIZES[expRes]
    const segs: ExportSegment[] = []
    const joins: ExportJoin[] = []
    const issues: CaptionIssue[] = []
    let staleCount = 0
    for (const item of items) {
      if (!item.src) continue
      joins.push(
        item.joinIn.kind === 'effect'
          ? { mode: 'effect', seconds: item.joinIn.seconds, xfade: item.joinIn.xfade }
          : { mode: 'cut' },
      )
      if (item.kind === 'transition' && item.stale) staleCount++
      const seg: ExportSegment = item.isVideo
        ? {
            kind: item.kind,
            seconds: item.duration,
            video: item.src,
            ...(item.trim ? { trim: item.trim } : {}),
          }
        : { kind: item.kind, seconds: item.duration, image: item.src }
      if (item.kind === 'shot') {
        seg.audioMode = item.audio
        seg.voice = item.audio === 'tts' ? item.voice : undefined
        seg.voiceOffset = item.voiceOffset
        if (burnSubs) {
          issues.push(...validateCaptions(item.captions, item.duration))
          seg.captions = item.captions.map((cue) => {
            const base = {
              startOffsetMs: cue.startOffsetMs,
              endOffsetMs: cue.endOffsetMs,
              text: cue.text,
            }
            if (assReady) return base
            const png = renderSubtitlePng({
              width: W,
              height: H,
              text: cue.text,
              style: CAPTION_STYLE,
            })
            return png ? { ...base, sub: png } : base
          })
        }
      }
      segs.push(seg)
    }

    const errors = issues.filter((issue) => issue.level === 'error')
    if (errors.length) {
      setExpBusy(false)
      setExpUrl('')
      setExpSrtUrl('')
      setExpMsg(
        `字幕有 ${errors.length} 条错误，已阻止导出：` +
          errors.slice(0, 4).map((e) => e.message).join('；'),
      )
      return
    }
    const warnings = issues.filter((issue) => issue.level === 'warn')
    if (warnings.length) {
      const ok = window.confirm(
        `字幕有 ${warnings.length} 条警告：\n` +
          warnings.slice(0, 6).map((w) => w.message).join('\n') +
          '\n\n仍然导出？',
      )
      if (!ok) return
    }

    setExpBusy(true)
    setExpStartedAt(Date.now())
    setExpElapsed(0)
    setExpMsg('')
    setExpWarn('')
    setExpUrl('')
    setExpSrtUrl('')
    try {
      const result = await assembleAnimatic(segs, expRes, {
        joins,
        staleTransitions: staleCount,
        captionStyle: CAPTION_STYLE,
      })
      setExpUrl(result.url)
      setExpSrtUrl(result.srtUrl || '')
      setExpMsg(
        `${result.shots} 镜` +
          (result.transitions ? ` · ${result.transitions} 转场` : '') +
          ` · ${result.seconds.toFixed(1)}s` +
          (result.voiced ? ` · 配音 ${result.voiced} 镜` : ' · 无音轨') +
          (result.subbed ? ` · 字幕 ${result.subbed} 镜` : '') +
          (result.captions ? ` · ${result.captions} 条 cue` : '') +
          ` · 用时 ${(result.elapsed / 1000).toFixed(1)}s`,
      )
      const warns: string[] = []
      if (result.overflows.length > 0) {
        warns.push(
          `配音超长会被截断：${result.overflows
            .map((o) => `第 ${o.shot} 镜 配音 ${o.voice}s / 镜头 ${o.shotLen}s`)
            .join('，')}`,
        )
      }
      if (result.staleTransitions) warns.push(`${result.staleTransitions} 条生成转场已失效，建议重生成后再导出`)
      if (result.captionWarnings?.length) warns.push(...result.captionWarnings)
      if (warnings.length) warns.unshift(`${warnings.length} 条字幕警告已在导出前确认`)
      setExpWarn(warns.join('；'))
    } catch (e) {
      setExpMsg((e as Error).message)
    } finally {
      setExpBusy(false)
    }
  }

  if (!items.length) return null

  const audioLabel =
    current?.kind === 'shot'
      ? current.audio === 'tts'
        ? `TTS ${current.voiceSeconds.toFixed(1)}s`
        : current.audio === 'native'
          ? '原生音轨'
          : '无配音'
      : ''
  const captionLabel = captionPreviewOn
    ? activeCaption?.estimated
      ? '字幕 估算'
      : '字幕 开'
    : '字幕 关'
  const currentDur = current?.duration ?? 0
  const currentTimeInItem = current ? clamp(playhead - current.start, 0, currentDur) : 0
  const fadeSeconds = incoming && incoming.joinIn.kind === 'effect' ? incoming.joinIn.seconds : 0
  const fadeEffect = incoming && incoming.joinIn.kind === 'effect' ? incoming.joinIn.effect : null
  const capFont = Math.max(12, stageHeight * CAPTION_STYLE.fontRatio)
  const capBottom = stageHeight * CAPTION_STYLE.bottomRatio

  return (
    <div className="pv-mask" onClick={onClose}>
      <div
        className="pv"
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label="连播预览"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="pv-head">
          <span className="pv-no">{current?.no ?? '——'}</span>
          <span className="pv-meta">
            {current
              ? current.kind === 'transition'
                ? `生成转场 · ${current.duration.toFixed(1)}s${current.stale ? ' · 需重生成' : ''}`
                : `${current.duration.toFixed(1)}s · ${current.size} · ${current.move}`
              : ''}
            {current && current.kind === 'shot' && !current.isVideo && <em className="pv-still">静帧</em>}
            {audioLabel && <span className="pv-status">{audioLabel}</span>}
            <span className="pv-status">{captionLabel}</span>
          </span>
          {epList.length > 1 && (
            <span className="pv-eps">
              {epList.map((n) => (
                <button
                  key={n}
                  className={`pv-ep ${n === epNo ? 'on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEpChange(n)
                  }}
                  title={`只播第 ${n} 集`}
                >
                  E{String(n).padStart(2, '0')}
                </button>
              ))}
            </span>
          )}
          <span className="pv-time">
            {playhead.toFixed(1)} / {total.toFixed(1)}s
          </span>
          <button
            className="pv-x"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏 (Esc)' : '全屏'}
            aria-label={isFullscreen ? '退出全屏' : '全屏'}
          >
            ⛶
          </button>
          <button className="pv-x" onClick={onClose} title="关闭 (Esc)" aria-label="关闭连播">
            ✕
          </button>
        </div>

        <div className="pv-stage" ref={stageRef} onClick={togglePlay}>
          {ended ? (
            <div className="pv-end">
              <b>播放结束</b>
              <span>
                {items.length} 段 · {total.toFixed(1)}s
              </span>
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation()
                  seekTo(0)
                  setPaused(false)
                }}
              >
                重播
              </button>
            </div>
          ) : current?.isVideo ? (
            <video
              key={current.id}
              ref={mainVideoRef}
              src={current.src}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                const d = el.duration
                if (d > 0 && Number.isFinite(d)) {
                  setDurFix((map) => (map[current.id] === d ? map : { ...map, [current.id]: d }))
                }
                const target = clamp(playheadRef.current - current.start, 0, d || current.duration)
                if (target > 0) el.currentTime = target
              }}
              onEnded={() => seekTo(current.end)}
            />
          ) : current?.src ? (
            <img key={current.id} src={current.src} alt={current.no} />
          ) : (
            <div className="pv-empty">这一镜还没有画面</div>
          )}

          {incoming && incoming.src && fadeEffect && fadeSeconds > 0 ? (
            <div
              className={fadeClass(fadeEffect)}
              style={{
                animationDuration: `${fadeSeconds}s`,
                animationPlayState: paused ? 'paused' : 'running',
              }}
            >
              {incoming.isVideo ? (
                <video ref={overlayVideoRef} src={incoming.src} muted playsInline preload="auto" />
              ) : (
                <img src={incoming.src} alt="" />
              )}
            </div>
          ) : null}

          {captionPreviewOn && activeCaption ? (
            <div
              className="pv-caption"
              style={{
                fontSize: capFont,
                bottom: capBottom,
                lineHeight: CAPTION_STYLE.lineHeight,
                maxWidth: `${CAPTION_STYLE.maxWidthRatio * 100}%`,
                background: CAPTION_STYLE.background,
                color: CAPTION_STYLE.textColor,
                fontFamily: CAPTION_STYLE.fontFamily,
                fontWeight: 600,
                borderRadius: CAPTION_STYLE.radius,
                padding: `${Math.round(capFont * 0.34)}px ${Math.round(capFont * 0.5)}px`,
              }}
            >
              {activeCaption.text}
            </div>
          ) : null}

          {paused && !ended && <div className="pv-paused">❚❚ 已暂停</div>}
        </div>

        <div className="pv-bar">
          {items.map((item) => (
            <button
              key={item.id}
              className={`pv-seg ${item.id === current?.id && !ended ? 'on' : ''} ${
                playhead >= item.end || ended ? 'past' : ''
              } ${item.kind === 'transition' ? 'transition' : ''}`}
              style={{ flex: Math.max(0.4, item.duration) }}
              onClick={() => seekTo(itemStart(item))}
              title={`${item.no} · ${item.duration.toFixed(1)}s${
                item.kind === 'transition' ? ' · 生成转场' : item.isVideo ? ' · 视频' : ' · 静帧'
              }`}
            >
              <span>{item.kind === 'transition' ? 'T' : item.no}</span>
            </button>
          ))}
        </div>

        <div className="pv-transport">
          <button className="btn-ghost" onClick={goPrev} disabled={!items.length || playhead <= 0}>
            上一镜
          </button>
          <button className="btn primary" data-pv-play onClick={togglePlay}>
            {paused || ended ? '播放' : '暂停'}
          </button>
          <button className="btn-ghost" onClick={goNext}>
            下一镜
          </button>
          <input
            className="pv-seek"
            type="range"
            min={0}
            max={Math.max(0.01, currentDur)}
            step={0.05}
            value={currentTimeInItem}
            onChange={(e) => {
              if (current) seekTo(current.start + Number(e.target.value))
            }}
            aria-label="当前镜头进度"
          />
          <button
            className="pv-icon"
            onClick={() => setMuted((v) => !v)}
            title={muted ? '取消静音 (M)' : '静音 (M)'}
            aria-label={muted ? '取消静音' : '静音'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <input
            className="pv-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="音量"
          />
          <label className="pv-subs">
            <input
              type="checkbox"
              checked={captionPreviewOn}
              onChange={(e) => setCaptionPreviewOn(e.target.checked)}
            />
            预览字幕
          </label>
          <button className="pv-icon" onClick={toggleFullscreen} title="全屏 (F)" aria-label="全屏">
            ⛶
          </button>
          {current?.joinOut && current.joinOut.effect.type !== 'dissolve' ? (
            <span className="pv-approx">擦除/推移预览为近似 · 以导出为准</span>
          ) : null}
        </div>

        <div className="pv-export">
          <span className="pv-export-label">导出</span>
          <select
            className="pv-res"
            value={expRes}
            onChange={(e) => {
              setExpRes(e.target.value as '480p' | '720p' | '1080p')
              setExpUrl('')
              setExpSrtUrl('')
              setExpMsg('')
              setExpWarn('')
            }}
            title="成片分辨率"
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
          <label className="pv-subs">
            <input
              type="checkbox"
              checked={burnSubs}
              onChange={(e) => {
                setBurnSubs(e.target.checked)
                setExpUrl('')
                setExpSrtUrl('')
                setExpMsg('')
                setExpWarn('')
              }}
            />
            烧录字幕
          </label>
          <button className={`btn ${expUrl ? '' : 'primary'}`} onClick={doExport} disabled={expBusy}>
            {expBusy ? `合成中… ${expElapsed.toFixed(0)}s` : expUrl ? '重新合成' : '导出成片'}
          </button>
          {expUrl && (
            <a className="btn primary" href={expUrl} download={`animatic-${expRes}.mp4`}>
              下载 MP4
            </a>
          )}
          {expSrtUrl && (
            <a className="btn-ghost" href={expSrtUrl} download={`animatic-${expRes}.srt`}>
              下载 SRT
            </a>
          )}
        </div>

        {expWarn && <div className="pv-msg warn">{expWarn}</div>}
        {expMsg && (
          <div className={`pv-msg ${expUrl ? 'ok' : /错误|失败|阻止/.test(expMsg) ? 'err' : ''}`}>
            {expMsg}
            {expUrl && (
              <>
                {' · '}
                <a href={expUrl} target="_blank" rel="noreferrer">
                  {expUrl}
                </a>
              </>
            )}
          </div>
        )}

        {activeItems
          .filter((item) => item.audio !== 'none' && (item.audio === 'tts' ? item.voice : item.src))
          .map((item) => (
            <audio
              key={`audio-${item.id}`}
              ref={(el) => {
                audioRefs.current[item.id] = el
              }}
              src={item.audio === 'tts' ? item.voice : item.src}
              preload="auto"
            />
          ))}

        {nextItem?.src && (
          <div className="pv-preload" data-pv-preload aria-hidden="true">
            {nextItem.isVideo ? (
              <video src={nextItem.src} muted preload="auto" />
            ) : (
              <img src={nextItem.src} alt="" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
