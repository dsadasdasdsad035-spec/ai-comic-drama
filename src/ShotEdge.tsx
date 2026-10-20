import { useContext } from 'react'
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
}

export default function ShotEdge(props: EdgeProps<ShotEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props
  const { cycleEdge } = useContext(CanvasCtx)
  const relation: Relation = data?.relation ?? 'cut'
  const s = STYLE[relation]
  const zoom = useStore((st) => st.transform[2])

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
      <EdgeLabelRenderer>
        <button
          className="edge-chip nodrag nopan"
          style={{
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px) scale(${1 / zoom})`,
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
    </>
  )
}
