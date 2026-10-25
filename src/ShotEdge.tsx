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
      <EdgeChip
        id={id}
        x={labelX}
        y={labelY}
        color={color}
        relation={relation}
        label={relation === 'transition' && data?.transition ? data.transition.summary : s.label}
        state={relation === 'transition' ? data?.transition?.state ?? 'ready' : 'ready'}
      />
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
  relation,
  label,
  state,
}: {
  id: string
  x: number
  y: number
  color: string
  relation: Relation
  label: string
  state: 'ready' | 'pending' | 'stale' | 'inactive'
}) {
  const { cycleEdge, openTransition } = useContext(CanvasCtx)
  const zoom = useStore((st) => st.transform[2])
  const hint =
    state === 'inactive'
      ? '未参与成片：两镜在播放序列里不相邻'
      : state === 'stale'
        ? '生成转场依赖的边界已变化，需要重生成'
        : state === 'pending'
          ? '生成转场还没出片，暂按效果兜底'
          : relation === 'transition'
            ? '点击切换关系；⋯ 打开转场设置'
            : '点击切换镜头关系'
  return (
    <EdgeLabelRenderer>
      <span
        className="edge-chip-wrap nodrag nopan"
        style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / zoom})` }}
      >
        <button
          className={`edge-chip ${state === 'ready' ? '' : state}`}
          style={{ borderColor: color, color }}
          onClick={(e) => {
            e.stopPropagation()
            cycleEdge(id)
          }}
          title={hint}
        >
          {label}
          {relation === 'transition' && state !== 'ready' && <i className={`edge-dot ${state}`} />}
        </button>
        {relation === 'transition' && (
          <button
            className="edge-chip-more"
            style={{ borderColor: color, color }}
            onClick={(e) => {
              e.stopPropagation()
              openTransition(id)
            }}
            title="打开转场设置"
          >
            ⋯
          </button>
        )}
      </span>
    </EdgeLabelRenderer>
  )
}

export default memo(ShotEdge)
