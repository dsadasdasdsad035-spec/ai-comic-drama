import { useRef, useState } from 'react'
import { callText, getSettings } from './api'
import LayoutView from './LayoutView'
import { DEFAULT_LAYOUT, type ShotData, type ShotLayout } from './types'
import { endTask, startTask } from './tasks'

/**
 * 调度面板：让模型把「谁站哪、机位在哪」落成一份坐标，再画成俯视图。
 *
 * 为什么不让生图模型直接画俯视图：轴线与站位是几何关系，画图模型会编错；
 * 坐标是确定的，既能拖、又能导出成图当参考。
 */
type Props = {
  d: ShotData
  patch: (p: Partial<ShotData>) => void
  /** 出场角色名，用来初始化站位 */
  cast?: string[]
}

/** 没有 AI 结果时的兜底：按出场人数左右排开，机位在下方 */
function fallbackLayout(cast: string[]): ShotLayout {
  const names = cast.filter(Boolean).slice(0, 4)
  const gap = names.length > 1 ? 0.6 / (names.length - 1) : 0
  return {
    ...DEFAULT_LAYOUT,
    actors: names.map((name, i) => ({
      name,
      x: names.length === 1 ? 0.5 : 0.2 + gap * i,
      y: 0.45,
      face: i % 2 === 0 ? 0 : 180,
    })),
    camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.45 },
  }
}

export default function LayoutPanel({ d, patch, cast }: Props) {
  const svgEl = useRef<SVGSVGElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const layout = d.layout

  const generate = async () => {
    setBusy(true)
    setErr('')
    const tid = startTask('text', `${d.no} 调度`)
    try {
      const { settings } = await getSettings()
      const r = await callText<{ actors?: unknown; camera?: unknown; w?: number; h?: number }>({
        system:
          '你是场记兼分镜调度师。把一镜的画面拆成俯视平面上的站位与机位坐标，用于检查轴线与遮挡。',
        model: 'lite',
        json: true,
        maxTokens: 1200,
        prompt:
          `画面：${d.prompt || '（无描述）'}\n` +
          `出场：${(cast ?? d.cast ?? []).join('、') || '（未标注）'}\n` +
          `景别 ${d.size}，运镜 ${d.move}。\n\n` +
          '输出 JSON：{"w":10,"h":8,"actors":[{"name":"角色名","x":0.2,"y":0.5,"face":0}],' +
          '"camera":{"x":0.5,"y":0.9,"lookX":0.5,"lookY":0.45}}\n' +
          'x 从左到右、y 从上到下，都归一化 0~1；face 是朝向角度（0=向右，90=向下，180=向左）。' +
          '机位放在轴线同侧，距离要能容纳该景别。',
      })
      const j = r.json as { actors?: any[]; camera?: any; w?: number; h?: number } | undefined
      const actors = Array.isArray(j?.actors)
        ? j!.actors
            .filter((a) => a && String(a.name || '').trim())
            .map((a) => ({
              name: String(a.name).trim(),
              x: Math.min(1, Math.max(0, Number(a.x) || 0.5)),
              y: Math.min(1, Math.max(0, Number(a.y) || 0.5)),
              face: Number(a.face) || 0,
            }))
        : []
      if (actors.length === 0) throw new Error('模型没给出站位，已用默认布局')
      const cam = j?.camera ?? {}
      patch({
        layout: {
          actors,
          camera: {
            x: Math.min(1, Math.max(0, Number(cam.x) || 0.5)),
            y: Math.min(1, Math.max(0, Number(cam.y) || 0.9)),
            lookX: Math.min(1, Math.max(0, Number(cam.lookX) || 0.5)),
            lookY: Math.min(1, Math.max(0, Number(cam.lookY) || 0.5)),
          },
          w: Number(j?.w) || 10,
          h: Number(j?.h) || 8,
        },
      })
      endTask(tid)
    } catch (e) {
      // 失败也要给个能拖的起点，不要留白
      patch({ layout: fallbackLayout(cast ?? d.cast ?? []) })
      setErr((e as Error).message)
      endTask(tid, (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** SVG → PNG → 存到 public/generated，作为出片参考图 */
  const saveAsRef = async () => {
    const svg = svgEl.current
    if (!svg) return
    setSaving(true)
    setErr('')
    try {
      const xml = new XMLSerializer().serializeToString(svg)
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('俯视图转图片失败'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('取不到 canvas 上下文')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/png')
      const r = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, prefix: 'layout' }),
      }).then((x) => x.json())
      if (!r.ok) throw new Error(r.message || '保存失败')
      patch({ refSheet: r.url })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="gen-box layout-box">
      <div className="gen-head">
        <span>调度（俯视）</span>
        <span className="gen-cost">{d.refSheet ? '已存参考图' : '机位 · 站位 · 轴线'}</span>
      </div>

      <LayoutView
        layout={layout ?? { ...DEFAULT_LAYOUT, actors: [] }}
        onChange={(l) => patch({ layout: l })}
        svgRef={(el) => {
          svgEl.current = el
        }}
      />

      <div className="layout-actions">
        <button className="btn-mini" disabled={busy} onClick={generate}>
          {busy ? '生成中…' : layout ? '重新生成' : 'AI 生成调度'}
        </button>
        <button className="btn-mini" disabled={!layout || saving} onClick={saveAsRef}>
          {saving ? '保存中…' : d.refSheet ? '更新参考图' : '存为参考图'}
        </button>
        {layout && (
          <button className="btn-mini danger" onClick={() => patch({ layout: undefined })}>
            清除
          </button>
        )}
        {d.refSheet && (
          <a className="layout-sheet" href={d.refSheet} target="_blank" rel="noreferrer">
            查看
          </a>
        )}
      </div>
      {d.refSheet && (
        <p className="layout-hint">
          出片时会附带这张调度图作参考（只取空间关系）。
          注意：勾了「以下一镜画面作尾帧约束」就不带它 —— 方舟的 last_frame 与参考图互斥。
        </p>
      )}
      {err && <div className="gen-error">{err}</div>}
    </div>
  )
}
