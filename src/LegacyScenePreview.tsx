import { useEffect, useRef, useState } from 'react'
import type { ShotNodeType } from './data'
import type { SceneLayout } from './types'
import { effectiveSeconds } from './types'
import { fallbackBlocking, legacyLayoutToBlocking, renderSize, rosterOf } from './scheduleGeometry'
import { resolveShotScene } from './shotScene'
import { buildScheduleScene, type ScheduleScene } from './schedule3d'

type Props = {
  node: ShotNodeType
  sceneLayouts: SceneLayout[]
  aspect: string
}

/**
 * 旧结构化 ShotScene/ShotBlocking 的只读预览。
 * 不写 shotScene、不生成代码；转换入口由工作台提供。
 */
export default function LegacyScenePreview({ node, sceneLayouts, aspect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ScheduleScene | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(0)
  const duration = effectiveSeconds(node.data.seconds)
  const { width, height } = renderSize(aspect)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const d = node.data
    const episode = Number(d.episode) || 1
    const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
    const resolved = resolveShotScene(d, {
      shotId: d.shotId || node.id,
      sceneLayouts,
      episode,
      sceneNo,
      sceneSlug: d.sceneSlug,
    })
    const blocking =
      d.shotBlocking ??
      legacyLayoutToBlocking(d.layout) ??
      fallbackBlocking(rosterOf(d.cast, d.dialogue), resolved.scene)
    let built: ScheduleScene | null = null
    try {
      built = buildScheduleScene({
        layout: resolved.scene,
        blocking,
        duration,
        aspect,
        mode: 'review',
        showLabels: true,
        interactive: false,
        width,
        height,
      })
      host.replaceChildren(built.canvas)
      built.canvas.style.width = '100%'
      built.canvas.style.height = '100%'
      built.canvas.style.objectFit = 'contain'
      sceneRef.current = built
      built.render(timeRef.current)
    } catch {
      host.replaceChildren()
    }
    return () => {
      sceneRef.current = null
      built?.dispose()
    }
  }, [node.id, node.data, sceneLayouts, aspect, duration, width, height])

  useEffect(() => {
    timeRef.current = time
    sceneRef.current?.render(time)
  }, [time])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setTime((t) => {
        const next = (t + dt) % duration
        timeRef.current = next
        sceneRef.current?.render(next)
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  return (
    <div className="cw-legacy">
      <div className="cw-legacy-badge">旧结构化 3D · 只读</div>
      <div className="cw-legacy-canvas" ref={hostRef} />
      <div className="cw-timeline">
        <button className="btn-mini" onClick={() => setPlaying((v) => !v)}>
          {playing ? '暂停' : '播放'}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={time}
          onChange={(e) => {
            setPlaying(false)
            setTime(Number(e.target.value))
          }}
          aria-label="旧结构化预览时间轴"
        />
        <span className="mono">
          {time.toFixed(2)} / {duration.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}
