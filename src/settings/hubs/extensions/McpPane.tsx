import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { McpSettingsPanel } from '../../McpSettingsPanel'

type Props = { wb: SettingsWorkbench }

export function McpPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-section="mcp" data-settings-pane="mcp">
      <header className="st-sec-head">
        <h3>MCP</h3>
        <span className="st-hint">市场安装与凭据配置；勾选「创意聊天」后工具会进入创意工作室 Pi 循环。</span>
      </header>
      <McpSettingsPanel toast={wb.toast} />
    </section>
  )
}
