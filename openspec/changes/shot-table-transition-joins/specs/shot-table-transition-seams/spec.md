# Spec Delta

## Purpose

在画布按播放序列展示并编辑每对相邻镜之间的接缝配置（顺序边 + 转场面板），与 `transitionOut` 共用单一持久化来源，使用户在拆镜阶段即可规划效果或生成转场提示词。接缝的编辑面随 `canvas-only-shots-workbench` 从表行迁到画布：不再有整张可编辑镜头表。

## ADDED Requirements

### Requirement: 相邻镜接缝全覆盖

画布 MUST 为本集播放序列中的每一对相邻镜头补一条接缝边（`relation=cut` 或 `relation=transition`）。接缝 MUST 绑定源镜头上的 `transitionOut.to` 等于下一镜的 `shotId`（或节点稳定键，与画布一致）。接缝 MUST NOT 作为独立 shot 写入数据模型。

#### Scenario: 三镜集显示两条接缝

- **WHEN** 本集按序有 S01、S02、S03
- **THEN** 画布出现 S01—S02 与 S02—S03 两条接缝边，分别对应 S01 与 S02 的 `transitionOut`

#### Scenario: 插入新镜后出现新接缝

- **WHEN** 用户在 S02 后插入 S07
- **THEN** 水合后自动出现 S02—S07 与 S07—S03（或下一镜）接缝边；缺省 `transitionOut` 按硬切解释

### Requirement: 硬切默认可折叠

硬切接缝（`relation=cut` 或无生成/效果配置）MUST 默认以边上的一行摘要展示（「硬切」chip），用户 MUST 可点开转场面板以编辑或升级为转场。

#### Scenario: 默认折叠

- **WHEN** 用户查看未配置转场的接缝
- **THEN** 边上只显示硬切摘要，不展开与生成转场相同的完整表单

#### Scenario: 展开编辑

- **WHEN** 用户点开硬切接缝并在转场面板选择「转场」
- **THEN** 系统写入 `relation=transition` 并展示效果/生成编辑区，边 chip 同步改为转场语义

### Requirement: 接缝与 transitionOut 双向一致

接缝编辑（边 chip 与转场面板）MUST 读写源镜 `transitionOut`；`shots-v1` / `joins-v1` 写回与手动编辑 MUST 反映在同一处。接缝字段 MUST 与转场面板「画面与过渡」「声音描述」及模式/效果控件同义，不得维护第二份冲突副本。

#### Scenario: 面板改 prompt

- **WHEN** 用户在转场面板修改 `generated.prompt` 并保存项目
- **THEN** 源镜 `transition_out.generated.prompt` 更新，重新水合后边与面板显示相同值

#### Scenario: Agent 写回后同步

- **WHEN** `transition-planner` 经 `submit_joins` 写回 `soundPrompt`
- **THEN** 对应接缝边与转场面板立即显示新的声音描述

### Requirement: 非相邻边不参与接缝展示

画布上不相邻于播放序列的连线 MUST NOT 获得接缝 chip；若存在孤立 `transitionOut` 配置，系统 MAY 在转场面板或诊断里提示，但 MUST NOT 当作默认接缝编辑入口。

#### Scenario: 跳切连线

- **WHEN** S01 与 S05 在画布相连但播放序列为 S01-S02-S03…
- **THEN** S01—S05 不显示接缝 chip；S01—S02 仍为默认接缝编辑对象
