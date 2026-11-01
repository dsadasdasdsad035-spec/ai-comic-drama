# Spec Delta

## MODIFIED Requirements

### Requirement: 剧本生成与保存必须绑定项目

系统 SHALL 要求剧本生成和保存都绑定当前项目；没有项目时 MUST 禁用或返回明确提示，保存 MUST NOT 静默返回。剧本「生成分集」包括 Agent 聊天内置动作与等价的宿主拆集流程。项目的画风与画幅 MUST 通过项目制作参数维护；剧本保存 MAY 继续携带 `style` 字段以兼容读写，但全站消费画风 MUST 以项目制作参数为准，MUST NOT 仅存在于剧本页本地 state 而不同步项目。

#### Scenario: 没有项目时生成

- **WHEN** 用户在没有选中项目时从 Agent 运行「生成分集」或触发等价的拆集流程
- **THEN** 系统提示先选择项目，不发起生成请求

#### Scenario: 没有项目时保存

- **WHEN** 用户在没有选中项目时点“保存”
- **THEN** 系统给出明确提示，不静默丢弃分集

#### Scenario: 保存到当前项目

- **WHEN** 用户选中项目并保存分集
- **THEN** source、logline、episodes 和 style 写入该项目，其他项目不受影响

#### Scenario: 未保存分集不跨项目

- **WHEN** 用户在 A 生成了未保存分集后切换到 B
- **THEN** B 的剧本页不显示这些未保存分集

#### Scenario: 画风以项目制作参数为准

- **WHEN** 用户在项目制作参数将画风设为「赛博朋克写实」并在剧本页保存分集
- **THEN** Agent 与素材相关能力读取的画风为「赛博朋克写实」，与项目 JSON 中 `style` 一致
