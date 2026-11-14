import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { lockedContractText } from '../../settingsMeta'
import { SkillMarketPanel } from '../../SkillMarketPanel'
import { SkillInstalledCatalog } from '../../SkillInstalledCatalog'

type Props = { wb: SettingsWorkbench }

export function SkillsPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-section="skills" data-settings-pane="skills">
      <header className="st-sec-head">
        <h3>技能</h3>
        <span className="st-hint">
          安装 SkillHub 通用 Agent 包作创意 / 工作台 Pi 宿主；平台 submit 为内置工具。上传与 SkillHub 来源只读正文；内置 legacy（3D）可覆盖保存。
        </span>
      </header>
      <div className="mcp-scope-switch" style={{ margin: '0 0 12px' }} role="tablist" aria-label="技能视图">
        <button
          type="button"
          className={wb.skillsSubview === 'market' ? 'active' : ''}
          onClick={() => wb.setSkillsSubview('market')}
        >
          SkillHub 市场
        </button>
        <button
          type="button"
          className={wb.skillsSubview === 'catalog' ? 'active' : ''}
          onClick={() => wb.setSkillsSubview('catalog')}
        >
          已安装 ({wb.skillRows.length})
        </button>
      </div>
      {wb.skillsSubview === 'market' ? (
        <SkillMarketPanel
          installedIds={wb.installedSkillIds}
          installedSlugs={wb.installedSkillSlugs}
          onInstalled={async (record) => {
            wb.applySkillRecord(record)
            await wb.refreshSkills()
            wb.setSkillsSubview('catalog')
          }}
          toast={wb.toast}
        />
      ) : null}
      {wb.skillsSubview === 'catalog' ? (
        <SkillInstalledCatalog
          rows={wb.skillRows}
          skillEdits={wb.skillEdits}
          skillBusy={wb.skillBusy}
          sourceLabel={wb.skillSourceLabel}
          lockedContract={lockedContractText}
          onPatchEdit={wb.patchSkillEdit}
          onSave={(row) => void wb.saveOneSkill(row)}
          onReset={(row) => void wb.resetOneSkill(row)}
          onUninstall={(row) => void wb.uninstallOneSkill(row)}
        />
      ) : null}
    </section>
  )
}
