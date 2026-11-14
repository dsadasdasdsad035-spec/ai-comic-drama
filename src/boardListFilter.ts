import { useEffect, useMemo, useState } from 'react'
import type { ProjectAsset, DesignSheet } from './api'
import type { CharacterSheet } from './characters'
import type { BoardEpisodeRow } from './board/episodeCover'
import { formatEpisodeLabel } from './shotRows'

export const BOARD_LIST_PAGE_SIZE = 12

function includesQ(hay: string, q: string): boolean {
  return hay.toLowerCase().includes(q)
}

export function characterListMatch(c: CharacterSheet, q: string): boolean {
  return includesQ(
    [c.id, c.name, c.role, c.lookCn, c.lookEn, c.palette, c.age || '', ...(c.keywords || [])].join(' '),
    q,
  )
}

export function designListMatch(d: DesignSheet, q: string): boolean {
  return includesQ(
    [d.id, d.name, d.summaryCn, d.promptEn, ...(d.keywords || []), ...(d.refs || [])].join(' '),
    q,
  )
}

export function boardEpisodeMatch(row: BoardEpisodeRow, q: string): boolean {
  return includesQ(
    [
      String(row.no),
      formatEpisodeLabel(row.no),
      row.title,
      String(row.shotCount),
      row.targetSeconds != null ? `${row.targetSeconds}` : '',
    ].join(' '),
    q,
  )
}

export function episodePickerMatch(
  ep: { no: number; title?: string; hook?: string },
  shotCount: number,
  q: string,
): boolean {
  const pad = String(ep.no).padStart(2, '0')
  return includesQ([String(ep.no), `e${pad}`, ep.title || '', ep.hook || '', String(shotCount)].join(' '), q)
}

export function videoAssetListMatch(a: ProjectAsset, q: string): boolean {
  const url = String(a.url || '')
  const file = url.split('?')[0].split('/').pop() || ''
  return includesQ([a.title || '', a.note || '', url, file, String(a.kind || '')].join(' '), q)
}

export function useBoardListFilter<T>(
  items: T[],
  match: (item: T, q: string) => boolean,
  pageSize = BOARD_LIST_PAGE_SIZE,
  resetKey?: string | number,
) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setQuery('')
    setPage(1)
  }, [resetKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => match(item, q))
  }, [items, query, match])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const slice = useMemo(() => {
    const start = (pageSafe - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, pageSafe, pageSize])

  return {
    query,
    setQuery,
    page: pageSafe,
    setPage,
    filtered,
    slice,
    totalPages,
    pageSize,
    totalCount: items.length,
    filteredCount: filtered.length,
  }
}