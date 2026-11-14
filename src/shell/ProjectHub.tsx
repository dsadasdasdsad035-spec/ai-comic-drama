import { useMemo, useState, type ReactNode } from 'react'
import { Search, Sparkles } from 'lucide-react'
import type { ProjectSummary } from '../api'
import ProjectMenu from '../project/ProjectMenu'
import NewProjectDialog from '../project/NewProjectDialog'
import { ProjectCard } from './ProjectCard'
import type { ViewId } from './nav'
import brandMark from '../assets/brand/icon-mark.png'

export type ProjectHubProps = {
  projects: ProjectSummary[]
  /** 是否已经成功拉过一次列表：区分「加载中」与「一个项目都没有」 */
  loaded: boolean
  onOpen: (name: string, view?: ViewId) => void
  onCreate: (name: string) => void | Promise<void>
  onDeleted: (names: string[]) => void | Promise<void>
  themeToggle: ReactNode
}

/**
 * 项目大厅：应用的唯一入口。
 *
 * 冷启动不加载任何项目，只拉一次项目摘要（含封面与健康徽标）。
 * 卡片点击进该项目上次的视图，卡片底部的三个按钮直达常用视图。
 */
export default function ProjectHub({
  projects,
  loaded,
  onOpen,
  onCreate,
  onDeleted,
  themeToggle,
}: ProjectHubProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const sorted = useMemo(
    () => [...projects].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [projects],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) =>
      `${p.title} ${p.name} ${p.style}`.toLowerCase().includes(q),
    )
  }, [sorted, query])
  const recent = useMemo(
    () =>
      [...projects]
        .filter((p) => p.updated_at)
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        .slice(0, 5),
    [projects],
  )
  const totals = useMemo(
    () =>
      projects.reduce(
        (acc, p) => ({
          episodes: acc.episodes + (p.episodes || 0),
          shots: acc.shots + (p.shots || 0),
          seconds: acc.seconds + (p.seconds || 0),
        }),
        { episodes: 0, shots: 0, seconds: 0 },
      ),
    [projects],
  )

  return (
    <div className="hub">
      <header className="hub-top">
        <div className="brand">
          <img className="brand-logo" src={brandMark} alt="" width={22} height={22} />
          <b>分镜画布</b>
          <span className="brand-sub">项目大厅</span>
        </div>
        <div className="spacer" />
        <div className="hub-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目名、标题或风格"
            aria-label="搜索项目"
          />
        </div>
        <ProjectMenu
          currentProjectName=""
          onCreated={onCreate}
          onDeleted={onDeleted}
          variant="bar"
        />
        {themeToggle}
      </header>

      <div className="hub-body">
        {/* 空库不显示统计与最近：0 个项目 · 0 集 · 0 镜 只会让人以为加载失败 */}
        {projects.length > 0 ? (
        <section className="hub-hero" aria-labelledby="hub-hero-title">
          <div>
            <h1 id="hub-hero-title">
              选择项目 <span className="hub-hero-sub">从这里开始一次创作</span>
            </h1>
            <p className="hub-hero-meta">
              {projects.length} 个项目 · {totals.episodes} 集 · {totals.shots} 镜 ·{' '}
              {Math.round(totals.seconds)} 秒素材
            </p>
          </div>
          {recent.length > 0 && (
            <div className="hub-recent" aria-label="最近项目">
              <span className="hub-recent-label">最近</span>
              {recent.map((p) => (
                <button key={p.name} type="button" className="hub-recent-chip" onClick={() => onOpen(p.name)}>
                  {p.title || p.name}
                </button>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {!loaded ? (
          <div className="hub-grid" aria-busy="true" aria-label="项目加载中">
            {[0, 1, 2].map((i) => (
              <div className="hub-card is-skeleton" key={i}>
                <div className="hub-card-cover is-blank" />
                <div className="hub-card-body">
                  <span className="hub-skel-line" />
                  <span className="hub-skel-line short" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="hub-empty">
            {projects.length === 0 ? (
              <>
                <Sparkles size={22} aria-hidden />
                <h2>还没有项目</h2>
                <p>新建一个项目，写下标题和画幅，然后从创意或画布开始。</p>
                <button type="button" className="btn" data-hub-new-project onClick={() => setCreating(true)}>
                  新建项目
                </button>
              </>
            ) : (
              <>
                <h2>没有匹配的项目</h2>
                <p>换个关键词试试，或清空搜索。</p>
                <button type="button" className="btn-ghost" onClick={() => setQuery('')}>
                  清空搜索
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="hub-section-title">
              <h2>{query.trim() ? '搜索结果' : '全部项目'}</h2>
              <span>{filtered.length} 个</span>
            </div>
            <div className="hub-grid" data-hub-grid>
              {filtered.map((p) => (
                <ProjectCard key={p.name} p={p} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
      </div>

      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (name) => {
          setCreating(false)
          await onCreate(name)
        }}
      />
    </div>
  )
}
