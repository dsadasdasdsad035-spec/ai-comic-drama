import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import type { CreativeSession } from './sessionStore'

const MODE_LABEL: Record<string, string> = {
  plan: '策划',
  reverse: '反推',
  remake: '翻拍',
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.round(hour / 24)
  if (day < 7) return `${day} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function SessionRow({
  session,
  active,
  editing,
  draft,
  onDraft,
  onCommit,
  onCancel,
  onSelect,
  onEdit,
  onDelete,
  expertLabel,
}: {
  session: CreativeSession
  active: boolean
  editing: boolean
  draft: string
  onDraft: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  /** 会话绑定的专家显示名 */
  expertLabel?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <article
      data-creative-session={session.id}
      data-active={active ? 'true' : 'false'}
      className={`creative-session-card${active ? ' is-active' : ''}`}
    >
      <span className="creative-session-accent" aria-hidden />
      {editing ? (
        <input
          autoFocus
          value={draft}
          className="creative-list-rename"
          onChange={(e) => onDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            if (e.key === 'Escape') onCancel()
          }}
        />
      ) : (
        <button type="button" className="creative-session-card-main" onClick={onSelect} onDoubleClick={onEdit}>
          <span className="creative-session-card-title">{session.title || '未命名会话'}</span>
          <span className="creative-session-card-meta">
            <span className="creative-session-mode">{MODE_LABEL[session.mode] || session.mode}</span>
            {expertLabel ? (
              <>
                <span aria-hidden>·</span>
                <span className="creative-session-expert" data-creative-session-expert>
                  {expertLabel}
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{relativeTime(session.updatedAt || session.createdAt)}</span>
          </span>
        </button>
      )}
      <div className="creative-list-more" ref={menuRef}>
        <button
          type="button"
          className="creative-list-more-btn"
          aria-label="会话操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
        {menuOpen ? (
          <div className="creative-list-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit() }}>
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              data-creative-action="delete-session"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
            >
              删除
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

/** 会话列表：宽屏常驻，窄屏为可关闭抽屉 */
export function CreativeSessionList({
  sessions,
  activeId,
  open,
  onToggle,
  onSelect,
  onNew,
  onRename,
  onDelete,
  expertNameById,
  projectCaption,
}: {
  sessions: CreativeSession[]
  activeId: string
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  expertNameById?: Record<string, string>
  /** 侧栏副标题，如当前项目名 */
  projectCaption?: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) =>
      [s.title, s.mode, MODE_LABEL[s.mode]].join(' ').toLowerCase().includes(q),
    )
  }, [sessions, query])

  const commit = (id: string) => {
    const title = draft.trim()
    setEditing(null)
    if (title) onRename(id, title)
  }

  return (
    <>
      {open ? <div className="creative-list-scrim" onClick={onToggle} aria-hidden="true" /> : null}
      <aside
        data-creative-sessions
        data-open={open ? 'true' : 'false'}
        className="creative-list"
        aria-label="创意会话列表"
      >
        <header className="creative-list-head">
          <div className="creative-list-head-text">
            <b>创意会话</b>
            <p className="creative-list-head-sub">
              {projectCaption ? projectCaption : '按项目分组 · 本机保存'}
              {sessions.length > 0 ? (
                <span className="creative-list-count">{sessions.length}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            data-creative-action="new-session"
            className="creative-list-new"
            onClick={onNew}
            title="新建会话"
            aria-label="新建会话"
          >
            <Plus className="size-3.5" aria-hidden />
            <span>新建</span>
          </button>
        </header>
        {sessions.length > 0 ? (
          <div className="creative-list-search-wrap">
            <input
              type="search"
              className="st-input creative-list-search"
              placeholder="搜索会话…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索创意会话"
            />
          </div>
        ) : null}
        <div className="creative-list-body">
          {sessions.length === 0 ? (
            <p className="creative-list-empty">还没有会话，点「新会话」开始。</p>
          ) : filtered.length === 0 ? (
            <p className="creative-list-empty">没有匹配的会话。</p>
          ) : (
            filtered.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                editing={editing === s.id}
                draft={draft}
                onDraft={setDraft}
                onCommit={() => commit(s.id)}
                onCancel={() => setEditing(null)}
                onSelect={() => onSelect(s.id)}
                onEdit={() => {
                  setEditing(s.id)
                  setDraft(s.title)
                }}
                onDelete={() => {
                  if (window.confirm(`删除会话「${s.title || '未命名'}」？聊天记录会一并清理。`)) {
                    onDelete(s.id)
                  }
                }}
                expertLabel={
                  s.expertId && expertNameById?.[s.expertId]
                    ? expertNameById[s.expertId]
                    : s.expertId
                      ? `专家·${s.expertId}`
                      : undefined
                }
              />
            ))
          )}
        </div>
      </aside>
    </>
  )
}