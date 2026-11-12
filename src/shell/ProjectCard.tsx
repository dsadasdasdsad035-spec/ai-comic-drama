import { useState } from 'react'
import { AlertTriangle, Film, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { ProjectSummary } from '../api'
import type { ViewId } from './nav'

/** 相对时间：大厅卡片只需要「多久没动过」，精确到分钟没有意义 */
export function sinceLabel(iso: string): string {
  if (!iso) return '未保存过'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '未保存过'
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export function HealthBadges({ p }: { p: ProjectSummary }) {
  if (p.broken) {
    return (
      <span className="hub-badge is-danger">
        <AlertTriangle size={11} aria-hidden /> 损坏
      </span>
    )
  }
  const h = p.health
  if (!h) return null
  if (h.empty) {
    return (
      <span className="hub-badge is-muted">
        <Film size={11} aria-hidden /> 空项目
      </span>
    )
  }
  return (
    <>
      {h.missing_keyframe > 0 && (
        <span className="hub-badge is-warn" title="这些镜头还没有首帧画面">
          <ImageIcon size={11} aria-hidden /> 缺首帧 {h.missing_keyframe}
        </span>
      )}
      {h.missing_anchor > 0 && (
        <span className="hub-badge is-warn" title="首帧提示词里缺少角色外观锚点">
          <AlertTriangle size={11} aria-hidden /> 缺锚点 {h.missing_anchor}
        </span>
      )}
      {h.missing_keyframe === 0 && h.missing_anchor === 0 && (
        <span className="hub-badge is-ok">画面齐全</span>
      )}
    </>
  )
}

export function ProjectCard({ p, onOpen }: { p: ProjectSummary; onOpen: (name: string, view?: ViewId) => void }) {
  const [imgBroken, setImgBroken] = useState(false)
  const showCover = Boolean(p.cover) && !imgBroken
  return (
    <article className="hub-card" data-hub-card={p.name}>
      <button
        type="button"
        className="hub-card-hit"
        onClick={() => onOpen(p.name)}
        disabled={p.broken}
        aria-label={`打开项目 ${p.title || p.name}`}
        title={p.broken ? '项目数据损坏，无法打开' : undefined}
      >
        <div className={`hub-card-cover ${showCover ? '' : 'is-blank'}`}>
          {showCover ? (
            <img src={p.cover} alt="" loading="lazy" onError={() => setImgBroken(true)} />
          ) : (
            <span className="hub-card-cover-art" aria-hidden>
              {p.aspect}
            </span>
          )}
          <span className="hub-card-aspect">{p.aspect}</span>
        </div>
        <div className="hub-card-body">
          <div className="hub-card-head">
            <b className="hub-card-title">{p.title || p.name}</b>
            <span className="hub-card-when">{sinceLabel(p.updated_at || '')}</span>
          </div>
          <div className="hub-card-style" title={p.style || '未写风格'}>
            {p.style || '未写风格'} · {p.aspect}
          </div>
          <div className="hub-card-meta">
            <span>{p.episodes} 集</span>
            <span>{p.shots} 镜</span>
            <span>{p.seconds}s</span>
          </div>
          <div className="hub-card-badges">
            <HealthBadges p={p} />
          </div>
        </div>
      </button>
      <div className="hub-card-foot">
        <button
          type="button"
          className="hub-card-action"
          disabled={p.broken}
          onClick={() => onOpen(p.name, 'board')}
        >
          画布
        </button>
        <button
          type="button"
          className="hub-card-action"
          disabled={p.broken}
          onClick={() => onOpen(p.name, 'creative')}
        >
          创意
        </button>
        <button
          type="button"
          className="hub-card-action"
          disabled={p.broken}
          onClick={() => onOpen(p.name, 'overview')}
        >
          概览
        </button>
      </div>
    </article>
  )
}
