# Spec Delta

## MODIFIED Requirements

### Requirement: 面板可选且兼容旧三型

转场面板 MUST 在效果模式下以两段展示预设：常用段默认显示不少于 4 项，其余预设 MUST 收纳在单一「全部预设」折叠区并可完整展开。内置目录总数 MUST 不少于 12 项。用户仍可选用原有叠化/擦除/推移语义；保存到 `transitionOut.effect` 后刷新与重开项目 MUST 保留。

#### Scenario: 保存黑场短叠

- **WHEN** 用户选择「黑场淡出」类预设并将时长设为 0.4s
- **THEN** `transitionOut.effect` 持久化且时间线/预览摘要显示该预设中文名

#### Scenario: 默认只占一行常用段

- **WHEN** 用户切换到效果模式且未展开「全部预设」
- **THEN** 面板只显示常用段的预设按钮，效果区高度不超过一行预设加分组标题

#### Scenario: 全部预设可达

- **WHEN** 用户展开「全部预设」
- **THEN** 目录内全部预设按原分组可见，选中任意一项后该折叠区保持当前展开状态
