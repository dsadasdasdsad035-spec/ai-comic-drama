# Spec Delta: shot-inspector-layout

## ADDED Requirements

### Requirement: 成片区成片帧素材操作

对已有成片预览的分镜（生图镜与出片镜均可），Inspector 成片区块 MUST 提供「抽首帧 → 素材卡」「抽尾帧 → 素材卡」；出片镜在同集存在上一镜时 MUST  additionally 提供「引用上一镜尾帧」。操作进行中 MUST 显示忙碌态；失败 MUST 在成片区块内显示错误；抽帧近黑 MUST 显示非阻断提示。这些控件 MUST NOT 挤占出片 Tab 底栏主生成按钮的固定位置。

#### Scenario: 出片镜看见三个操作

- **WHEN** 用户选中有成片的出片镜且存在上一镜
- **THEN** 成片预览下可见抽首帧、抽尾帧、引用上一镜尾帧

#### Scenario: 首镜无引用上一镜

- **WHEN** 用户选中集内第一镜
- **THEN** 不显示或禁用「引用上一镜尾帧」并说明原因

#### Scenario: 无成片无抽帧

- **WHEN** 用户选中无成片的镜
- **THEN** 抽帧按钮禁用或隐藏，不发起抽帧请求