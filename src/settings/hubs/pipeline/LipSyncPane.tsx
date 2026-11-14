import type { LipSyncSettings } from '../../../api'
import type { SettingsWorkbench } from '../../useSettingsWorkbench'

type Props = { wb: SettingsWorkbench }

export function LipSyncPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="lipsync">
      <header className="st-sec-head">
        <h3>口型</h3>
        <span className="st-hint">
          默认关闭。provider 模式只用于单说话人镜头，每次提交前还会再确认；Key 只存设置库，不写进项目。
        </span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>Provider</span>
          <select
            value={wb.lipSync.provider}
            onChange={(e) => wb.setLipSync({ ...wb.lipSync, provider: e.target.value as LipSyncSettings['provider'] })}
          >
            <option value="off">关闭</option>
            <option value="sync-labs">Sync Labs</option>
          </select>
          <em>关闭时仍可使用 prompt 模式与本地抽帧验收</em>
        </label>
        <label className="st-field">
          <span>Base URL</span>
          <input
            value={wb.lipSync.baseUrl ?? ''}
            onChange={(e) => wb.setLipSync({ ...wb.lipSync, baseUrl: e.target.value })}
            placeholder="https://api.sync.so"
          />
          <em>只用于 provider 模式</em>
        </label>
        <label className="st-field">
          <span>API Key</span>
          <input
            type="password"
            value={wb.lipSync.apiKey ?? ''}
            onChange={(e) => wb.setLipSync({ ...wb.lipSync, apiKey: e.target.value })}
            placeholder="留空 = 沿用 .env 的 SYNC_LABS_API_KEY"
          />
          <em>不写入项目、日志和证据</em>
        </label>
        <label className="st-field">
          <span>估算 · 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={wb.lipSync.pricePerSecond ?? 0}
            onChange={(e) => wb.setLipSync({ ...wb.lipSync, pricePerSecond: Number(e.target.value) || 0 })}
          />
          <em>0 = 不计入成本估算</em>
        </label>
      </div>
      <p className="st-hint" style={{ marginTop: 8 }}>
        多说话人镜头暂不支持 provider 口型；请拆成单人镜，或继续用 prompt 模式 + 抽帧人工验收。
      </p>
    </section>
  )
}
