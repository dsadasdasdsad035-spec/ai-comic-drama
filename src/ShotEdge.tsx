import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { Relation } from './types'
import type { ShotEdgeType } from './data'
import { useTheme, type ThemeColors } from './theme'

/** 关系只靠虚实区分：连线上不再有任何标签或胶囊 */
const DASH: Record<Relation, string | undefined> = {
  cut: undefined,
  transition: '7 5',
  flashback: '2 5',
  branch: '6 4',
}

function relationColor(relation: Relation, colors: ThemeColors): string {
  if (relation === 'transition') return colors.edgeTransition
  if (relation === 'flashback') return colors.edgeFlashback
  if (relation === 'branch') return colors.edgeBranch
  return colors.edgeCut
}

/**
 * 分镜连线：只画线。
 * 关系由颜色与虚线表达，状态由不透明度与描边色表达；接缝摘要只在单击菜单的头部出现。
 */
function ShotEdge(props: EdgeProps<ShotEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const relation: Relation = data?.relation ?? 'cut'
  const { colors } = useTheme()
  // 分镜边不可选（selectable=false），高亮改由「正在编辑的转场边」派生
  const active = Boolean(data?.active)
  const state = data?.state ?? 'ready'
  // 未参与成片：整条线压暗，保留关系虚线
  const inactive = state === 'inactive'
  // 边界已变需要重生成：描边改警示色
  const stale = state === 'stale'
  const baseColor = relationColor(relation, colors)
  const color = stale ? colors.edgeStale : baseColor

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: color,
        strokeWidth: active ? 2.6 : 1.6,
        strokeDasharray: DASH[relation],
        opacity: inactive ? 0.45 : 1,
        filter: active ? `drop-shadow(0 0 6px ${baseColor})` : undefined,
      }}
    />
  )
}

export default memo(ShotEdge)
