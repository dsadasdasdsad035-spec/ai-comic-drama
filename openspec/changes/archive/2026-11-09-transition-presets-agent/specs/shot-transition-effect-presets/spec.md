# Spec Delta

## Purpose

为画布转场提供一组可持久化、可导出的 FFmpeg xfade 效果预设，并在转场面板可选。

## ADDED Requirements

### Requirement: 预设目录与映射

系统 MUST 维护内置效果预设目录；每项含稳定 `presetId`、展示名、FFmpeg `xfade` 的 `transition` 字符串及可选方向约束。成片导出 MUST 使用目录映射结果，MUST NOT 接受未登记的自由字符串作为效果转场名。

#### Scenario: 选择径向类预设

- **WHEN** 用户在效果转场中选择已登记的径向类预设并导出
- **THEN** 对应接缝使用目录中的 `transition` 名参与 xfade，时长仍受夹紧规则约束

#### Scenario: 未知预设回退

- **WHEN** 旧数据含有已移除的 `presetId`
- **THEN** 读入时回退为默认叠化，并在面板提示预设已失效

### Requirement: 面板可选且兼容旧三型

转场面板 MUST 在效果模式下展示预设（不少于 12 项常用项）。用户仍可选用原有叠化/擦除/推移语义；保存到 `transitionOut.effect` 后刷新与重开项目 MUST 保留。

#### Scenario: 保存黑场短叠

- **WHEN** 用户选择「黑场淡出」类预设并将时长设为 0.4s
- **THEN** `transitionOut.effect` 持久化且时间线/预览摘要显示该预设中文名
