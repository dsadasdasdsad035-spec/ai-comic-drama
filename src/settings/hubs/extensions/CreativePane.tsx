import type { SettingsWorkbench } from '../../useSettingsWorkbench'

type Props = { wb: SettingsWorkbench }

export function CreativePane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-creative data-settings-pane="creative">
      <header className="st-sec-head">
        <h3>创意会话</h3>
        <span className="st-hint">
          创意工作室为 Pi 纯聊天，不绑定项目；顶栏选定项目后可用内置 read/submit 写回。平台链接下载在<strong>素材页</strong>
          ，解析器在「素材库」。
        </span>
      </header>

      <div className="st-hint" data-creative-pi-doc style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 8px' }}>聊天只需配置以下三项（无能力绑定 / 反推切镜表单项）：</p>
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>
            <strong>默认路由</strong> →「创意（对话助手）」：主对话模型
          </li>
          <li>
            <strong>技能</strong> → SkillHub 安装任意 Agent 包作宿主
          </li>
          <li>
            <strong>MCP</strong> → 勾选「创意聊天」以合并外部工具（生图、检索等）
          </li>
        </ol>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn" data-creative-goto-routing onClick={() => wb.openSettingsPane('routing')}>
          打开默认路由
        </button>
        <button
          type="button"
          className="btn"
          data-creative-goto-skills
          onClick={() => {
            wb.openSettingsPane('skills')
            wb.setSkillsSubview('market')
          }}
        >
          打开 SkillHub
        </button>
        <button type="button" className="btn" data-creative-goto-mcp onClick={() => wb.openSettingsPane('mcp')}>
          打开 MCP
        </button>
      </div>

      <p className="st-hint" style={{ margin: 0 }}>
        旧版创意「能力绑定 / 分析与成本」已从界面移除；本机若曾保存过相关字段仍会随设置读写，供{' '}
        <code>/api/creative/*</code> 脚本与后续扩展使用。
      </p>
    </section>
  )
}
