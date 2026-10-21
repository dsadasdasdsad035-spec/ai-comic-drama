import { memo, useContext } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type EdgeProps,
} from '@xyflow/react'
import { CanvasCtx } from './ctx'
import type { Relation } from './types'
import type { ShotEdgeType } from './data'

const STYLE: Record<Relation, { color: string; dash?: string; label: string }> = {
  cut: { color: '#38bdf8', label: '硬切' },
  transition: { color: '#a3e635', dash: '7 5', label: '转场' },
  flashback: { color: '#c084fc', dash: '2 5', label: '闪回' },
  branch: { color: 'var(--warn)', dash: '6 4', label: '分支' },
}

function ShotEdge(props: EdgeProps<ShotEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props
  const relation: Relation = data?.relation ?? 'cut'
  const s = STYLE[relation]

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: s.color,
          strokeWidth: selected ? 2.6 : 1.6,
          strokeDasharray: s.dash,
          filter: selected ? `drop-shadow(0 0 6px ${s.color})` : undefined,
        }}
      />
      <EdgeChip id={id} x={labelX} y={labelY} relation={relation} />
    </>
  )
}

/**
 * 标签要反向补偿缩放，只有它订阅 transform；
 * 这层订阅若放在 ShotEdge 里，缩放时每条边都会整条重渲染（几十条 × 每帧）。
 */
function EdgeChip({ id, x, y, relation }: { id: string; x: number; y: number; relation: Relation }) {
  const { cycleEdge } = useContext(CanvasCtx)
  const zoom = useStore((st) => st.transform[2])
  const s = STYLE[relation]
  return (
    <EdgeLabelRenderer>
      <button
        className="edge-chip nodrag nopan"
        style={{
          transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / zoom})`,
          borderColor: s.color,
          color: s.color,
        }}
        onClick={(e) => {
          e.stopPropagation()
          cycleEdge(id)
        }}
        title="点击切换镜头关系"
      >
        {s.label}
      </button>
    </EdgeLabelRenderer>
  )
}

export default memo(ShotEdge)
