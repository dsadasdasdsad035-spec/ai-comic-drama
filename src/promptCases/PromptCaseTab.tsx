import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectAsset } from '../api'
import { BOARD_LIST_PAGE_SIZE } from '../boardListFilter'
import { BoardListToolbar } from '../BoardListToolbar'
import FacetFilterRail from './FacetFilterRail'
import ImportDialog from './ImportDialog'
import PromptCaseDetail, { copyText } from './PromptCaseDetail'
import PromptCaseGrid from './PromptCaseGrid'
import ReversePanel from './ReversePanel'
import {
  deletePromptCase,
  getPromptCase,
  listPromptCases,
  patchPromptCase,
  patchPromptCaseFacets,
  type FacetCount,
  type PromptCase,
  type PromptCaseFacet,
  type PromptCaseFacets,
  type PromptCaseQuery,
} from './api'
import { facetChipLabel, facetKey, parseFacetKey } from './taxonomy'

const PAGE_SIZE = 12

const EMPTY_FACETS: PromptCaseFacets = { total: 0, favorites: 0, bySource: {}, models: [], categories: [] }

/**
 * 提示词案例 Tab。
 *
 * 全局作用域：换项目不影响列表。服务端分页 + 筛选，搜索走服务端
 * （关键词要能命中提示词正文，前端拿不到全部正文）。
 *
 * 分面筛选与服务端保持同一语义：`facet=axis:value` 重复出现，同轴 OR、跨轴 AND。
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
}) {
  const [cases, setCases] = useState<PromptCase[]>([])
  const [facets, setFacets] = useState<PromptCaseFacets>(EMPTY_FACETS)
  const [facetCounts, setFacetCounts] = useState<FacetCount[]>([])
  const [selectedFacets, setSelectedFacets] = useState<string[]>([])
  const [soloCounts, setSoloCounts] = useState<Array<{ label: string; count: number }>>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [source, setSource] = useState('')
  const [model, setModel] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [suppressedFacets, setSuppressedFacets] = useState<PromptCaseFacet[]>([])
  const [busy, setBusy] = useState('')
  const [localRefresh, setLocalRefresh] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const facetKeyStr = selectedFacets.join(',')

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(query.trim()), 220)
    return () => window.clearTimeout(t)
  }, [query])

  /** 筛选条件指纹：一变就该回到第 1 页，且此前发出的请求一律作废 */
  const filterKey = useMemo(
    () => [debouncedQ, source, model, favorite, facetKeyStr].join('\u0001'),
    [debouncedQ, source, model, favorite, facetKeyStr],
  )

  /**
   * 页码跟着筛选条件走。
   *
   * 不用 `useEffect(() => setPage(1), [筛选])`：那样筛选变化的那次提交里，
   * 取数 effect 会先拿着旧页码发一次请求，回来晚于新请求时会把第 1 页的结果
   * 覆盖成第 N 页的（列表与分页条对不上）。这里在渲染期就把页码算成 1。
   */
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setPageState((cur) => {
        const base = cur.key === filterKey ? cur.page : 1
        const raw = typeof next === 'function' ? next(base) : next
        const value = Math.max(1, Math.floor(Number(raw) || 1))
        if (cur.key === filterKey && cur.page === value) return cur
        return { key: filterKey, page: value }
      })
    },
    [filterKey],
  )

  /** 请求序号：只采纳最后一次发出的响应 */
  const reqSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
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
        facets: selectedFacets,
      }
      const r = await listPromptCases(q)
      if (seq !== reqSeq.current) return
      setCases(r.cases)
      setFacets(r.facets)
      setFacetCounts(r.facetCounts)
      setTotal(r.total)
      setTotalPages(r.totalPages)
      // 服务端会把越界页码夹紧（删掉末页最后一条、筛选后页数变少），
      // 只回写 totalPages 会让分页条出现「第 3 / 2 页」——页码也要跟着回正。
      setPage(r.page)
      onCountChange(r.facets.total)
      // 选中项不在当前页时清掉，避免详情与列表对不上
      setSelectedId((cur) => (cur && r.cases.some((c) => c.id === cur) ? cur : ''))
    } catch (e) {
      if (seq !== reqSeq.current) return
      setError((e as Error).message || '读取案例失败')
      setCases([])
      setFacetCounts([])
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
    // onCountChange 是父组件的 setState，稳定；不放进依赖避免重复取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, source, model, favorite, page, localRefresh, facetKeyStr, setPage])

  useEffect(() => {
    void load()
  }, [load])

  // 选中案例时补拉被隐藏的分面：列表接口不返回隐藏值，详情里要能「恢复」
  useEffect(() => {
    if (!selectedId) {
      setSuppressedFacets([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const one = await getPromptCase(selectedId)
        if (cancelled) return
        setSuppressedFacets(one.suppressedFacets || [])
        setCases((list) => list.map((c) => (c.id === one.id ? { ...c, ...one } : c)))
      } catch {
        /* 详情补充失败不影响主体浏览；列表里已有可见分面 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // 空结果时逐条单独回查，告诉用户是哪一条把结果掐断的
  useEffect(() => {
    if (total !== 0 || !selectedFacets.length) {
      setSoloCounts([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const rows = await Promise.all(
          selectedFacets.map(async (f) => {
            const r = await listPromptCases({
              q: debouncedQ,
              source,
              model,
              favorite,
              facets: [f],
              pageSize: 1,
            })
            return { label: facetChipLabel(parseFacetKey(f)), count: r.total }
          }),
        )
        if (!cancelled) setSoloCounts(rows)
      } catch {
        if (!cancelled) setSoloCounts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [total, facetKeyStr, debouncedQ, source, model, favorite, selectedFacets])

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

  const onFacetChange = useCallback(
    async (patch: { add?: string[]; remove?: string[]; restore?: string[] }) => {
      if (!selected) return
      try {
        const next = await patchPromptCaseFacets(selected.id, patch)
        setCases((list) =>
          list.map((c) =>
            c.id === next.id ? { ...c, ...next, facets: next.facets ?? [] } : c,
          ),
        )
        setSuppressedFacets(next.suppressedFacets || [])
        setLocalRefresh((n) => n + 1)
        toast('分面已更新')
      } catch (e) {
        toast((e as Error).message || '分面更新失败')
      }
    },
    [selected, toast],
  )

  const onApply = useCallback(
    (slot: 'prompt' | 'videoPrompt') => {
      if (!selected || !selectedShot) return
      onApplyCase?.(selected.id, slot)
    },
    [selected, selectedShot, onApplyCase],
  )

  const toggleFacet = useCallback((axis: string, value: string) => {
    const key = facetKey(axis, value)
    setSelectedFacets((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  }, [])

  const clearFilters = useCallback(() => {
    setQuery('')
    setSource('')
    setModel('')
    setFavorite(false)
    setSelectedFacets([])
    setDrawerOpen(false)
  }, [])

  // 任何一条筛选生效都算「筛过」，否则搜不到时的空态会误报「案例库还是空的」
  const hasAnyFilter = Boolean(debouncedQ || source || model || favorite || selectedFacets.length)

  const sourceOptions = [
    { id: '', label: `全部 ${facets.total}` },
    { id: 'vflow', label: `vflow ${facets.bySource.vflow || 0}` },
    { id: 'reverse-own', label: `我的反推 ${facets.bySource['reverse-own'] || 0}` },
    { id: 'manual', label: `手工 ${facets.bySource.manual || 0}` },
  ]

  const rail = (
    <FacetFilterRail
      counts={facetCounts}
      selected={selectedFacets}
      onToggle={toggleFacet}
      onClear={() => setSelectedFacets([])}
    />
  )

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
          <button
            type="button"
            className="btn-mini ghost pc-facet-toggle"
            onClick={() => setDrawerOpen(true)}
            data-facet-drawer-open
          >
            分类筛选{selectedFacets.length ? `（${selectedFacets.length}）` : ''}
          </button>
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

      {selectedFacets.length ? (
        <div className="pc-selected-facets" data-selected-facets>
          {selectedFacets.map((key) => (
            <button
              key={key}
              type="button"
              className="pc-facet-chip on"
              data-facet-chip={key}
              onClick={() => {
                const { axis, value } = parseFacetKey(key)
                toggleFacet(axis, value)
              }}
            >
              {facetChipLabel(parseFacetKey(key))}
              <em>×</em>
            </button>
          ))}
          <button type="button" className="btn-mini ghost" onClick={clearFilters} data-clear-filters>
            清空筛选
          </button>
        </div>
      ) : null}

      {/* 用库内总数判断是否显示搜索框，不能用当前结果数：搜到 0 条时若把搜索框也撤掉，
          用户就再没有地方改回关键词，只能绕到「清空筛选」。 */}
      {facets.total > 0 ? (
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

      {/* 详情不再占列：列表列数与选中状态无关，任何时候都不重排 */}
      <div className="pc-layout">
        <div className="pc-facet-col" data-facet-col>
          {rail}
        </div>
        <PromptCaseGrid
          cases={cases}
          selectedId={selectedId}
          loading={loading}
          onSelect={(c) => setSelectedId((cur) => (cur === c.id ? '' : c.id))}
          onImport={() => onImportOpenChange(true)}
          onReverse={() => onReverseOpenChange(true)}
          filteredZero={total === 0 && hasAnyFilter}
          filteredHint={soloCounts}
          onClearFilters={clearFilters}
          scrollKey={`${filterKey}\u0001${page}`}
        />
      </div>

      {selected ? (
        <PromptCaseDetail
          key={selected.id}
          item={selected}
          canApply={Boolean(selectedShot)}
          applyHint={selectedShot ? `当前镜头 ${selectedShot.no}` : '先到画布选一个镜头，再回到这里应用'}
          busy={busy === 'delete'}
          suppressedFacets={suppressedFacets}
          onCopy={(text, label) => void onCopy(text, label)}
          onApply={onApply}
          onToggleFavorite={() => void onToggleFavorite()}
          onSaveNote={(note) => void onSaveNote(note)}
          onDelete={() => void onDelete()}
          onClose={() => setSelectedId('')}
          onFacetChange={(patch) => void onFacetChange(patch)}
        />
      ) : null}

      {drawerOpen ? (
        <div className="pc-facet-drawer" role="dialog" aria-label="分类筛选">
          <button
            type="button"
            className="pc-facet-backdrop"
            aria-label="关闭分类筛选"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="pc-facet-drawer-panel" data-facet-drawer>
            <div className="pc-facet-drawer-head">
              <b>分类筛选</b>
              <button type="button" className="btn-mini ghost" onClick={() => setDrawerOpen(false)}>
                关闭
              </button>
            </div>
            {rail}
            <button type="button" className="btn primary" onClick={() => setDrawerOpen(false)}>
              查看 {total} 条结果
            </button>
          </div>
        </div>
      ) : null}

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
