import { useRef, useState } from 'react'
import type { LayoutActor, ShotLayout } from './types'

/**
 * 俯视调度图：人物站位 + 机位 + 180° 轴线。
 *
 * 为什么用 SVG 而不是生图：轴线/站位是几何关系，画图模型会画错，
 * 而这里每个坐标都是可拖动的真实数据，能直接落库、也能导出成参考图。
 */
type Props = {
  layout: ShotLayout
  /** 拖动后回写（归一化坐标） */
  onChange?: (l: ShotLayout) => void
  /** 只读（缩略图/导出用） */
  readOnly?: boolean
  size?: number
  /** 上传用：拿到渲染好的 SVG 元素（callback ref 便于和内部 ref 合并） */
  svgRef?: (el: SVGSVGElement | null) => void
}

const W = 320
const H = 240
const PAD = 14

const px = (v: number) => PAD + v * (W - PAD * 2)
const py = (v: number) => PAD + v * (H - PAD * 2)

/** 两名主要演员连线即 180° 轴线；机位在轴线哪一侧决定是否越轴 */
function axisOf(actors: LayoutActor[]) {
  const [a, b] = actors
  if (!a || !b) return null
  return { x1: px(a.x), y1: py(a.y), x2: px(b.x), y2: py(b.y) }
}

/** 点在轴线哪一侧：>0 / <0 表示两侧，≈0 在线上 */
function sideOf(ax: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number) {
  return (ax.x2 - ax.x1) * (y - ax.y1) - (ax.y2 - ax.y1) * (x - ax.x1)
}

export default function LayoutView({ layout, onChange, readOnly, size = 320, svgRef }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)
  const [drag, setDrag] = useState<{ kind: 'actor'; i: number } | { kind: 'cam' } | null>(null)

  const actors = layout.actors ?? []
  const cam = layout.camera
  const axis = axisOf(actors)
  const camSide = axis ? sideOf(axis, px(cam.x), py(cam.y)) : 0

  const toNorm = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return { x: 0.5, y: 0.5 }
    const vx = (e.clientX - box.left) / box.width
    const vy = (e.clientY - box.top) / box.height
    const nx = Math.min(1, Math.max(0, (vx * W - PAD) / (W - PAD * 2)))
    const ny = Math.min(1, Math.max(0, (vy * H - PAD) / (H - PAD * 2)))
    return { x: nx, y: ny }
  }

  const move = (e: React.PointerEvent) => {
    if (!drag || !onChange) return
    const p = toNorm(e)
    if (drag.kind === 'actor') {
      const next = actors.map((a, i) => (i === drag.i ? { ...a, x: p.x, y: p.y } : a))
      onChange({ ...layout, actors: next })
    } else {
      onChange({ ...layout, camera: { ...cam, x: p.x, y: p.y } })
    }
  }

  return (
    <div className="layout-wrap">
      <svg
        ref={(el) => {
          ref.current = el
          svgRef?.(el)
        }}
        viewBox={`0 0 ${W} ${H}`}
        width={size}
        height={(size * H) / W}
        className="layout-svg"
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        role="img"
      >
        <title>俯视调度</title>
        <style>{`
          .lv-floor{fill:#F7F6F1;stroke:#B4B2A9;stroke-width:1}
          .lv-cap{font:11px system-ui;fill:#888780}
          .lv-axis{stroke:#888780;stroke-width:1;stroke-dasharray:6 5;fill:none}
          .lv-cam{fill:#B5D4F4;stroke:#185FA5;stroke-width:1}
          .lv-fov{stroke:#378ADD;stroke-width:1.5;stroke-dasharray:4 3;fill:none}
          .lv-look{fill:#185FA5}
          .lv-actor{fill:#9FE1CB;stroke:#0F6E56;stroke-width:1.5}
          .lv-face{stroke:#0F6E56;stroke-width:1.5}
          .lv-name{font:11px system-ui;fill:#3C3489;text-anchor:middle}
          .lv-empty{font:12px system-ui;fill:#888780}
          .lv-warn{font:11px system-ui;fill:#A32D2D}
          .lv-grab{cursor:grab}
        `}</style>
        <rect x={1} y={1} width={W - 2} height={H - 2} rx={10} className="lv-floor" />
        <text x={12} y={20} className="lv-cap">
          俯视 · {(layout.w ?? 10) + '×' + (layout.h ?? 8)}m
        </text>

        {/* 轴线：前两名演员连线 */}
        {axis && (
          <>
            <line x1={axis.x1} y1={axis.y1} x2={axis.x2} y2={axis.y2} className="lv-axis" />
            <text x={axis.x2 + 6} y={axis.y2 + 4} className="lv-cap">
              轴线
            </text>
          </>
        )}

        {/* 机位：三角 + 视锥指向 lookAt */}
        <g
          onPointerDown={(e) => {
            if (readOnly) return
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag({ kind: 'cam' })
          }}
          className={readOnly ? '' : 'lv-grab'}
        >
          <path
            d={`M${px(cam.x)} ${py(cam.y) - 9} L${px(cam.x) - 8} ${py(cam.y) + 7} L${px(cam.x) + 8} ${py(cam.y) + 7} Z`}
            className="lv-cam"
          />
          <line
            x1={px(cam.x)}
            y1={py(cam.y)}
            x2={px(cam.lookX)}
            y2={py(cam.lookY)}
            className="lv-fov"
          />
          <circle cx={px(cam.lookX)} cy={py(cam.lookY)} r={3} className="lv-look" />
        </g>

        {/* 人物 */}
        {actors.map((a, i) => {
          const deg = (a.face ?? 0) * (Math.PI / 180)
          const r = 11
          return (
            <g
              key={a.name + i}
              onPointerDown={(e) => {
                if (readOnly) return
                e.currentTarget.setPointerCapture(e.pointerId)
                setDrag({ kind: 'actor', i })
              }}
              className={readOnly ? '' : 'lv-grab'}
            >
              <circle cx={px(a.x)} cy={py(a.y)} r={r} className="lv-actor" />
              <line
                x1={px(a.x) + Math.cos(deg) * r}
                y1={py(a.y) + Math.sin(deg) * r}
                x2={px(a.x) + Math.cos(deg) * (r + 10)}
                y2={py(a.y) + Math.sin(deg) * (r + 10)}
                className="lv-face"
              />
              <text x={px(a.x)} y={py(a.y) + r + 12} className="lv-name">
                {a.name}
              </text>
            </g>
          )
        })}

        {actors.length === 0 && (
          <text x={W / 2} y={H / 2} className="lv-empty" textAnchor="middle">
            还没有站位，先「AI 生成调度」
          </text>
        )}
        {actors.length === 1 && (
          <text x={W / 2} y={H - 10} className="lv-warn" textAnchor="middle">
            只有一个人物，定不了轴线
          </text>
        )}
        {actors.length >= 2 && Math.abs(camSide) < 6 && (
          <text x={W / 2} y={H - 10} className="lv-warn" textAnchor="middle">
            机位几乎压在轴线上，成片会看着别扭
          </text>
        )}
      </svg>
      {!readOnly && (
        <p className="layout-hint">
          拖圆点改站位 · 拖三角改机位 · {actors.length >= 2 ? '虚线是 180° 轴线' : '至少两个人才能定轴线'}
        </p>
      )}
    </div>
  )
}
