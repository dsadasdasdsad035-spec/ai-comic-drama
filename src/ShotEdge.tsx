import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type EdgeProps } from '@xyflow/react'
import type { Relation } from './types'
import type { ShotEdgeType } from './data'
import { useTheme, type ThemeColors } from './theme'

/** 非成片链（任一端生图镜）时统一工位虚线；双出片镜为实线 */
const PROD_KIND_DASH = '6 4'

function relationColor(relation: Relation, colors: ThemeColors): string {
  if (relation === 'transition') return colors.edgeTransition
  if (relation === 'flashback') return colors.edgeFlashback
  if (relation === 'branch') return colors.edgeBranch
  return colors.edgeCut
}

/**
 * 分镜连线：线身 + 转场中点标签。
 * 关系由颜色与虚线表达；只有真正接了缝（relation=transition）的线才写字，
 * 硬切/闪回/分支的颜色与虚实已经说明关系，加字会把一条连续的线切成两段。
 */
function ShotEdge(props: EdgeProps<ShotEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const relation: Relation = data?.relation ?? 'cut'
  const sequenceSolid = Boolean(data?.sequenceSolid)
  const { colors } = useTheme()
  // 分镜边不可选（selectable=false），高亮改由「正在编辑的转场边」派生
  const active = Boolean(data?.active)
  const state = data?.state ?? 'ready'
  // 未参与成片：整条线压暗，保留关系虚线
  const inactive = state === 'inactive'
  const baseColor = relationColor(relation, colors)

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  })

  const seamLabel = relation === 'transition' ? data?.seamLabel : ''

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: baseColor,
          strokeWidth: active ? 2.6 : 1.6,
          strokeDasharray: sequenceSolid ? undefined : PROD_KIND_DASH,
          opacity: inactive ? 0.45 : 1,
          filter: active ? `drop-shadow(0 0 6px ${baseColor})` : undefined,
        }}
      />
      {seamLabel ? <SeamChip x={labelX} y={labelY} color={baseColor} label={seamLabel} /> : null}
    </>
  )
}

/**
 * 标签要反向补偿缩放，只有它订阅 transform；
 * 这层订阅若放在 ShotEdge 里，缩放时每条边都会整条重渲染（几十条 × 每帧）。
 * 标签不接收指针事件：点击穿透到线身，菜单入口只有一处。
 */
function SeamChip({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  const zoom = useStore((st) => st.transform[2])
  return (
    <EdgeLabelRenderer>
      <span
        className="edge-chip nodrag nopan"
        style={{
          transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / zoom})`,
          borderColor: color,
          color,
        }}
      >
        {label}
      </span>
    </EdgeLabelRenderer>
  )
}

export default memo(ShotEdge)
