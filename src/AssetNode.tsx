import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AssetNodeType } from './data'

const KIND_META: Record<string, { label: string; cls: string }> = {
  scene: { label: '场景', cls: 'asset-badge-scene' },
  prop: { label: '道具', cls: 'asset-badge-prop' },
  image: { label: '图', cls: 'asset-badge-image' },
  video: { label: '视频', cls: 'asset-badge-video' },
}

/**
 * 素材卡：场景图 / 道具图 / 参考图 / 视频素材。
 * 连到分镜卡的边 = 参考关系（生成画面时按连线取参考图）。
 * 节点数据（title/kind/url）存画布 localStorage，位置随拖拽持久化。
 */
export default function AssetNode({ data, selected }: NodeProps<AssetNodeType>) {
  const meta = KIND_META[data.kind] ?? KIND_META.image
  return (
    <div className={`asset-node ${selected ? 'sel' : ''}`} title={`${meta.label} · ${data.title || '未命名'}`}>
      <Handle type="target" position={Position.Left} className="shot-handle" />
      <Handle type="source" position={Position.Right} className="shot-handle" />
      <div className="asset-head">
        <span className={`asset-badge ${meta.cls}`}>{meta.label}</span>
        <span className="asset-title">{data.title || '未命名素材'}</span>
      </div>
      <div className="asset-body">
        {data.kind === 'video' ? (
          data.url ? (
            <video src={data.url} muted loop playsInline autoPlay className="asset-media" />
          ) : (
            <span className="asset-empty">未设置视频</span>
          )
        ) : data.url ? (
          <img src={data.url} alt={data.title} className="asset-media" draggable={false} />
        ) : (
          <span className="asset-empty">未设置图片</span>
        )}
      </div>
    </div>
  )
}
