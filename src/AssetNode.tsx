import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { canvasDisplayImageUrl } from './canvasThumbUrl'
import type { AssetNodeType } from './data'

const KIND_META: Record<string, { label: string; cls: string }> = {
  scene: { label: '场景', cls: 'asset-badge-scene' },
  prop: { label: '道具', cls: 'asset-badge-prop' },
  image: { label: '图', cls: 'asset-badge-image' },
  video: { label: '视频', cls: 'asset-badge-video' },
  audio: { label: '音频', cls: 'asset-badge-audio' },
  music: { label: '音乐', cls: 'asset-badge-audio' },
  subtitle: { label: '字幕', cls: 'asset-badge-subtitle' },
  'expression-sheet': { label: '表情', cls: 'asset-badge-expression' },
}

/**
 * 素材卡：场景图 / 道具图 / 参考图 / 视频素材 / 音频素材 / 角色表情总图。
 * 连到分镜卡的边 = 参考关系（表情总图只显示，实际发送按表演裁出的单格）。
 * 节点数据（title/kind/url）存画布 localStorage，位置随拖拽持久化。
 */
function AssetNodeInner({ data, selected }: NodeProps<AssetNodeType>) {
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
        {data.kind === 'subtitle' ? (
          <div className="asset-subtitle">
            <span className="asset-subtitle-count">
              {(data.cues?.length ?? 0) > 0 ? `${data.cues!.length} 条 cue` : '尚未编辑字幕'}
            </span>
            {(data.sourceShotIds?.length ?? 0) > 0 ? (
              <span className="asset-subtitle-hint">已引 {data.sourceShotIds!.length} 镜</span>
            ) : null}
          </div>
        ) : data.kind === 'audio' || data.kind === 'music' ? (
          data.url ? (
            <div className="asset-audio">
              <audio src={data.url} controls preload="metadata" className="asset-audio-el" />
              <span className="asset-audio-hint">
                {data.kind === 'music' ? '音乐素材' : '音频素材'} · 可连出片镜
              </span>
            </div>
          ) : (
            <span className="asset-empty">未设置音频</span>
          )
        ) : data.kind === 'video' ? (
          data.url ? (
            <video src={data.url} muted loop playsInline autoPlay className="asset-media" />
          ) : (
            <span className="asset-empty">未设置视频</span>
          )
        ) : data.url ? (
          <img
            src={canvasDisplayImageUrl(data.url)}
            alt={data.title}
            className="asset-media"
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="asset-empty">未设置图片</span>
        )}
      </div>
    </div>
  )
}

export default memo(AssetNodeInner)
