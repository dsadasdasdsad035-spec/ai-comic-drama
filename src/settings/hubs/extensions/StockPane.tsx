import type { StockProviderId } from '../../../stock/types'
import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { STOCK_PROVIDERS } from '../../settingsStockMeta'

type Props = { wb: SettingsWorkbench }

export function StockPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-stock data-settings-pane="stock">
      <header className="st-sec-head">
        <h3>素材库</h3>
        <span className="st-hint">
          在线素材来自公开图库：检索在服务端完成，渲染出的结果会下载到当前项目。Key 只存本地设置库或环境变量，读取时不回传原文。
        </span>
        <span className="spacer" />
        <button type="button" className="btn" data-stock-test disabled={wb.stockTesting} onClick={() => void wb.testStock()}>
          {wb.stockTesting ? '检测中…' : '检测可用性'}
        </button>
      </header>

      <div data-settings-media-ingest className="st-media-ingest-block">
        <h4 className="st-subhead">平台链接下载（素材页）</h4>
        <span className="st-hint">
          配置 yt-dlp / DTK 后，在<strong>素材页 → 链接下载</strong>将抖音、B 站等链落成视频素材；白模几何页从项目视频选片分析。创意会话反推仍仅支持本地上传。
        </span>
        <div className="st-grid">
          <label className="st-field">
            <span>yt-dlp 可执行文件</span>
            <input
              data-creative-ytdlp-bin
              value={wb.creative.ingest?.ytdlp?.bin || ''}
              placeholder="/opt/homebrew/bin/yt-dlp"
              onChange={(e) => wb.setIngest({ ytdlp: { bin: e.target.value } })}
            />
            <em>未安装可执行文件时该适配器显示为不可用</em>
          </label>
          <label className="st-field">
            <span>启用 yt-dlp</span>
            <select
              data-creative-ytdlp-enabled
              value={wb.creative.ingest?.ytdlp?.enabled ? 'on' : 'off'}
              onChange={(e) => {
                const on = e.target.value === 'on'
                if (on && !String(wb.creative.ingest?.ytdlp?.bin || '').trim()) {
                  wb.toast('先填写 yt-dlp 可执行文件路径，再启用')
                  return
                }
                wb.setIngest({ ytdlp: { enabled: on } })
              }}
            >
              <option value="off">关闭</option>
              <option value="on">启用</option>
            </select>
            <em>用于抖音 / B 站 / TikTok 链接；失败不会静默改用其他适配器</em>
          </label>
          <label className="st-field">
            <span>读取浏览器 cookies</span>
            <select
              data-creative-ytdlp-cookies
              value={wb.creative.ingest?.ytdlp?.cookiesFromBrowser || ''}
              onChange={(e) => wb.setIngest({ ytdlp: { cookiesFromBrowser: e.target.value } })}
            >
              <option value="">不读取</option>
              <option value="chrome">Chrome</option>
              <option value="safari">Safari</option>
              <option value="edge">Edge</option>
              <option value="firefox">Firefox</option>
            </select>
            <em>抖音/TikTok 需要新鲜 cookies；只在本机读取，不上传不落盘</em>
          </label>
          <label className="st-field">
            <span>cookies 文件（可选）</span>
            <input
              data-creative-ytdlp-cookies-file
              value={wb.creative.ingest?.ytdlp?.cookiesFile || ''}
              placeholder="导出的 Netscape cookies.txt 路径"
              onChange={(e) => wb.setIngest({ ytdlp: { cookiesFile: e.target.value } })}
            />
            <em>填了浏览器来源时以浏览器为准</em>
          </label>
          <label className="st-field">
            <span>DTK 服务地址</span>
            <input
              data-creative-dtk-url
              value={wb.creative.ingest?.dtk?.baseUrl || ''}
              placeholder="http://127.0.0.1:8000"
              onChange={(e) => wb.setIngest({ dtk: { baseUrl: e.target.value } })}
            />
            <em>可选的独立下载服务；只用到 parse_url 与 download_media</em>
          </label>
          <label className="st-field">
            <span>DTK API Key</span>
            <input
              type="password"
              data-creative-dtk-key
              value={wb.creative.ingest?.dtk?.apiKey || ''}
              placeholder={(wb.creative.ingest?.dtk as { hasApiKey?: boolean })?.hasApiKey ? '已保存（留空保持不变）' : '可留空'}
              onChange={(e) => wb.setIngest({ dtk: { apiKey: e.target.value } })}
            />
            <em>只存本地设置库；不写进聊天消息与日志</em>
          </label>
          <label className="st-field">
            <span>启用 DTK</span>
            <select
              data-creative-dtk-enabled
              value={wb.creative.ingest?.dtk?.enabled ? 'on' : 'off'}
              onChange={(e) => wb.setIngest({ dtk: { enabled: e.target.value === 'on' } })}
            >
              <option value="off">关闭</option>
              <option value="on">启用</option>
            </select>
            <em>需要自己部署 DTK（Postgres + Redis + 浏览器容器）</em>
          </label>
          <div className="st-field">
            <span>适配器状态</span>
            <div className="flex flex-wrap items-center gap-1.5" data-creative-adapters>
              {(wb.adapters || []).map((a) => (
                <span
                  key={a.id}
                  className={`st-status-chip ${a.ok ? 'ok' : 'warn'}`}
                  title={a.reason || '可用'}
                >
                  {a.label}
                  {a.ok ? '' : ' · 不可用'}
                </span>
              ))}
              <button type="button" className="btn" onClick={() => void wb.refreshAdapters()} data-creative-test-adapters>
                检测可用性
              </button>
            </div>
            <em>{wb.adapterError || '检测只读本地配置，不发起下载'}</em>
          </div>
        </div>
      </div>

      <h4 className="st-subhead">在线图库</h4>

      <div className="st-grid">
        {STOCK_PROVIDERS.map((p) => {
          const id = p.id as StockProviderId
          const cfg = wb.stock.providers[id] || { enabled: false, baseUrl: '', hasApiKey: false }
          const status = wb.stockStatus[id]
          return (
            <div key={p.id} className="st-field st-stock-card" data-stock-provider-card={p.id} data-stock-kind={p.kind}>
              <span>
                {p.label}
                <em>{p.hint}</em>
              </span>
              {p.kind === 'link' ? (
                <div className="st-stock-row">
                  <span>启用</span>
                  <span className="st-status-chip ok">固定开启（只提供外链）</span>
                </div>
              ) : (
                <label className="st-stock-row">
                  <span>启用</span>
                  <select
                    data-stock-enabled={p.id}
                    value={cfg.enabled ? 'on' : 'off'}
                    onChange={(e) => wb.patchStock(id, { enabled: e.target.value === 'on' })}
                  >
                    <option value="off">关闭</option>
                    <option value="on">启用</option>
                  </select>
                </label>
              )}
              {p.kind === 'api' ? (
                <label className="st-stock-row">
                  <span>API Key</span>
                  <input
                    type="password"
                    data-stock-key={p.id}
                    value={cfg.hasApiKey ? '' : ''}
                    placeholder={
                      cfg.hasApiKey
                        ? '已保存（留空保持不变）'
                        : p.requiresKey
                          ? `可留空沿用 ${p.envKey}`
                          : `可选；留空沿用 ${p.envKey}`
                    }
                    onChange={(e) => wb.patchStock(id, { apiKey: e.target.value, hasApiKey: false })}
                  />
                </label>
              ) : (
                <div className="st-stock-row">
                  <span>API Key</span>
                  <span className="st-hint">不需要 Key</span>
                </div>
              )}
              <label className="st-stock-row">
                <span>Base URL</span>
                <input
                  data-stock-base={p.id}
                  value={cfg.baseUrl || ''}
                  placeholder={p.baseUrl}
                  onChange={(e) => wb.patchStock(id, { baseUrl: e.target.value })}
                />
              </label>
              <div className="st-status-row">
                {cfg.hasApiKey ? <span className="st-status-chip ok">已保存 Key</span> : null}
                {cfg.keyFromEnv ? <span className="st-status-chip ok">来自环境变量</span> : null}
                {p.kind === 'html' ? <span className="st-status-chip">页面解析</span> : null}
                {p.kind === 'link' ? <span className="st-status-chip">仅外链</span> : null}
                {status ? (
                  <span className={`st-status-chip ${status.ok ? 'ok' : 'warn'}`} title={status.reason || '可用'}>
                    {status.ok ? '可用' : `不可用：${status.reason || '未配置'}`}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
