import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteMcpServer,
  fetchMcpMarket,
  installMcpFromMarket,
  listMcpServers,
  patchMcpServer,
  type McpMarketItem,
  type McpServerConfig,
} from '../mcp/mcpApi'
import { SkillMarketIcon } from './skillMarketUi'
import { McpMarketDetailDialog } from './McpMarketDetailDialog'
import { McpInstalledDetailDialog } from './McpInstalledDetailDialog'

function notifyCreativeMcpChange(onCreativeMcpChange?: () => void) {
  onCreativeMcpChange?.()
  window.dispatchEvent(new Event('creative-mcp-changed'))
}

type Props = {
  toast: (message: string) => void
  onCreativeMcpChange?: () => void
}

export function McpSettingsPanel({ toast, onCreativeMcpChange }: Props) {
  const [view, setView] = useState<'market' | 'installed'>('market')
  const [keyword, setKeyword] = useState('')
  const [installedQuery, setInstalledQuery] = useState('')
  const [market, setMarket] = useState<McpMarketItem[]>([])
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [marketDetail, setMarketDetail] = useState<McpMarketItem | null>(null)
  const [installedDetail, setInstalledDetail] = useState<McpServerConfig | null>(null)

  const installedMarketIds = useMemo(
    () => new Set(servers.map((s) => s.marketId).filter(Boolean)),
    [servers],
  )

  const refreshServers = useCallback(async () => {
    try {
      const list = await listMcpServers()
      setServers(list)
      setInstalledDetail((cur) => (cur ? list.find((s) => s.id === cur.id) ?? null : null))
    } catch (e) {
      toast((e as Error).message || '读取 MCP 配置失败')
    }
  }, [toast])

  const searchMarket = useCallback(async () => {
    setLoading(true)
    try {
      setMarket(await fetchMcpMarket({ keyword }))
    } catch (e) {
      toast((e as Error).message || '加载 MCP 市场失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, toast])

  useEffect(() => {
    void refreshServers()
  }, [refreshServers])

  useEffect(() => {
    if (view === 'market') void searchMarket()
  }, [view, searchMarket])

  const install = async (marketId: string) => {
    setBusyId(marketId)
    try {
      await installMcpFromMarket(marketId)
      await refreshServers()
      toast('已添加到 MCP 配置')
      notifyCreativeMcpChange(onCreativeMcpChange)
      setMarketDetail(null)
    } catch (e) {
      toast((e as Error).message || '安装失败')
    } finally {
      setBusyId('')
    }
  }

  const toggleCreative = async (row: McpServerConfig) => {
    setBusyId(row.id)
    try {
      await patchMcpServer(row.id, { creativeChat: !row.creativeChat })
      await refreshServers()
      notifyCreativeMcpChange(onCreativeMcpChange)
      toast(row.creativeChat ? '已从创意聊天移除' : '已接入创意聊天')
    } catch (e) {
      toast((e as Error).message || '保存失败')
    } finally {
      setBusyId('')
    }
  }

  const saveAuth = async (row: McpServerConfig, authSecret: string) => {
    setBusyId(row.id)
    try {
      await patchMcpServer(row.id, { authSecret })
      await refreshServers()
      toast('凭据已保存')
    } catch (e) {
      toast((e as Error).message || '保存失败')
    } finally {
      setBusyId('')
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('确定删除该 MCP 配置？')) return
    setBusyId(id)
    try {
      await deleteMcpServer(id)
      await refreshServers()
      notifyCreativeMcpChange(onCreativeMcpChange)
      setInstalledDetail(null)
      toast('已删除')
    } catch (e) {
      toast((e as Error).message || '删除失败')
    } finally {
      setBusyId('')
    }
  }

  const filteredServers = useMemo(() => {
    const q = installedQuery.trim().toLowerCase()
    if (!q) return servers
    return servers.filter((s) =>
      [s.id, s.name, s.description, s.url, s.transport, s.marketId].join(' ').toLowerCase().includes(q),
    )
  }, [servers, installedQuery])

  return (
    <div className="skill-market mcp-settings" data-mcp-settings>
      <p className="st-hint mcp-settings-hint">
        MCP 工具经<strong>本机服务端</strong>代理调用（HTTP 传输）；在详情里勾选「创意聊天」后，创意工作室 Pi
        循环会合并对应工具。stdio 类型需另行在本机配置网关，暂不在创意内直接启动。
      </p>

      <div className="mcp-scope-switch" role="tablist" aria-label="MCP 视图">
        <button type="button" className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
          MCP 市场
        </button>
        <button type="button" className={view === 'installed' ? 'active' : ''} onClick={() => setView('installed')}>
          已配置 ({servers.length})
        </button>
      </div>

      {view === 'market' ? (
        <>
          <div className="skill-market-toolbar">
            <input
              type="search"
              className="st-input skill-market-search"
              placeholder="搜索 MCP 名称、分类…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void searchMarket()}
              aria-label="搜索 MCP 市场"
            />
            <button type="button" className="btn" onClick={() => void searchMarket()} disabled={loading}>
              {loading ? '加载中…' : '搜索'}
            </button>
          </div>
          {loading && market.length === 0 ? <p className="st-hint">正在加载市场…</p> : null}
          {!loading && market.length === 0 ? <p className="st-hint">没有匹配的 MCP。</p> : null}
          <div className="skill-market-grid" data-mcp-market-grid>
            {market.map((item) => {
              const installed = installedMarketIds.has(item.id)
              const busy = busyId === item.id
              return (
                <article
                  key={item.id}
                  className={`skill-market-card mcp-market-card${installed ? ' installed' : ''}`}
                  data-mcp-market={item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 MCP ${item.name}`}
                  onClick={() => setMarketDetail(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setMarketDetail(item)
                    }
                  }}
                >
                  <div className="skill-market-card-head">
                    <SkillMarketIcon name={item.name} iconUrl={item.iconUrl} />
                    <div className="skill-market-card-titles">
                      <span className="st-skill-name skill-market-card-name">
                        {item.name}
                        {item.official ? <span className="st-hint"> · 官方</span> : null}
                      </span>
                      <span className="st-hint">{item.category}</span>
                    </div>
                  </div>
                  <p className="skill-market-card-desc">{item.description || '（无说明）'}</p>
                  <div className="skill-market-card-meta">
                    <span className="st-hint">{item.transport} · {authShort(item.authType)}</span>
                    <button
                      type="button"
                      className="btn-mini skill-market-card-install"
                      disabled={busy || installed || !item.url}
                      onClick={(e) => {
                        e.stopPropagation()
                        void install(item.id)
                      }}
                    >
                      {busy ? '…' : installed ? '已添加' : item.url ? '添加' : '无 URL'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      ) : (
        <>
          {servers.length > 0 ? (
            <div className="skill-market-toolbar">
              <input
                type="search"
                className="st-input skill-market-search"
                placeholder="搜索已配置 MCP…"
                value={installedQuery}
                onChange={(e) => setInstalledQuery(e.target.value)}
                aria-label="搜索已配置 MCP"
              />
              <span className="st-hint board-list-toolbar-meta">
                {installedQuery.trim()
                  ? `匹配 ${filteredServers.length} / ${servers.length}`
                  : `共 ${servers.length} 个`}
              </span>
            </div>
          ) : null}
          {servers.length === 0 ? (
            <p className="st-hint">还没有 MCP，请从市场添加。</p>
          ) : filteredServers.length === 0 ? (
            <p className="st-hint">没有匹配的配置。</p>
          ) : (
            <div className="skill-market-grid" data-mcp-installed-grid>
              {filteredServers.map((row) => (
                <article
                  key={row.id}
                  className="skill-market-card mcp-installed-card"
                  data-mcp-server-card={row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`配置 ${row.name}`}
                  onClick={() => setInstalledDetail(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setInstalledDetail(row)
                    }
                  }}
                >
                  <div className="skill-market-card-head">
                    <SkillMarketIcon name={row.name} iconUrl={row.iconUrl} />
                    <div className="skill-market-card-titles">
                      <span className="st-skill-name skill-market-card-name">{row.name}</span>
                      <span className="skill-catalog-badge">{row.transport}</span>
                    </div>
                  </div>
                  <p className="skill-market-card-desc">{row.description || row.url || '（无说明）'}</p>
                  <div className="skill-market-card-meta">
                    <span className="st-hint">
                      {row.creativeChat ? '创意聊天 · 已接入' : '创意聊天 · 关'}
                      {row.hasAuthSecret ? ' · 凭据 OK' : row.authType !== 'none' ? ' · 待凭据' : ''}
                    </span>
                    <span className="st-hint skill-catalog-open">详情</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {marketDetail ? (
        <McpMarketDetailDialog
          item={marketDetail}
          installed={installedMarketIds.has(marketDetail.id)}
          busy={busyId === marketDetail.id}
          onClose={() => setMarketDetail(null)}
          onInstall={() => void install(marketDetail.id)}
        />
      ) : null}

      {installedDetail ? (
        <McpInstalledDetailDialog
          row={installedDetail}
          busy={busyId === installedDetail.id}
          onClose={() => setInstalledDetail(null)}
          onToggleCreative={() => void toggleCreative(installedDetail)}
          onSaveAuth={(secret) => void saveAuth(installedDetail, secret)}
          onRemove={() => void remove(installedDetail.id)}
        />
      ) : null}
    </div>
  )
}

function authShort(t: string): string {
  if (t === 'github-token') return 'GitHub'
  if (t === 'bearer') return 'Bearer'
  if (!t || t === 'none') return '无认证'
  return t
}