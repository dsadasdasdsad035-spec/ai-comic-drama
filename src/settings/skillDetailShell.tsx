import type { ReactNode } from 'react'

type ModalProps = {
  ariaLabel: string
  className?: string
  onClose: () => void
  dismissOnBackdrop?: boolean
  children: ReactNode
}

export function SkillDetailModal({
  ariaLabel,
  className,
  onClose,
  dismissOnBackdrop = true,
  children,
}: ModalProps) {
  return (
    <div
      className="st-modal-backdrop skill-detail-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`st-modal skill-detail-modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function SkillDetailClose({ onClose, busy }: { onClose: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      className="skill-detail-close"
      aria-label="关闭"
      disabled={busy}
      onClick={onClose}
    >
      ✕
    </button>
  )
}

export function SkillDetailBadge({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent' | 'warn' | 'success' | 'muted'
  children: ReactNode
}) {
  return <span className={`skill-detail-badge tone-${tone}`}>{children}</span>
}

export function SkillDetailStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="skill-detail-stat">
      <span className="skill-detail-stat-label">{label}</span>
      <span className="skill-detail-stat-value">{value}</span>
    </div>
  )
}

type HeroProps = {
  icon: ReactNode
  title: string
  slug?: string
  badges?: ReactNode
  stats?: ReactNode
  onClose: () => void
  busy?: boolean
}

export function SkillDetailHero({ icon, title, slug, badges, stats, onClose, busy }: HeroProps) {
  return (
    <header className="skill-detail-hero">
      <div className="skill-detail-hero-main">
        <div className="skill-detail-hero-icon">{icon}</div>
        <div className="skill-detail-hero-copy">
          <h3 className="skill-detail-title">{title}</h3>
          {slug ? <p className="skill-detail-slug mono">{slug}</p> : null}
          {badges ? <div className="skill-detail-badges">{badges}</div> : null}
        </div>
      </div>
      {stats ? <div className="skill-detail-stats">{stats}</div> : null}
      <SkillDetailClose onClose={onClose} busy={busy} />
    </header>
  )
}

export function SkillDetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; hidden?: boolean }>
  active: string
  onChange: (id: string) => void
}) {
  const visible = tabs.filter((t) => !t.hidden)
  if (visible.length <= 1) return null
  return (
    <nav className="skill-detail-tabs" role="tablist" aria-label="技能详情分区">
      {visible.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? 'on' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export function SkillDetailBody({ children }: { children: ReactNode }) {
  return <div className="skill-detail-body">{children}</div>
}

export function SkillDetailPanel({ title, children, hint }: { title?: string; children: ReactNode; hint?: string }) {
  return (
    <section className="skill-detail-panel">
      {title ? <h4 className="skill-detail-panel-title">{title}</h4> : null}
      {hint ? <p className="st-hint skill-detail-panel-hint">{hint}</p> : null}
      {children}
    </section>
  )
}

export function SkillDetailFoot({ start, end }: { start?: ReactNode; end: ReactNode }) {
  return (
    <footer className="st-modal-foot skill-detail-foot">
      <div className="skill-detail-foot-start">{start}</div>
      <div className="skill-detail-foot-end">{end}</div>
    </footer>
  )
}