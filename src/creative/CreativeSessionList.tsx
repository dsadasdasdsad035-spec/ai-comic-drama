import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/chat-ui/lib/utils'
import type { CreativeMode, CreativeSession } from './sessionStore'

const MODE_LABEL: Record<CreativeMode, string> = { plan: '策划', reverse: '反推', remake: '复刻' }

/** 相对时间：7 天内说「N 分钟前」，更早显示日期 */
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
    <div
      data-creative-session={session.id}
      data-active={active ? 'true' : 'false'}
      className={cn('creative-list-item', active && 'on')}
    >
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
        <button
          type="button"
          className="creative-list-main"
          title={session.title || '未命名会话'}
          onClick={onSelect}
          onDoubleClick={onEdit}
        >
          <span className="creative-list-title">{session.title || '未命名会话'}</span>
          <span className="creative-list-sub">
            {MODE_LABEL[session.mode]} · {relativeTime(session.updatedAt || session.createdAt)}
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
          <MoreHorizontal className="size-3.5" />
        </button>
        {menuOpen ? (
          <div className="creative-list-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
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
    </div>
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
}: {
  sessions: CreativeSession[]
  activeId: string
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

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
          <b>创意会话</b>
          <button
            type="button"
            data-creative-action="new-session"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={onNew}
            title="新建会话"
          >
            新会话
          </button>
        </header>
        <div className="creative-list-body">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">还没有会话</p>
          ) : (
            sessions.map((s) => (
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
                  if (window.confirm(`删除会话「${s.title || '未命名'}」？源视频与产物会一起清理。`)) {
                    onDelete(s.id)
                  }
                }}
              />
            ))
          )}
        </div>
      </aside>
    </>
  )
}
