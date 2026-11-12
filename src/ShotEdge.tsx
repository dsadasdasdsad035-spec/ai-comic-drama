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
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const relation: Relation = data?.relation ?? 'cut'
  const s = STYLE[relation]
  const { colors } = useTheme()
  const { openEdgeMenu } = useContext(CanvasCtx)
  const color = relationColor(relation, colors)
  // 分镜边不可选（selectable=false），高亮改由「正在编辑的转场边」派生
  const active = Boolean(data?.active)

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
        onContextMenu={(e) => {
          // 线身右击：打开关系菜单，且不再冒泡给 React Flow 自己的边菜单回调
          e.preventDefault()
          e.stopPropagation()
          openEdgeMenu(e, id)
        }}
        style={{
          stroke: color,
          strokeWidth: active ? 2.6 : 1.6,
          strokeDasharray: s.dash,
          filter: active ? `drop-shadow(0 0 6px ${color})` : undefined,
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
  const { openEdgeMenu } = useContext(CanvasCtx)
  const zoom = useStore((st) => st.transform[2])
  const hint =
    state === 'inactive'
      ? '未参与成片：两镜在播放序列里不相邻；右击连线设置'
      : state === 'stale'
        ? '生成转场依赖的边界已变化，需要重生成；右击连线设置'
        : state === 'pending'
          ? '生成转场还没出片，暂按效果兜底；右击连线设置'
          : '右击连线设置'
  return (
    <EdgeLabelRenderer>
      <span
        className="edge-chip-wrap nodrag nopan"
        style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / zoom})` }}
        onContextMenu={(e) => {
          // 标签是独立浮层，事件不会冒泡到边，必须单独挂
          e.preventDefault()
          e.stopPropagation()
          openEdgeMenu(e, id)
        }}
      >
        <span className={`edge-chip ${state === 'ready' ? '' : state}`} style={{ borderColor: color, color }} title={hint}>
          {label}
          {relation === 'transition' && state !== 'ready' && <i className={`edge-dot ${state}`} />}
        </span>
      </span>
    </EdgeLabelRenderer>
  )
}

export default memo(ShotEdge)
