import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchSkillhubCategories,
  installSkillFromSkillhub,
  searchSkillhubMarket,
  uploadSkillZip,
  type SkillHubListItem,
} from '../skills/skillhubApi'
import { reloadSkills } from '../skills/registry'
import type { SkillTextRecord } from '../skills/types'
import { SkillMarketDetailDialog } from './SkillMarketDetailDialog'
import { SkillMarketIcon } from './skillMarketUi'

type Props = {
  installedIds: Set<string>
  installedSlugs: Set<string>
  onInstalled: (record: SkillTextRecord) => void | Promise<void>
  toast: (message: string) => void
}

export function SkillMarketPanel({ installedIds, installedSlugs, onInstalled, toast }: Props) {
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<Array<{ key: string; name: string }>>([])
  const [items, setItems] = useState<SkillHubListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [busySlug, setBusySlug] = useState('')
  const [zipBusy, setZipBusy] = useState(false)
  const [detailItem, setDetailItem] = useState<SkillHubListItem | null>(null)

  const installedKey = useMemo(
    () => (item: SkillHubListItem) => `${item.namespace || ''}:${item.slug}`,
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const out = await searchSkillhubMarket({ keyword, category, page, pageSize: 24 })
      setItems(out.items)
      setTotal(out.total)
    } catch (e) {
      toast((e as Error).message || '加载 SkillHub 失败')
    } finally {
      setLoading(false)
    }
  }, [category, keyword, page, toast])

  useEffect(() => {
    void fetchSkillhubCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const install = async (item: SkillHubListItem) => {
    setBusySlug(installedKey(item))
    try {
      const record = await installSkillFromSkillhub({
        slug: item.slug,
        namespace: item.namespace,
        version: item.version,
      })
      await reloadSkills()
      await onInstalled(record)
      toast(`已安装技能「${record.id}」`)
    } catch (e) {
      toast((e as Error).message || '安装失败')
    } finally {
      setBusySlug('')
    }
  }

  const onZipPick = async (file: File | null) => {
    if (!file) return
    setZipBusy(true)
    try {
      const record = await uploadSkillZip(file)
      await reloadSkills()
      await onInstalled(record)
      toast(`已上传并安装「${record.id}」· 已切换到已安装列表`)
    } catch (e) {
      toast((e as Error).message || '上传失败')
    } finally {
      setZipBusy(false)
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / 24))

  return (
    <div className="skill-market" data-skill-market>
      <p className="st-hint" style={{ margin: '0 0 10px' }}>
        数据来自{' '}
        <a href="https://skillhub.cn" target="_blank" rel="noreferrer">
          SkillHub
        </a>
        ；安装写入本机 SQLite，重启后仍有效。创意工作室任选 <strong>Agent 包</strong> 作宿主即可。
      </p>

      <div className="skill-market-toolbar">
        <input
          type="search"
          className="st-input skill-market-search"
          placeholder="搜索技能，如 creative、反推、分镜…"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setPage(1)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
        />
        <select
          className="st-input"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setPage(1)
          }}
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? '搜索中…' : '搜索'}
        </button>
        <label className="btn" style={{ cursor: zipBusy ? 'wait' : 'pointer' }}>
          {zipBusy ? '上传中…' : '上传 zip'}
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            disabled={zipBusy}
            onChange={(e) => void onZipPick(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      {loading && items.length === 0 ? <p className="st-hint">正在加载市场…</p> : null}
      {!loading && items.length === 0 ? <p className="st-hint">没有匹配的技能，换个关键词试试。</p> : null}

      <div className="skill-market-grid">
        {items.map((item) => {
          const busy = busySlug === installedKey(item)
          const installed =
            installedSlugs.has(installedKey(item)) || installedIds.has(item.slug)
          return (
            <article
              key={`${item.namespace}:${item.slug}`}
              className={`skill-market-card${installed ? ' installed' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`查看技能 ${item.name}`}
              onClick={() => setDetailItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDetailItem(item)
                }
              }}
            >
              <div className="skill-market-card-head">
                <SkillMarketIcon name={item.name || item.slug} iconUrl={item.iconUrl} />
                <div className="skill-market-card-titles">
                  <span className="st-skill-name skill-market-card-name">
                    {item.name}
                    {item.verified ? <span className="st-hint"> · 认证</span> : null}
                  </span>
                  <span className="st-hint">
                    {item.namespace ? `${item.namespace}/` : ''}
                    {item.slug}
                  </span>
                </div>
              </div>
              <p className="skill-market-card-desc">{item.description || '（无简介）'}</p>
              <div className="skill-market-card-meta">
                <span className="st-hint">
                  v{item.version || '?'} · 下载 {item.downloads} · ★ {item.stars}
                </span>
                <button
                  type="button"
                  className="btn-mini skill-market-card-install"
                  disabled={busy || installed}
                  onClick={(e) => {
                    e.stopPropagation()
                    void install(item)
                  }}
                >
                  {busy ? '安装中…' : installed ? '已安装' : '安装'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {detailItem ? (
        <SkillMarketDetailDialog
          item={detailItem}
          installed={
            installedSlugs.has(installedKey(detailItem)) || installedIds.has(detailItem.slug)
          }
          busy={busySlug === installedKey(detailItem)}
          onClose={() => setDetailItem(null)}
          onInstall={() => void install(detailItem)}
        />
      ) : null}

      {total > 24 ? (
        <div className="skill-market-pager">
          <button type="button" className="btn-mini" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span className="st-hint">
            {page} / {maxPage}（共 {total}）
          </span>
          <button
            type="button"
            className="btn-mini"
            disabled={page >= maxPage || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  )
}
