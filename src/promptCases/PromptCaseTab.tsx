import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectAsset } from '../api'
import { BOARD_LIST_PAGE_SIZE } from '../boardListFilter'
import { BoardListToolbar } from '../BoardListToolbar'
import ImportDialog from './ImportDialog'
import PromptCaseDetail, { copyText } from './PromptCaseDetail'
import PromptCaseGrid from './PromptCaseGrid'
import ReversePanel from './ReversePanel'
import {
  deletePromptCase,
  listPromptCases,
  patchPromptCase,
  type PromptCase,
  type PromptCaseFacets,
  type PromptCaseQuery,
} from './api'

const PAGE_SIZE = 12

const EMPTY_FACETS: PromptCaseFacets = { total: 0, favorites: 0, bySource: {}, models: [], categories: [] }

/**
 * 提示词案例 Tab。
 *
 * 全局作用域：换项目不影响列表。服务端分页 + 筛选，搜索走服务端
 * （关键词要能命中提示词正文，前端拿不到全部正文）。
 */
export default function PromptCaseTab({
  projectName,
  assets,
  selectedShot,
  onApplyCase,
  toast,
  onCountChange,
  importOpen,
  onImportOpenChange,
  reverseOpen,
  onReverseOpenChange,
  refreshKey,
}: {
  projectName: string
  assets: ProjectAsset[]
  selectedShot: { id: string; no: string } | null
  onApplyCase?: (caseId: string, slot: 'prompt' | 'videoPrompt') => void
  toast: (m: string) => void
  onCountChange: (n: number) => void
  importOpen: boolean
  onImportOpenChange: (open: boolean) => void
  reverseOpen: boolean
  onReverseOpenChange: (open: boolean) => void
  refreshKey: number
}) {
  const [cases, setCases] = useState<PromptCase[]>([])
  const [facets, setFacets] = useState<PromptCaseFacets>(EMPTY_FACETS)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [source, setSource] = useState('')
  const [model, setModel] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [localRefresh, setLocalRefresh] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(query.trim()), 220)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, source, model, favorite])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q: PromptCaseQuery = {
        q: debouncedQ,
        source,
        model,
        favorite,
        page,
        pageSize: PAGE_SIZE,
      }
      const r = await listPromptCases(q)
      setCases(r.cases)
      setFacets(r.facets)
      setTotal(r.total)
      setTotalPages(r.totalPages)
      onCountChange(r.facets.total)
      // 选中项不在当前页时清掉，避免详情与列表对不上
      setSelectedId((cur) => (cur && r.cases.some((c) => c.id === cur) ? cur : ''))
    } catch (e) {
      setError((e as Error).message || '读取案例失败')
      setCases([])
    } finally {
      setLoading(false)
    }
    // onCountChange 是父组件的 setState，稳定；不放进依赖避免重复取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, source, model, favorite, page, refreshKey, localRefresh])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(() => cases.find((c) => c.id === selectedId) || null, [cases, selectedId])

  const onCopy = useCallback(
    async (text: string, label: string) => {
      const ok = await copyText(text)
      toast(ok ? `已复制${label}` : '复制失败，请手动选中文本')
    },
    [toast],
  )

  const onToggleFavorite = useCallback(async () => {
    if (!selected) return
    try {
      const next = await patchPromptCase(selected.id, { favorite: !selected.favorite })
      setCases((list) => list.map((c) => (c.id === next.id ? next : c)))
      // 收藏是筛选维度之一：改了就要重新取，否则当前筛选下的列表会失真
      setLocalRefresh((n) => n + 1)
    } catch (e) {
      toast((e as Error).message || '更新失败')
    }
  }, [selected, toast])

  const onSaveNote = useCallback(
    async (note: string) => {
      if (!selected) return
      try {
        const next = await patchPromptCase(selected.id, { note })
        setCases((list) => list.map((c) => (c.id === next.id ? next : c)))
        toast('备注已保存')
      } catch (e) {
        toast((e as Error).message || '保存失败')
      }
    },
    [selected, toast],
  )

  const onDelete = useCallback(async () => {
    if (!selected) return
    const label = selected.title || selected.id
    if (!window.confirm(`从案例库删除「${label}」？源视频与拆解作业不会被删除。`)) return
    setBusy('delete')
    try {
      await deletePromptCase(selected.id)
      setSelectedId('')
      setLocalRefresh((n) => n + 1)
      toast('已从案例库删除')
    } catch (e) {
      toast((e as Error).message || '删除失败')
    } finally {
      setBusy('')
    }
  }, [selected, toast])

  const onApply = useCallback(
    (slot: 'prompt' | 'videoPrompt') => {
      if (!selected || !selectedShot) return
      onApplyCase?.(selected.id, slot)
    },
    [selected, selectedShot, onApplyCase],
  )

  const sourceOptions = [
    { id: '', label: `全部 ${facets.total}` },
    { id: 'vflow', label: `vflow ${facets.bySource.vflow || 0}` },
    { id: 'reverse-own', label: `我的反推 ${facets.bySource['reverse-own'] || 0}` },
    { id: 'manual', label: `手工 ${facets.bySource.manual || 0}` },
  ]

  return (
    <div className="pc-tab" data-prompt-case-tab-panel>
      <div className="pc-filters">
        <div className="pc-source-tabs" role="tablist" aria-label="案例来源">
          {sourceOptions.map((o) => (
            <button
              key={o.id || 'all'}
              type="button"
              role="tab"
              aria-selected={source === o.id}
              className={source === o.id ? 'on' : ''}
              onClick={() => setSource(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="pc-filter-right">
          {facets.models.length ? (
            <select
              className="pc-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="按模型筛选"
            >
              <option value="">全部模型</option>
              {facets.models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.model}（{m.count}）
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className={favorite ? 'btn-mini primary' : 'btn-mini ghost'}
            onClick={() => setFavorite((v) => !v)}
            title="只看收藏"
          >
            ★ 收藏 {facets.favorites || 0}
          </button>
        </div>
      </div>

      {total > 0 ? (
        <BoardListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="搜索标题或提示词正文…"
          ariaLabel="搜索提示词案例"
          filteredCount={total}
          totalCount={facets.total}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
        />
      ) : null}

      {error ? <p className="board-hint pc-import-error">{error}</p> : null}
      {loading && !cases.length ? <div className="char-empty-board">正在读取案例库…</div> : null}

      <div className={`pc-layout ${selected ? 'with-detail' : ''}`}>
        <PromptCaseGrid
          cases={cases}
          selectedId={selectedId}
          onSelect={(c) => setSelectedId((cur) => (cur === c.id ? '' : c.id))}
          onImport={() => onImportOpenChange(true)}
          onReverse={() => onReverseOpenChange(true)}
        />
        {selected ? (
          <PromptCaseDetail
            key={selected.id}
            item={selected}
            canApply={Boolean(selectedShot)}
            applyHint={selectedShot ? `当前镜头 ${selectedShot.no}` : '先到画布选一个镜头，再回到这里应用'}
            busy={busy === 'delete'}
            onCopy={(text, label) => void onCopy(text, label)}
            onApply={onApply}
            onToggleFavorite={() => void onToggleFavorite()}
            onSaveNote={(note) => void onSaveNote(note)}
            onDelete={() => void onDelete()}
          />
        ) : null}
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => onImportOpenChange(false)}
        onImported={() => setLocalRefresh((n) => n + 1)}
        toast={toast}
      />
      <ReversePanel
        open={reverseOpen}
        projectName={projectName}
        assets={assets}
        onClose={() => onReverseOpenChange(false)}
        onAdopted={() => setLocalRefresh((n) => n + 1)}
        toast={toast}
      />
    </div>
  )
}
