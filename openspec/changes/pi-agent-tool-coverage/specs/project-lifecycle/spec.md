# Spec Delta

## ADDED Requirements

### Requirement: 新建项目可经 Agent 工具触发

系统 SHALL 提供新建项目的 Agent 工具入口，与界面入口共用同一套规则：目录名只接受字母、数字、下划线与短横且不超过 40 字符；同名项目已存在时 MUST 失败且 MUST NOT 覆盖既有项目。

工具 MUST 在落库前取得用户确认，MUST NOT 自行切换当前选中项目。创建成功后 MUST 返回新项目标识，由宿主决定是否切换上下文。

#### Scenario: 从对话新建项目

- **WHEN** agent 在确认卡中选择了一个合法目录名并确认
- **THEN** 项目被创建，回执给出项目标识，当前选中的项目保持不变

#### Scenario: 目录名非法

- **WHEN** agent 传入的目录名包含空格或超出长度上限
- **THEN** 工具返回可读失败，不创建任何目录

#### Scenario: 同名项目已存在

- **WHEN** 传入的目录名与现有项目相同
- **THEN** 工具返回可读失败，既有项目的数据不被改动

### Requirement: 项目元信息可经 Agent 工具修改

系统 SHALL 提供修改项目标题、梗概、画风与画幅的 Agent 工具入口。写入 MUST 只影响本次传入的字段，未传入的字段 MUST 保持原值。写前 MUST 取得用户确认，写失败时 MUST 返回失败且 MUST NOT 报告成功。

画幅取值 MUST 落在项目支持的画幅集合内；非法取值 MUST 被拒绝而不是回落成默认值。

#### Scenario: 只改画风

- **WHEN** agent 只提交新的画风
- **THEN** 画风被更新，梗概、标题与画幅保持原值

#### Scenario: 画幅非法

- **WHEN** agent 提交一个不受支持的画幅
- **THEN** 工具返回可读失败，项目画幅保持原值
