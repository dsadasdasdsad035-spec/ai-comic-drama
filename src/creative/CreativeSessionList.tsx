import { useState } from 'react'
import { cn } from '@/chat-ui/lib/utils'
import type { CreativeSession } from './sessionStore'

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
            sessions.map((s) => {
              const active = s.id === activeId
              return (
                <div
                  key={s.id}
                  data-creative-session={s.id}
                  data-active={active ? 'true' : 'false'}
                  className={cn('creative-list-item', active && 'on')}
                >
                  {editing === s.id ? (
                    <input
                      autoFocus
                      value={draft}
                      className="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commit(s.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[11px]"
                      title={s.title || s.id}
                      onClick={() => onSelect(s.id)}
                      onDoubleClick={() => {
                        setEditing(s.id)
                        setDraft(s.title)
                      }}
                    >
                      {s.title || '未命名会话'}
                      <span className="ml-1 text-[9px] text-muted-foreground">
                        {s.mode === 'reverse' ? '反推' : s.mode === 'remake' ? '复刻' : '策划'}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="重命名会话"
                    className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setEditing(s.id)
                      setDraft(s.title)
                    }}
                  >
                    改
                  </button>
                  <button
                    type="button"
                    aria-label="删除会话"
                    data-creative-action="delete-session"
                    className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      if (window.confirm(`删除会话「${s.title || '未命名'}」？源视频与产物会一起清理。`)) {
                        onDelete(s.id)
                      }
                    }}
                  >
                    删
                  </button>
                </div>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}
