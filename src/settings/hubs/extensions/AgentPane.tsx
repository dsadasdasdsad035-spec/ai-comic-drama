import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { AGENT_LIMIT_DEFAULTS, AGENT_LIMIT_RANGES, normalizeAgentLimits } from '../../../agent/agentLimits'
import { normalizeAgentHostMode } from '../../../agent/agentHostMode'

type Props = { wb: SettingsWorkbench }

export function AgentPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="agent">
      <header className="st-sec-head">
        <h3>Agent 运行上限</h3>
        <span className="st-hint">
          白模工作台（素材 → 镜头语言 → 自定义白模）agent 的总运行时长上限；超过会显示运行超时。线程按项目 +
          白模条目恢复，关闭工作台会释放 Blender 沙箱并取消运行中的本轮。
        </span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>总运行时长（秒）</span>
          <input
            type="number"
            min={AGENT_LIMIT_RANGES.totalSeconds.min}
            max={AGENT_LIMIT_RANGES.totalSeconds.max}
            step="1"
            value={wb.agentLimits.totalSeconds}
            onChange={(e) => {
              const raw = e.target.value
              wb.setAgentLimits((prev) => ({
                ...prev,
                totalSeconds: raw.trim() === '' ? AGENT_LIMIT_DEFAULTS.totalSeconds : Number(raw),
              }))
            }}
            onBlur={() => wb.setAgentLimits(normalizeAgentLimits(wb.agentLimits))}
          />
          <em>默认 {AGENT_LIMIT_DEFAULTS.totalSeconds} 秒；范围 {AGENT_LIMIT_RANGES.totalSeconds.min}–{AGENT_LIMIT_RANGES.totalSeconds.max}</em>
        </label>
        <label className="st-field">
          <span>聊天工具能力</span>
          <em data-agent-capability>{wb.sceneCapabilityText}</em>
        </label>
        <label className="st-field">
          <span>白模工作台 Agent 宿主权限</span>
          <select
            value={wb.agentHostMode}
            onChange={(e) => wb.setAgentHostMode(normalizeAgentHostMode(e.target.value))}
          >
            <option value="full_host">full_host（默认：job 沙箱 bash/文件 + adopt）</option>
            <option value="restricted">restricted（仅 set_scene_code，无 shell）</option>
          </select>
          <em>
            full_host 在本机 job 沙箱执行 shell；写入项目仍须 adopt（或 set_scene_code）与 run_render、finish。
          </em>
        </label>
      </div>
      <h4 className="st-subhead">兼容字段</h4>
      <div className="st-grid">
        <label className="st-field">
          <span>ARK API Key（旧字段）</span>
          <input
            type="password"
            value={wb.apiKey}
            placeholder="留空 = 沿用 ~/.canghe-skills/.env"
            onChange={(e) => wb.setApiKey(e.target.value)}
          />
          <em>建议改在「渠道」里填；这里留作兼容</em>
        </label>
      </div>
    </section>
  )
}
