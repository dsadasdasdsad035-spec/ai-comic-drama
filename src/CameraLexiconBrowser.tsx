import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CAMERA_LEXICON_ATTRIBUTION,
  getCameraLexiconCatalog,
  listCameraLexicon,
  type CameraLexiconEntry,
  type LexiconCategory,
} from './cameraLexicon'
import { importCameraLexiconPreset } from './api'

type Props = {
  projectName: string
  category?: LexiconCategory
  onPublishAsset?: (input: { title: string; kind: string; url: string }) => void
  onPickShotRef?: (entry: CameraLexiconEntry, projectUrl: string) => void
  toast: (m: string) => void
}

type ViewScope = 'all' | LexiconCategory

const GRAMMAR_LABELS: Record<string, string> = {
  A: '景别与叙事',
  B: '对话覆盖',
  C: '转场衔接',
  D: '主观沉浸',
  E: '节奏情绪',
}

function LexiconTile({
  entry,
  selected,
  playing,
  onSelect,
  onPlay,
  onStop,
}: {
  entry: CameraLexiconEntry
  selected: boolean
  playing: boolean
  onSelect: () => void
  onPlay: () => void
  onStop: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (playing) el.play().catch(() => {})
    else el.pause()
  }, [playing])

  const badge =
    entry.lexiconCategory === 'shot-grammar' && entry.grammarGroup
      ? `语法 ${entry.grammarGroup}`
      : `§${entry.section}`

  return (
    <button
      type="button"
      className={`lex-tile ${selected ? 'on' : ''}`}
      data-lexicon-key={entry.key}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={onPlay}
      onMouseLeave={onStop}
      onFocus={onPlay}
      onBlur={onStop}
    >
      <div className="lex-thumb" aria-hidden="true">
        <video ref={videoRef} src={entry.url} muted loop playsInline preload="metadata" />
        <span className="lex-thumb-badge">{badge}</span>
        <span className="lex-thumb-play">{playing ? '❚❚' : '▶'}</span>
      </div>
      <span className="lex-tile-title">{entry.cn}</span>
      <span className="lex-tile-en">{entry.en}</span>
      {(entry.primaryForMove || entry.primaryForSize) && (
        <span className="lex-tile-tag">
          {entry.primaryForMove ? `主参照·${entry.mapsToMove}` : `主参照·${entry.mapsToSize}`}
        </span>
      )}
    </button>
  )
}

