import type { McpMarketItem } from '../mcp/mcpApi'
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
import { useMemo, useState } from 'react'

type TabId = 'overview' | 'connection'

type Props = {
  item: McpMarketItem
  installed: boolean
  busy: boolean
  onClose: () => void
  onInstall: () => void
}

function authTypeLabel(t: string): string {
  if (t === 'github-token') return 'GitHub Token'
  if (t === 'bearer') return 'Bearer'
  if (!t || t === 'none') return '无'
  return t
}

export function McpMarketDetailDialog({ item, installed, busy, onClose, onInstall }: Props) {
  const [tab, setTab] = useState<TabId>('overview')
  const canInstall = Boolean(item.url?.trim())

  const tabs = useMemo(
    () => [
      { id: 'overview', label: '概览' },
      { id: 'connection', label: '连接' },
    ],
    [],
  )

  return (
    <SkillDetailModal ariaLabel={`MCP ${item.name}`} onClose={onClose} dismissOnBackdrop={!busy}>
      <SkillDetailHero
        icon={<SkillMarketIcon name={item.name} iconUrl={item.iconUrl} large />}
        title={item.name}
        slug={item.id}
        onClose={onClose}
        busy={busy}
        badges={
          <>
            {item.category ? <SkillDetailBadge tone="muted">{item.category}</SkillDetailBadge> : null}
            {item.official ? <SkillDetailBadge tone="accent">官方</SkillDetailBadge> : null}
            <SkillDetailBadge tone="muted">{item.transport || 'http'}</SkillDetailBadge>
            {installed ? <SkillDetailBadge tone="success">已添加</SkillDetailBadge> : null}
          </>
        }
        stats={
          <>
            <SkillDetailStat label="认证" value={authTypeLabel(item.authType)} />
            <SkillDetailStat label="标签" value={item.tags?.length ? item.tags.length : '—'} />
          </>
        }
      />

      <SkillDetailTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

      <SkillDetailBody>
        {tab === 'overview' ? (
          <>
            <SkillDetailPanel title="说明">
              <p className="skill-detail-prose">{item.description || '（无说明）'}</p>
            </SkillDetailPanel>
            {item.tags?.length ? (
              <div className="mcp-detail-tags">
                {item.tags.map((t) => (
                  <SkillDetailBadge key={t} tone="muted">
                    {t}
                  </SkillDetailBadge>
                ))}
              </div>
            ) : null}
            {!canInstall ? (
              <p className="st-hint skill-detail-callout">该条目尚未配置远程 URL，暂无法添加到本机。</p>
            ) : (
              <p className="st-hint skill-detail-callout">
                添加后可在「已配置」里填写凭据，并勾选「创意聊天」让 Pi 合并此外部工具。
              </p>
            )}
          </>
        ) : (
          <SkillDetailPanel title="端点与传输">
            <dl className="mcp-detail-dl">
              <dt>传输</dt>
              <dd>{item.transport || 'http'}</dd>
              <dt>URL</dt>
              <dd className="mono">{item.url?.trim() || '（未配置）'}</dd>
              <dt>认证方式</dt>
              <dd>{authTypeLabel(item.authType)}</dd>
            </dl>
            {item.aliases?.length ? (
              <>
                <h4 className="skill-detail-panel-title">别名</h4>
                <p className="st-hint mono">{item.aliases.join(' · ')}</p>
              </>
            ) : null}
          </SkillDetailPanel>
        )}
      </SkillDetailBody>

      <SkillDetailFoot
        start={null}
        end={
          <>
            <button type="button" className="btn-mini" disabled={busy} onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || installed || !canInstall}
              onClick={() => void onInstall()}
            >
              {busy ? '添加中…' : installed ? '已添加' : '添加到本机'}
            </button>
          </>
        }
      />
    </SkillDetailModal>
  )
}