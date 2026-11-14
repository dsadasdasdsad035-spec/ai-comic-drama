import { useEffect, useMemo, useState } from 'react'
import { fetchSkillhubDetail, type SkillHubDetail, type SkillHubListItem } from '../skills/skillhubApi'
import { SkillMarketIcon } from './skillMarketUi'
import {
  SkillDetailBadge,
  SkillDetailBody,
  SkillDetailFoot,
  SkillDetailHero,
  SkillDetailModal,
  SkillDetailPanel,
  SkillDetailStat,
  SkillDetailTabs,
} from './skillDetailShell'

type Props = {
  item: SkillHubListItem
  installed: boolean
  busy: boolean
  onClose: () => void
  onInstall: () => void
}

type TabId = 'overview' | 'changelog'

export function SkillMarketDetailDialog({ item, installed, busy, onClose, onInstall }: Props) {
  const [detail, setDetail] = useState<SkillHubDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabId>('overview')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setDetail(null)
    setTab('overview')
    void fetchSkillhubDetail(item.slug, item.namespace)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || '加载详情失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.slug, item.namespace])

  const name = detail?.name || item.name
  const summary = detail?.summary || item.description
  const version = detail?.latestVersion || item.version
  const iconUrl = detail?.iconUrl || item.iconUrl
  const downloads = detail?.downloads ?? item.downloads
  const stars = detail?.stars ?? item.stars
  const homepage = detail?.homepage || item.homepage
  const category = detail?.category || item.category
  const slugLine = `${item.namespace ? `${item.namespace}/` : ''}${item.slug}`

  const hasChangelog = Boolean(detail?.changelog?.trim())
  const tabs = useMemo(
    () => [
      { id: 'overview', label: '概览' },
      { id: 'changelog', label: '更新说明', hidden: !hasChangelog },
    ],
    [hasChangelog],
  )

  return (
    <SkillDetailModal ariaLabel={`技能 ${name}`} onClose={onClose} dismissOnBackdrop={!busy}>
      <SkillDetailHero
        icon={<SkillMarketIcon name={name} iconUrl={iconUrl} large />}
        title={name}
        slug={slugLine}
        onClose={onClose}
        busy={busy}
        badges={
          <>
            {version ? <SkillDetailBadge tone="muted">v{version}</SkillDetailBadge> : null}
            {item.verified ? <SkillDetailBadge tone="accent">认证</SkillDetailBadge> : null}
            {installed ? <SkillDetailBadge tone="success">已在本机</SkillDetailBadge> : null}
          </>
        }
        stats={
          <>
            <SkillDetailStat label="下载" value={downloads} />
            <SkillDetailStat label="收藏" value={`★ ${stars}`} />
            {category ? <SkillDetailStat label="分类" value={category} /> : null}
          </>
        }
      />

      {loading ? <div className="st-modal-state">正在加载详情…</div> : null}
      {error ? <div className="st-modal-error">{error}</div> : null}

      {!loading && !error ? (
        <>
          <SkillDetailTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
          <SkillDetailBody>
            {tab === 'overview' ? (
              <SkillDetailPanel title="简介">
                <p className="skill-detail-prose">{summary || '（SkillHub 未提供简介）'}</p>
              </SkillDetailPanel>
            ) : (
              <SkillDetailPanel title="版本更新">
                <pre className="skill-detail-code">{detail?.changelog}</pre>
              </SkillDetailPanel>
            )}
          </SkillDetailBody>
        </>
      ) : null}

      <SkillDetailFoot
        start={
          homepage ? (
            <a className="btn-mini ghost" href={homepage} target="_blank" rel="noreferrer">
              在 SkillHub 打开
            </a>
          ) : null
        }
        end={
          <>
            <button type="button" className="btn-mini" disabled={busy} onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || installed}
              onClick={() => void onInstall()}
            >
              {busy ? '安装中…' : installed ? '已安装' : '安装到本机'}
            </button>
          </>
        }
      />
    </SkillDetailModal>
  )
}