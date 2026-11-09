# Spec Delta

## ADDED Requirements

### Requirement: 创意宿主技能由头部下拉选择

系统 SHALL 在创意头部提供宿主技能下拉，选项 MUST 包含环节为 `creative` 的技能；用户选择后 MUST 作为当前会话的宿主技能，直至用户再次更改。

#### Scenario: 手选宿主技能

- **WHEN** 用户从下拉选择某一技能
- **THEN** 下一轮对话绑定该技能的写工具集，且检查器显示对应宿主 id

#### Scenario: 技能不可用

- **WHEN** 所选技能解析失败
- **THEN** 头部与发送入口标明错误，不允许发送

### Requirement: 创意模式 Tab 不强制覆盖宿主技能

策划 / 反推 / 复刻模式 Tab SHALL 只影响空态文案、起步动作与会话 `mode` 元数据。Tab 切换 MUST NOT 在用户已手选宿主技能后自动改写下拉值。Tab MAY 在首次进入某模式时推荐默认技能，但 MUST 提供「跟随模式推荐」与「保持当前技能」的可区分行为（默认可为：仅在新会话或宿主仍为模式默认时同步）。

#### Scenario: 手选后切 Tab

- **WHEN** 用户手选 `video-reverse` 后切换到「策划」Tab
- **THEN** 宿主技能下拉仍为 `video-reverse`

#### Scenario: 新会话随模式推荐

- **WHEN** 用户新建会话并处于「反推」模式且未手选技能
- **THEN** 宿主技能初始化为该模式对应的默认技能 id

### Requirement: 切换技能保留会话消息

更换宿主技能或只读技能时，系统 MUST 保留当前会话的聊天消息与线程存储，MUST NOT 静默清空对话。

#### Scenario: 换宿主不清空

- **WHEN** 用户在有多轮消息的会话中更换宿主技能
- **THEN** 消息列表不变，可继续发送

#### Scenario: 换只读技能

- **WHEN** 用户挂载或卸载只读技能
- **THEN** 消息列表不变，工具集在下一轮更新

### Requirement: 切换技能后 system 不含模式与会话元数据

每轮发送的 system SHALL 仅含 Pi 引导（含 `read_skill` 指令）与当前宿主技能标识（id、版本、来源）。系统 MUST NOT 在 system 中注入创意模式说明、会话 id、只读技能枚举等 extras。只读技能通过工具绑定体现，不在 system 中罗列。

#### Scenario: 反推模式下发送

- **WHEN** 用户在「反推」模式下发送消息
- **THEN** system 中不出现 `创意模式：reverse` 或会话 uuid 行

#### Scenario: 挂载只读技能

- **WHEN** 用户挂载一个只读技能
- **THEN** system 不增加只读技能名单段落，但工具列表包含只读工具
