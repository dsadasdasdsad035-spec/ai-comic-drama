# Spec Delta

## ADDED Requirements

### Requirement: 写工具成功落库后须向应用壳暴露变更

经创意宿主执行、且在应用进程成功落库的平台写工具（含 `submit_*`、删除镜头、项目元数据写回及会产生落库的 `set_*` 类工具），应用 MUST 在一次成功执行结束时向连接中的浏览器壳提供可观测信号，使壳能得知**哪个项目**的数据已变更及其**当前 revision**。信号 MUST 在失败、审批拒绝、参数校验未通过或专家闸门拒绝时不出现。壳 MUST NOT 需要重启应用或切换项目才能获知该次写已成功。

#### Scenario: 创意内提交分镜后壳可观测

- **WHEN** 操作员在创意会话批准 `submit_shots` 且写库成功
- **THEN** 同一浏览器窗口内顶栏所选项目的外壳能在下一次对齐周期内获知 revision 已升高，而不必重启应用

#### Scenario: 写失败无信号

- **WHEN** 模型调用 `submit_episodes` 但操作员在审批卡拒绝
- **THEN** 不产生壳侧变更信号，外壳展示的数据与拒绝前一致

#### Scenario: 非当前项目不写信号

- **WHEN** 工具参数显式写入的项目名与顶栏当前记录的项目名不一致且写库发生在另一项目
- **THEN** 仅对该被写入项目发布变更信号；顶栏当前项目的壳快照不因该次调用被误刷新

### Requirement: 写后实况推送与壳刷新协同

写工具成功且外壳刷新项目快照后，浏览器 MUST 尽快推送与刚落库 revision 一致的 `canvas-context`，使后续读工具在 revision 门控下可安全合并实况。推送前读工具 MUST 仅以落库为准（与 `studio-read-live-view` 一致）。

#### Scenario: 写后先库后实况

- **WHEN** `submit_shots` 成功且外壳尚未完成刷新与实况推送
- **THEN** 专家紧接着调用的 `read_shot_detail` 返回与刚落库一致，不被刷新前旧画布节点覆盖

#### Scenario: 写后实况对齐

- **WHEN** 外壳完成刷新并推送含新 `projectRevision` 的实况
- **THEN** 同一项目、revision 一致时，读工具 MAY 按既有规则合并画布手改字段