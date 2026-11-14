import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import type { ProviderKind } from '../../../api'
import { CAP_TO_PC, KIND_META, PROVIDER_CAPS, PROVIDER_PRESETS, capsOf, kindShortLabel, providerInitial, providerKeyPlaceholder, type AddPreset } from '../../settingsMeta'

type Props = { wb: SettingsWorkbench }

export function ProvidersPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="providers">
      <header className="st-sec-head">
        <h3>渠道</h3>
        <span className="st-hint">每个渠道只出现一次；用途决定它能出现在哪些能力里。</span>
        <span className="spacer" />
        <div className="st-add-wrap">
          <button className="btn" onClick={() => wb.setAddMenu((v) => !v)}>
            + 添加渠道
          </button>
          {wb.addMenu && (
            <>
              <div className="st-menu-backdrop" onClick={() => wb.setAddMenu(false)} />
              <div className="st-menu" role="menu">
                {PROVIDER_PRESETS.map((preset) => {
                  const exists = Boolean(preset.id) && wb.providers.some((p) => p.id === preset.id)
                  return (
                    <button
                      key={preset.id || 'custom'}
                      role="menuitem"
                      disabled={exists}
                      onClick={() => wb.addProviderFromPreset(preset)}
                    >
                      <b>{preset.label}</b>
                      <em>{preset.note}</em>
                      {exists && <span>已存在</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="st-providers">
        {wb.providers.map((p) => {
          const result = wb.tested[p.id]
          const badge = result
            ? result.ok
              ? '可用'
              : result.kind === 'billing'
                ? '余额不足'
                : result.kind === 'auth'
                  ? '鉴权失败'
                  : '不可用'
            : p.keyAvailable === false
              ? '缺 Key'
              : p.keyAvailable
                ? '已配置'
                : '未测试'
          const badgeClass = result
            ? result.ok
              ? 'ok'
              : 'bad'
            : p.keyAvailable === false
              ? 'bad'
              : p.keyAvailable
                ? 'ok'
                : 'muted'
          const count = wb.models.filter((m) => m.provider === p.id).length
          const isPreset = PROVIDER_PRESETS.some((x) => x.id === p.id)
          const connOpen = p.keyAvailable === false || Boolean(String(p.apiKey || '').trim())
          return (
            <article
              key={p.id}
              className={`st-prov st-prov-card st-prov-card--${badgeClass}`}
              data-pid={p.id}
            >
              <header className="st-prov-card-head">
                <div className="st-prov-avatar" aria-hidden>
                  {providerInitial(p.label, p.id)}
                </div>
                <div className="st-prov-card-titles">
                  <input
                    className="st-prov-name"
                    value={p.label}
                    aria-label="渠道显示名"
                    onChange={(e) => wb.patchProvider(p.id, { label: e.target.value })}
                  />
                  <div className="st-prov-card-meta">
                    {isPreset ? (
                      <span className="st-kind-badge">{kindShortLabel(p.kind)}</span>
                    ) : (
                      <select
                        className="st-prov-kind-select"
                        value={p.kind}
                        aria-label="渠道类型"
                        onChange={(e) => wb.patchProvider(p.id, { kind: e.target.value as ProviderKind })}
                      >
                        {KIND_META.map((k) => (
                          <option key={k.kind} value={k.kind}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="st-prov-model-pill">{count} 个模型</span>
                  </div>
                </div>
                <span className={`st-badge ${badgeClass}`}>{badge}</span>
              </header>

              {p.note ? <p className="st-prov-card-desc">{p.note}</p> : null}

              <details className="st-prov-details" open={connOpen}>
                <summary>连接配置</summary>
                <div className="st-prov-fields">
                  <label className="st-field">
                    <span>Base URL</span>
                    <input value={p.baseUrl} onChange={(e) => wb.patchProvider(p.id, { baseUrl: e.target.value })} />
                  </label>
                  <label className="st-field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={p.apiKey || ''}
                      placeholder={providerKeyPlaceholder(p.kind)}
                      onChange={(e) => wb.patchProvider(p.id, { apiKey: e.target.value, keyAvailable: undefined })}
                    />
                  </label>
                </div>
              </details>

              <div className="st-prov-caps">
                <span className="st-cap-label">用途</span>
                {PROVIDER_CAPS.map((x) => (
                  <button
                    key={x.pc}
                    type="button"
                    className={`st-cap ${capsOf(p).includes(x.pc) ? 'on' : ''}`}
                    onClick={() => wb.toggleProviderCap(p, x.pc)}
                    title={`这个渠道是否承接${x.label}`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>

              <footer className="st-prov-foot">
                {p.kind === 'apimart' && (
                  <button type="button" className="btn-mini" onClick={() => wb.openCatalog(p)}>
                    同步目录
                  </button>
                )}
                <button
                  type="button"
                  className="btn-mini"
                  disabled={!!wb.testing[p.id]}
                  onClick={() => void wb.runTest(p)}
                  title="用最轻的请求验证 Key / baseUrl"
                >
                  {wb.testing[p.id] ? '测试中…' : '测试'}
                </button>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn-mini danger"
                  onClick={() => wb.removeProvider(p)}
                  title="删除渠道及其模型"
                >
                  删除
                </button>
              </footer>

              {result && (
                <div className={`st-test ${result.ok ? 'ok' : 'bad'}`}>
                  <b>{result.ok ? '可用' : '不可用'}</b>
                  {typeof result.latency === 'number' && result.latency > 0 ? ` · ${result.latency}ms` : ''}
                  {' · '}
                  {result.message}
                  {result.endpoint && <code className="st-test-ep">{result.endpoint}</code>}
                </div>
              )}
            </article>
          )
        })}
        {wb.providers.length === 0 && (
          <div className="st-empty-state st-model-empty">还没有渠道，点右上角「+ 添加渠道」开始配置</div>
        )}
      </div>
    </section>
  )
}
