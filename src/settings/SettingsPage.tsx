import CatalogDialog from './CatalogDialog'
import ExtensionsOverview from './ExtensionsOverview'
import { SettingsPaneSwitch } from './hubs/SettingsPaneSwitch'
import { HUB_COPY, HUB_NAV, HUB_PANES, type SettingsInitialSection } from './settingsNav'
import { useSettingsWorkbench } from './useSettingsWorkbench'

export type { SettingsInitialSection }

type Props = {
  toast: (m: string) => void
  onSaved?: () => void
  currentProjectName?: string
  onProjectsDeleted?: (names: string[]) => void | Promise<void>
  initialSection?: SettingsInitialSection
}

export default function SettingsPage(props: Props) {
  const wb = useSettingsWorkbench(props)

  if (wb.loading) {
    return (
      <main className="settings">
        <div className="wb-empty">加载中…</div>
      </main>
    )
  }

  const hubPanes = HUB_PANES[wb.hub]
  const showSubnav = hubPanes.length > 1

  return (
    <main className="settings settings-shell" data-settings-hub={wb.hub}>
      <aside className="st-nav" aria-label="设置枢纽">
        {HUB_NAV.map((h) => (
          <button
            key={h.id}
            type="button"
            data-settings-hub={h.id}
            className={wb.hub === h.id ? 'on' : ''}
            aria-current={wb.hub === h.id ? 'true' : undefined}
            onClick={() => wb.openHub(h.id)}
          >
            {h.label}
            {h.id === 'connections' && (
              <span className="st-nav-counts" title="渠道 · 模型">
                {wb.providers.length}·{wb.models.length}
              </span>
            )}
          </button>
        ))}
      </aside>

      <div className="st-main" data-settings-pane={wb.pane}>
        <header className="st-topbar">
          <div>
            <h2>设置 · {HUB_COPY[wb.hub].title}</h2>
            <span className="st-hint">{HUB_COPY[wb.hub].subtitle}</span>
          </div>
          <span className="spacer" />
          {wb.dirty && <span className="st-dirty">未保存</span>}
          <button className="btn primary" onClick={() => void wb.save()} disabled={wb.saving || !wb.dirty}>
            {wb.saving ? '保存中…' : '保存设置'}
          </button>
        </header>

        {showSubnav && (
          <div
            className={`st-subnav${wb.hub === 'extensions' ? ' st-subnav--dense' : ''}`}
            role="tablist"
            aria-label={`${HUB_COPY[wb.hub].title} 子页`}
          >
            {hubPanes.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                data-settings-pane={p.id}
                className={wb.pane === p.id ? 'on' : ''}
                aria-selected={wb.pane === p.id}
                onClick={() => wb.openSettingsPane(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="st-statusbar">
          {wb.missingKeys.length === 0 && wb.billing.length === 0 && wb.invalidDefaults.length === 0 ? (
            <span className="st-status-ok">渠道与默认路由正常</span>
          ) : (
            <>
              {wb.missingKeys.length > 0 && (
                <button type="button" className="st-status-chip bad" onClick={() => wb.openSettingsPane('providers')}>
                  缺 Key {wb.missingKeys.length}
                </button>
              )}
              {wb.billing.length > 0 && (
                <button type="button" className="st-status-chip bad" onClick={() => wb.openSettingsPane('providers')}>
                  余额不足 {wb.billing.length}
                </button>
              )}
              {wb.invalidDefaults.length > 0 && (
                <button type="button" className="st-status-chip warn" onClick={() => wb.openSettingsPane('routing')}>
                  失效默认 {wb.invalidDefaults.length}
                </button>
              )}
            </>
          )}
        </div>

        <div className="st-scroll">
          {wb.pane === 'overview' && (
            <ExtensionsOverview skillCount={wb.skillRows.length} onOpen={wb.openSettingsPane} />
          )}
          <SettingsPaneSwitch pane={wb.pane} wb={wb} />
        </div>
      </div>

      {wb.catalogProvider && (
        <CatalogDialog
          provider={wb.catalogProvider}
          models={wb.models}
          onClose={() => wb.setCatalogProvider(null)}
          onApply={wb.applyCatalog}
        />
      )}
    </main>
  )
}