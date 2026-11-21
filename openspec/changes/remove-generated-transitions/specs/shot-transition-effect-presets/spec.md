# Spec Delta

## MODIFIED Requirements

### Requirement: 面板可选且兼容旧三型

接缝设置 MUST 展示预设目录（不少于 12 项常用项），常用项默认可见、其余按分组折叠。用户 MUST 能选用叠化、擦除、推移三类语义与目录中的其它预设；MUST NOT 需要先在「效果/生成」之间切换模式。保存到 `transitionOut.effect` 后刷新与重开项目 MUST 保留。

#### Scenario: 保存黑场短叠

- **WHEN** 用户选择「黑场淡出」类预设并将时长设为 0.4s
- **THEN** `transitionOut.effect` 持久化且连线标签、时间线与预览摘要显示该预设中文名

#### Scenario: 常用预设直接可选

- **WHEN** 用户打开一条转场连线的接缝设置
- **THEN** 常用预设直接可见可选，无需展开折叠区，也无需先选择任何模式

#### Scenario: 无模式切换

- **WHEN** 用户查看接缝设置
- **THEN** 界面 MUST NOT 出现「效果 / 生成」模式切换控件
