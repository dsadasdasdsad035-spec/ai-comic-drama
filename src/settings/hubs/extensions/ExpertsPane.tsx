import type { SettingsWorkbench } from '../../useSettingsWorkbench'

type Props = { wb: SettingsWorkbench }

/**
 * 创意专家：管理与选择都在创意会话宿主里（`/studio/` 的设置页），
 * 应用这一侧只保留一句说明与入口，不再复刻一套表单。
 *
 * 理由：专家的 manifest 与 soul 是宿主读取的配置（`<DSH_HOME>/experts/<id>/`），
 * 在这里编辑等于让两个界面写同一份文件；谁最后保存谁赢，冲突无解。
 */
export function ExpertsPane({ wb }: Props) {
  return (
    <section className="st-sec" data-settings-section="experts" data-settings-pane="experts">
      <header className="st-sec-head">
        <h3>创意专家</h3>
        <span className="st-hint">专家已迁到创意会话宿主：在创意页的设置里新建、编辑与导入导出。</span>
      </header>
      <p className="st-hint">
        专家的 persona 与技能/工具白名单保存在宿主配置目录，本应用只读取它来生成会话预设。 要新增专家，请进入创意页（`/studio/`）→
        设置 → 专家。
      </p>
      <button type="button" className="btn" onClick={() => wb.toast('请从左侧「创意」进入宿主设置页管理专家')}>
        打开创意会话
      </button>
    </section>
  )
}
