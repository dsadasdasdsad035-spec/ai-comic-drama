# Spec Delta

## ADDED Requirements

### Requirement: 角色工作台声音 Tab 命名

角色工作台角色卡 Tab 中，原「音色」入口 SHOULD 标记为「声音」或等价文案，以涵盖配音引擎与试音样本；实现 MUST 保持同一 Tab 面板承载 `character-appearance` 声音页行为。

#### Scenario: Tab 标签

- **WHEN** 用户在角色工作台查看角色卡 Tab 列表
- **THEN** 第三个 Tab 显示「声音」（或产品批准的等价标签），而非仅「音色」