export default function CameraLexiconBrowser({
  projectName,
  category: scopeLock,
  onPublishAsset,
  onPickShotRef,
  toast,
}: Props) {
  const catalog = getCameraLexiconCatalog()
  const [viewScope, setViewScope] = useState<ViewScope>(scopeLock ?? 'all')
  const [section, setSection] = useState(0)
  const [grammarGroup, setGrammarGroup] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const effectiveCategory = scopeLock ?? (viewScope === 'all' ? undefined : viewScope)

  const entries = useMemo(
    () =>
      listCameraLexicon({
        ...(effectiveCategory ? { category: effectiveCategory } : {}),
        ...(section > 0 ? { section } : {}),
        ...(grammarGroup ? { grammarGroup } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
      }),
    [effectiveCategory, section, grammarGroup, q],
  )

  const sections = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of catalog.entries) {
      if (effectiveCategory && e.lexiconCategory !== effectiveCategory) continue
      m.set(e.section, e.sectionTitle)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [catalog.entries, effectiveCategory])

  const counts = useMemo(() => {
    const all = listCameraLexicon()
    return {
      all: all.length,
      move: all.filter((e) => e.lexiconCategory === 'camera-move').length,
      grammar: all.filter((e) => e.lexiconCategory === 'shot-grammar').length,
    }
  }, [])

  const selected =
    (selectedKey ? entries.find((e) => e.key === selectedKey) : undefined) ?? entries[0]

  useEffect(() => {
    if (!entries.length) {
      setSelectedKey(null)
      return
    }
    if (!selectedKey || !entries.some((e) => e.key === selectedKey)) {
      setSelectedKey(entries[0].key)
    }
  }, [entries, selectedKey])

  useEffect(() => {
    if (effectiveCategory !== 'shot-grammar') setGrammarGroup('')
  }, [effectiveCategory])

  const importEntry = async (entry: CameraLexiconEntry, mode: 'asset' | 'shot') => {
    if (!projectName) {
      toast('请先选择项目')
      return
    }
    setBusy(entry.key)
    try {
      const r = await importCameraLexiconPreset(projectName, entry.key)
      if (mode === 'asset' && onPublishAsset) {
        onPublishAsset({ title: r.title, kind: 'video', url: r.url })
        toast('已发布运镜参照素材卡')
      } else if (mode === 'shot' && onPickShotRef) {
        onPickShotRef(entry, r.url)
        toast('已绑定镜头运镜参照')
      }
    } catch (e) {
      toast((e as Error).message || '导入失败')
    } finally {
      setBusy('')
    }
  }

  const resetFilters = () => {
    setSection(0)
    setGrammarGroup('')
    setQ('')
    if (!scopeLock) setViewScope('all')
  }

  const showGrammar = effectiveCategory === 'shot-grammar' || (!effectiveCategory && viewScope === 'all')

  return (
    <section className="lexicon-studio" data-lexicon-browser aria-label="镜头语言库">
      <header className="lex-hero">
        <div className="lex-hero-text">
          <h2>镜头语言库</h2>
          <p>
            白膜参照片，只对齐运镜与构图意图，不会进成片人物外观。选用后复制进项目，可发布素材卡或连到分镜。
          </p>
          <div className="lex-hero-meta">
            <span>{catalog.count} 段</span>
            <span>1080p · 24fps · 4s</span>
            <span className="lex-attrib">署名 {CAMERA_LEXICON_ATTRIBUTION}</span>
          </div>
        </div>
        {!projectName && (
          <div className="lex-hero-warn" role="status">
            请先在顶栏选择项目，才能导入并发布素材卡。
          </div>
        )}
      </header>

      <div className="lex-toolbar">
        {!scopeLock && (
          <div className="lex-scope" role="tablist" aria-label="库分类">
            {(
              [
                ['all', '全部', counts.all],
                ['camera-move', '运镜轨迹', counts.move],
                ['shot-grammar', '镜头语法', counts.grammar],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={viewScope === key}
                className={viewScope === key ? 'on' : ''}
                onClick={() => {
                  setViewScope(key)
                  setSection(0)
                }}
              >
                {label}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="lex-search-row">
          <input
            className="lex-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索中文名、英文名或 key…"
            aria-label="搜索镜头语言"
          />
          {(section > 0 || grammarGroup || q.trim() || viewScope !== 'all') && (
            <button type="button" className="btn-mini ghost" onClick={resetFilters}>
              清除筛选
            </button>
          )}
        </div>
      </div>

      <div className="lex-chapters" role="toolbar" aria-label="章节筛选">
        <button
          type="button"
          className={section === 0 ? 'on' : ''}
          onClick={() => setSection(0)}
        >
          全部章节
        </button>
        {sections.map(([n, title]) => (
          <button
            key={n}
            type="button"
            className={section === n ? 'on' : ''}
            onClick={() => setSection(n)}
            title={title}
          >
            {n}. {title}
          </button>
        ))}
      </div>

      {showGrammar && (
        <div className="lex-grammar" role="toolbar" aria-label="镜头语法分组">
          <button
            type="button"
            className={!grammarGroup ? 'on' : ''}
            onClick={() => setGrammarGroup('')}
          >
            语法·全部
          </button>
          {Object.entries(GRAMMAR_LABELS).map(([g, label]) => (
            <button
              key={g}
              type="button"
              className={grammarGroup === g ? 'on' : ''}
              onClick={() => setGrammarGroup(g)}
            >
              {g} · {label}
            </button>
          ))}
        </div>
      )}

      <div className="lex-main">
        <div className="lex-grid-wrap">
          <div className="lex-grid-head">
            <span>
              共 <b>{entries.length}</b> 条
              {q.trim() ? '（已搜索）' : ''}
            </span>
          </div>
          {entries.length === 0 ? (
            <div className="lex-empty">
              <p>没有匹配的运镜条目</p>
              <button type="button" className="btn" onClick={resetFilters}>
                重置筛选
              </button>
            </div>
          ) : (
            <div className="lex-grid" role="list">
              {entries.map((e) => (
                <LexiconTile
                  key={e.key}
                  entry={e}
                  selected={selected?.key === e.key}
                  playing={playingKey === e.key}
                  onSelect={() => setSelectedKey(e.key)}
                  onPlay={() => setPlayingKey(e.key)}
                  onStop={() => setPlayingKey((k) => (k === e.key ? null : k))}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="lex-dock" aria-label="选中条目详情">
          {selected ? (
            <>
              <div className="lex-dock-video">
                <video
                  key={selected.url}
                  src={selected.url}
                  controls
                  playsInline
                  preload="auto"
                />
              </div>
              <div className="lex-dock-body">
                <h3>{selected.cn}</h3>
                <p className="lex-dock-en">{selected.en}</p>
                <div className="lex-dock-chips">
                  <span>{selected.sectionTitle}</span>
                  {selected.grammarGroup && (
                    <span>{GRAMMAR_LABELS[selected.grammarGroup] ?? selected.grammarGroup}</span>
                  )}
                  {selected.mapsToMove && <span>运镜 {selected.mapsToMove}</span>}
                  {selected.mapsToSize && <span>景别 {selected.mapsToSize}</span>}
                </div>
                <p className="lex-dock-hint muted">
                  导入后落在项目媒体目录，与场景/道具设定分开；不会自动连线到分镜。
                </p>
                <div className="lex-dock-actions">
                  {onPublishAsset && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!projectName || busy === selected.key}
                      onClick={() => void importEntry(selected, 'asset')}
                    >
                      {busy === selected.key ? '导入中…' : '发布素材卡'}
                    </button>
                  )}
                  {onPickShotRef && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!projectName || busy === selected.key}
                      onClick={() => void importEntry(selected, 'shot')}
                    >
                      绑定当前镜头
                    </button>
                  )}
                </div>
                <footer className="lex-dock-foot">
                  <code>{selected.key}</code>
                </footer>
              </div>
            </>
          ) : (
            <div className="lex-empty lex-empty-dock">请选择左侧条目预览</div>
          )}
        </aside>
      </div>
    </section>
  )
}
