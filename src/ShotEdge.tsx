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
import { useTheme, type ThemeColors } from './theme'

const STYLE: Record<Relation, { dash?: string; label: string }> = {
  cut: { label: '硬切' },
  transition: { dash: '7 5', label: '转场' },
  flashback: { dash: '2 5', label: '闪回' },
  branch: { dash: '6 4', label: '分支' },
}

function relationColor(relation: Relation, colors: ThemeColors): string {
  if (relation === 'transition') return colors.edgeTransition
  if (relation === 'flashback') return colors.edgeFlashback
  if (relation === 'branch') return colors.edgeBranch
  return colors.edgeCut
}

function ShotEdge(props: EdgeProps<ShotEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props
  const relation: Relation = data?.relation ?? 'cut'
  const s = STYLE[relation]
  const { colors } = useTheme()
  const color = relationColor(relation, colors)

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
          stroke: color,
          strokeWidth: selected ? 2.6 : 1.6,
          strokeDasharray: s.dash,
          filter: selected ? `drop-shadow(0 0 6px ${color})` : undefined,
        }}
      />
      <EdgeChip id={id} x={labelX} y={labelY} color={color} label={s.label} />
    </>
  )
}

/**
 * 标签要反向补偿缩放，只有它订阅 transform；
 * 这层订阅若放在 ShotEdge 里，缩放时每条边都会整条重渲染（几十条 × 每帧）。
 */
function EdgeChip({
  id,
  x,
  y,
  color,
  label,
}: {
  id: string
  x: number
  y: number
  color: string
  label: string
}) {
  const { cycleEdge } = useContext(CanvasCtx)
  const zoom = useStore((st) => st.transform[2])
  return (
    <EdgeLabelRenderer>
      <button
        className="edge-chip nodrag nopan"
        style={{
          transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / zoom})`,
          borderColor: color,
          color,
        }}
        onClick={(e) => {
          e.stopPropagation()
          cycleEdge(id)
        }}
        title="点击切换镜头关系"
      >
        {label}
      </button>
    </EdgeLabelRenderer>
  )
}

export default memo(ShotEdge)
