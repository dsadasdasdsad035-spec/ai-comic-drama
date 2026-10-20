import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShotNodeType } from './data'
import { assembleAnimatic, type ExportSegment } from './api'
import { EXPORT_SIZES, renderSubtitlePng } from './subtitles'

type Item = {
  id: string
  no: string
  seconds: number
  duration: number
  src?: string
  isVideo: boolean
  dialogue: string
  size: string
  move: string
  voice?: string
}

/** 分镜顺序 = 节点数组顺序（与时间尺一致） */
export function buildPlaylist(nodes: ShotNodeType[]): Item[] {
  return nodes.map((n) => {
    const video = n.data.videoUrl
    return {
      id: n.id,
      no: n.data.no,
      seconds: n.data.seconds,
      // 有视频就按视频实际长度，没有就按镜头时长定格
      duration: Math.max(0.4, n.data.seconds),
      src: video || n.data.refImage,
      isVideo: Boolean(video),
      dialogue: n.data.dialogue,
      size: n.data.size,
      move: n.data.move,
      voice: n.data.voiceUrl,
    }
  })
}

export default function Preview({
  nodes,
  startId,
  onClose,
  onPick,
  assReady,
  epNo,
  onEpChange,
}: {
  nodes: ShotNodeType[]
  startId?: string | null
  onClose: () => void
  onPick: (id: string) => void
  /** ffmpeg 是否带 libass（带则服务端走 SRT，前端无需渲 PNG） */
  assReady?: boolean
  /** 当前集：连播与导出都只处理这一集 */
  epNo: number
  onEpChange: (n: number) => void
}) {
  // 集号：从节点里出现过的 episode 归并，缺省按第 1 集（与画布/表格同一约定）
  const epOf = useCallback((n: ShotNodeType) => Number(n.data.episode) || 1, [])
  const epList = useMemo(() => {
    const set = new Set(nodes.map(epOf))
    return [...set].sort((a, b) => a - b)
  }, [nodes, epOf])

  const epNodes = useMemo(() => nodes.filter((n) => epOf(n) === epNo), [nodes, epNo, epOf])
  const items = useMemo(() => buildPlaylist(epNodes), [epNodes])
  /** 视频元数据加载后用真实片长覆盖名义时长 */
  const [durFix, setDurFix] = useState<Record<string, number>>({})
  const durOf = useCallback((it: Item) => durFix[it.id] ?? it.duration, [durFix])
  const total = items.reduce((s, it) => s + durOf(it), 0)

  const startIdx = Math.max(0, items.findIndex((it) => it.id === startId))
  const [idx, setIdx] = useState(items.length ? startIdx : -1)
  // 切集：列表换了，游标必须回到第一镜，否则会越界或停在无意义的镜号
  const epRef = useRef(epNo)
  useEffect(() => {
    if (epRef.current === epNo) return
    epRef.current = epNo
    setIdx(items.length ? 0 : -1)
    setEnded(false)
  }, [epNo, items.length])
  const [paused, setPaused] = useState(false)
  const [ended, setEnded] = useState(false)

  // 导出成片
  const [expRes, setExpRes] = useState<'480p' | '720p' | '1080p'>('720p')
  const [expBusy, setExpBusy] = useState(false)
  const [expUrl, setExpUrl] = useState('')
  const [expMsg, setExpMsg] = useState('')
  const [expWarn, setExpWarn] = useState('')
  const [burnSubs, setBurnSubs] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const cur = idx >= 0 ? items[idx] : null

  const go = useCallback(
    (next: number) => {
      if (next >= items.length) {
        setEnded(true)
        return
      }
      setIdx(Math.max(0, next))
      onPick(items[Math.max(0, next)].id)
    },
    [items, onPick],
  )

  // 静帧：按镜头时长定时推进；视频：等 onEnded
  useEffect(() => {
    if (!cur || paused || ended) return
    if (cur.isVideo) return
    const t = window.setTimeout(() => go(idx + 1), durOf(cur) * 1000)
    return () => window.clearTimeout(t)
  }, [cur, idx, paused, ended, go, durOf])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !cur?.isVideo) return
    if (paused) v.pause()
    else v.play().catch(() => {})
  }, [cur, paused])

  // 用捕获阶段：画布（React Flow）会在冒泡阶段吃掉 Esc / 方向键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k !== 'Escape' && k !== ' ' && k !== 'ArrowRight' && k !== 'ArrowLeft') return
      e.preventDefault()
      e.stopPropagation()
      if (k === 'Escape') onClose()
      else if (k === ' ') setPaused((p) => !p)
      else if (k === 'ArrowRight') go(idx + 1)
      else go(idx - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, go, idx])

  const doExport = async () => {
    setExpBusy(true)
    setExpMsg('')
    setExpWarn('')
    setExpUrl('')
    try {
      const [W, H] = EXPORT_SIZES[expRes]
      const segs: ExportSegment[] = items
        .filter((it) => Boolean(it.src))
        .map((it) => {
          const seg: ExportSegment = it.isVideo
            ? { seconds: durOf(it), video: it.src, voice: it.voice }
            : { seconds: durOf(it), image: it.src, voice: it.voice }
          if (burnSubs && it.dialogue.trim()) {
            seg.dialogue = it.dialogue
            // 没有 libass 才退回到「前端渲整帧 PNG + overlay」
            if (!assReady) {
              const png = renderSubtitlePng({ width: W, height: H, text: it.dialogue })
              if (png) seg.sub = png
            }
          }
          return seg
        })
      const r = await assembleAnimatic(segs, expRes)
      setExpUrl(r.url)
      setExpMsg(
        `${r.shots} 镜 · ${r.seconds.toFixed(1)}s` +
          (r.voiced ? ` · 配音 ${r.voiced} 镜` : ' · 无音轨') +
          (r.subbed ? ` · 字幕 ${r.subbed} 镜` : '') +
          ` · 用时 ${(r.elapsed / 1000).toFixed(1)}s`,
      )
      if (r.overflows.length > 0) {
        const list = r.overflows
          .map((o) => `第 ${o.shot} 镜 配音 ${o.voice}s / 镜头 ${o.shotLen}s`)
          .join('，')
        setExpWarn(`配音超长会被截断：${list}`)
      }
    } catch (e) {
      setExpMsg((e as Error).message)
    } finally {
      setExpBusy(false)
    }
  }

  if (!items.length) return null

  const elapsedBefore = items.slice(0, Math.max(0, idx)).reduce((s, it) => s + durOf(it), 0)

  return (
    <div className="pv-mask" onClick={onClose}>
      <div className="pv" onClick={(e) => e.stopPropagation()}>
        <div className="pv-head">
          <span className="pv-no">{cur?.no ?? '——'}</span>
          <span className="pv-meta">
            {cur ? `${durOf(cur).toFixed(1)}s · ${cur.size} · ${cur.move}` : ''}
            {cur && !cur.isVideo && <em className="pv-still">静帧</em>}
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
            {(elapsedBefore + (cur ? durOf(cur) : 0)).toFixed(1)} / {total.toFixed(1)}s
          </span>
          <button className="pv-x" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </div>

        <div className="pv-stage" onClick={() => setPaused((p) => !p)}>
          {ended ? (
            <div className="pv-end">
              <b>播放结束</b>
              <span>{items.length} 镜 · {total.toFixed(1)}s</span>
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setEnded(false)
                  setIdx(0)
                  setPaused(false)
                }}
              >
                重播
              </button>
            </div>
          ) : cur?.isVideo ? (
            <video
              key={cur.id}
              ref={videoRef}
              src={cur.src}
              autoPlay
              playsInline
              onEnded={() => go(idx + 1)}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                if (d > 0 && Number.isFinite(d)) setDurFix((m) => ({ ...m, [cur.id]: d }))
              }}
            />
          ) : cur?.src ? (
            <img key={cur.id} src={cur.src} alt={cur.no} />
          ) : (
            <div className="pv-empty">这一镜还没有画面</div>
          )}

          {paused && !ended && <div className="pv-paused">❚❚ 已暂停</div>}
        </div>

        <div className="pv-bar">
          {items.map((it, i) => (
            <button
              key={it.id}
              className={`pv-seg ${i === idx && !ended ? 'on' : ''} ${i < idx || ended ? 'past' : ''}`}
              style={{ flex: durOf(it) }}
              onClick={() => {
                setEnded(false)
                go(i)
              }}
              title={`${it.no} · ${durOf(it).toFixed(1)}s${it.isVideo ? ' · 视频' : ' · 静帧'}`}
            >
              <span>{it.no}</span>
            </button>
          ))}
        </div>

        <div className="pv-foot">
          <button className="btn-ghost" onClick={() => { setEnded(false); go(idx - 1) }} disabled={idx <= 0}>
            上一镜
          </button>
          <button className="btn primary" onClick={() => setPaused((p) => !p)}>
            {paused ? '继续' : '暂停'}
          </button>
          <button className="btn-ghost" onClick={() => { setEnded(false); go(idx + 1) }}>
            下一镜
          </button>
          <span className="pv-tail">
            {cur?.dialogue ? `「${cur.dialogue}」` : '空格播放/暂停 · ←→ 换镜'}
          </span>

          <label
            className="pv-subs"
            title={
              assReady
                ? '把台词烧进画面（libass + SRT）'
                : '把台词烧进画面（当前 ffmpeg 无 libass，由前端渲成 PNG 后叠加）'
            }
          >
            <input
              type="checkbox"
              checked={burnSubs}
              onChange={(e) => {
                setBurnSubs(e.target.checked)
                setExpUrl('')
                setExpMsg('')
                setExpWarn('')
              }}
            />
            字幕
          </label>

          <select
            className="pv-res"
            value={expRes}
            onChange={(e) => {
              setExpRes(e.target.value as '480p' | '720p' | '1080p')
              setExpUrl('')
              setExpMsg('')
            }}
            title="成片分辨率"
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>

          {expUrl && (
            <a className="btn primary" href={expUrl} download={`animatic-${expRes}.mp4`}>
              下载成片
            </a>
          )}
          <button className={`btn ${expUrl ? '' : 'primary'}`} onClick={doExport} disabled={expBusy}>
            {expBusy ? '合成中…' : expUrl ? '重新合成' : '导出成片'}
          </button>
        </div>

        {expWarn && <div className="pv-msg warn">{expWarn}</div>}

        {expMsg && (
          <div className={`pv-msg ${expUrl ? 'ok' : 'err'}`}>
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
      </div>
    </div>
  )
}
