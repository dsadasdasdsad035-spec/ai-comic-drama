import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CharNodeType } from './data'

/** 角色节点：只展示（图 + 名字 + 定位），不承载编辑 —— 编辑在角色板 */
function CharNodeInner({ data }: NodeProps<CharNodeType>) {
  return (
    <div
      className={`char-node ${data.missing ? 'missing' : ''}`}
      title={data.missing ? `${data.name}：出场名单里有，但角色板还没有这张卡` : `${data.name}（点击聚焦出场镜头）`}
    >
      <Handle type="target" position={Position.Left} className="shot-handle" />
      <Handle type="source" position={Position.Right} className="shot-handle" />
      {data.image ? (
        <img src={data.image} alt={data.name} draggable={false} />
      ) : (
        <span className="char-placeholder">{(data.name || '?').slice(0, 1)}</span>
      )}
      <span className="char-name">{data.name}</span>
      {data.role && <span className="char-role">{data.role}</span>}
    </div>
  )
}

export default memo(CharNodeInner)
