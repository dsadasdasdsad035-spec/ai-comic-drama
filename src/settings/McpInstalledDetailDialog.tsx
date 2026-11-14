import { useEffect, useMemo, useState } from 'react'
import type { McpServerConfig } from '../mcp/mcpApi'
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

type TabId = 'overview' | 'connection' | 'advanced'

type Props = {
  row: McpServerConfig
  busy: boolean
  onClose: () => void
  onToggleCreative: () => void
  onSaveAuth: (secret: string) => void
  onRemove: () => void
}

function authTypeLabel(t: string): string {
  if (t === 'github-token') return 'GitHub Token'
  if (t === 'bearer') return 'Bearer'
  if (!t || t === 'none') return '无'
  return t
}

export function McpInstalledDetailDialog({
  row,
  busy,
  onClose,
  onToggleCreative,
  onSaveAuth,
  onRemove,
}: Props) {
  const [tab, setTab] = useState<TabId>('overview')
  const [token, setToken] = useState('')
  const needsAuth = row.authType && row.authType !== 'none'
  const creativeOk = row.transport === 'http' && Boolean(row.url?.trim())

  useEffect(() => {
    setTab('overview')
    setToken('')
  }, [row.id])

  const headerCount = Object.keys(row.headers || {}).length
  const envCount = Object.keys(row.environment || {}).length

  const tabs = useMemo(
    () => [
      { id: 'overview', label: '概览' },
      { id: 'connection', label: '凭据' },
      {
        id: 'advanced',
        label: '高级',
        hidden: !row.command && !(row.args?.length) && !headerCount && !envCount,
      },
    ],
    [row.command, row.args, headerCount, envCount],
  )

  return (
    <SkillDetailModal
      ariaLabel={`MCP ${row.name}`}
      className="mcp-installed-detail"
      onClose={onClose}
      dismissOnBackdrop={!busy}
    >
      <div data-mcp-server={row.id}>
        <SkillDetailHero
          icon={<SkillMarketIcon name={row.name} iconUrl={row.iconUrl} large />}
          title={row.name}
          slug={row.id}
          onClose={onClose}
          busy={busy}
          badges={
            <>
              <SkillDetailBadge tone="muted">{row.transport}</SkillDetailBadge>
              {row.creativeChat ? (
                <SkillDetailBadge tone="success">创意聊天</SkillDetailBadge>
              ) : (
                <SkillDetailBadge tone="muted">未接入聊天</SkillDetailBadge>
              )}
              {needsAuth ? (
                <SkillDetailBadge tone={row.hasAuthSecret ? 'success' : 'warn'}>
                  {row.hasAuthSecret ? '凭据已保存' : '待填凭据'}
                </SkillDetailBadge>
              ) : null}
            </>
          }
          stats={
            <>
              <SkillDetailStat label="超时" value={`${row.timeoutSec}s`} />
              <SkillDetailStat label="请求头" value={headerCount || '—'} />
              <SkillDetailStat label="环境变量" value={envCount || '—'} />
            </>
          }
        />

        <SkillDetailTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

        <SkillDetailBody>
          {tab === 'overview' ? (
            <>
              {row.description ? (
                <SkillDetailPanel title="说明">
                  <p className="skill-detail-prose">{row.description}</p>
                </SkillDetailPanel>
              ) : null}
              <SkillDetailPanel title="创意工作室">
                <label className="mcp-detail-switch">
                  <input
                    type="checkbox"
                    checked={row.creativeChat}
                    disabled={busy || !creativeOk}
                    onChange={onToggleCreative}
                  />
                  <span>
                    <strong>接入创意聊天</strong>
                    <em className="st-hint">
                      {creativeOk
                        ? '开启后，创意 Pi 会合并该 MCP 暴露的工具。'
                        : '仅 HTTP 且已配置 URL 的服务可接入。'}
                    </em>
                  </span>
                </label>
              </SkillDetailPanel>
              <p className="st-hint skill-detail-callout">
                调用经本机服务端代理，密钥不会写入浏览器本地存储明文日志。
              </p>
            </>
          ) : null}

          {tab === 'connection' ? (
            <SkillDetailPanel title="端点" hint={needsAuth ? '凭据保存在服务端 SQLite' : undefined}>
              <dl className="mcp-detail-dl">
                <dt>传输</dt>
                <dd>{row.transport}</dd>
                <dt>URL</dt>
                <dd className="mono break-all">{row.url?.trim() || '（未配置）'}</dd>
                <dt>认证</dt>
                <dd>{authTypeLabel(row.authType)}</dd>
              </dl>
              {needsAuth ? (
                <label className="skill-detail-field">
                  <span>
                    访问凭据 {row.hasAuthSecret ? '（已保存，留空不改）' : '（必填后工具才可调用）'}
                  </span>
                  <input
                    type="password"
                    className="st-input"
                    value={token}
                    placeholder={row.authType === 'github-token' ? 'GitHub PAT' : 'Bearer Token'}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={busy || !token.trim()}
                    onClick={() => {
                      onSaveAuth(token.trim())
                      setToken('')
                    }}
                  >
                    保存凭据
                  </button>
                </label>
              ) : (
                <p className="st-hint">该服务无需额外凭据。</p>
              )}
            </SkillDetailPanel>
          ) : null}

          {tab === 'advanced' ? (
            <SkillDetailPanel title="启动参数与环境" hint="市场模板自带，一般无需修改">
              <dl className="mcp-detail-dl">
                {row.command ? (
                  <>
                    <dt>命令</dt>
                    <dd className="mono">{row.command}</dd>
                  </>
                ) : null}
                {row.args?.length ? (
                  <>
                    <dt>参数</dt>
                    <dd className="mono">{row.args.join(' ')}</dd>
                  </>
                ) : null}
              </dl>
              {headerCount > 0 ? (
                <>
                  <h4 className="skill-detail-panel-title">请求头</h4>
                  <pre className="skill-detail-code">{JSON.stringify(row.headers, null, 2)}</pre>
                </>
              ) : null}
              {envCount > 0 ? (
                <>
                  <h4 className="skill-detail-panel-title">环境变量</h4>
                  <pre className="skill-detail-code">{JSON.stringify(row.environment, null, 2)}</pre>
                </>
              ) : null}
              {!row.command && !headerCount && !envCount ? (
                <p className="st-hint">无额外高级配置。</p>
              ) : null}
            </SkillDetailPanel>
          ) : null}
        </SkillDetailBody>

        <SkillDetailFoot
          start={
            <button type="button" className="btn-mini danger" disabled={busy} onClick={onRemove}>
              删除配置
            </button>
          }
          end={
            <button type="button" className="btn-mini" disabled={busy} onClick={onClose}>
              关闭
            </button>
          }
        />
      </div>
    </SkillDetailModal>
  )
}