import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { ExpertSettingsPanel } from '../../ExpertSettingsPanel'

type Props = { wb: SettingsWorkbench }

export function ExpertsPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-section="experts" data-settings-pane="experts">
      <header className="st-sec-head">
        <h3>创意专家</h3>
        <span className="st-hint">内置模板 + 自定义 soul；创意顶栏选中后约束 Pi 的技能与工具白名单。</span>
      </header>
      <ExpertSettingsPanel toast={wb.toast} />
    </section>
  )
}
