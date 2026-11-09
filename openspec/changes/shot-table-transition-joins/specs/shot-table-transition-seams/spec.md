# Spec Delta

## Purpose

在镜头表按播放序列展示并编辑每对相邻镜之间的接缝配置，与画布 `transitionOut` 共用单一持久化来源，使用户在拆镜阶段即可规划效果或生成转场提示词。

## ADDED Requirements

### Requirement: 相邻镜接缝行全覆盖

本集镜头表 MUST 在播放序列中每一对相邻镜头行之间展示一行接缝 UI。接缝 MUST 绑定源镜头上的 `transitionOut.to` 等于下一镜的 `shotId`（或节点稳定键，与画布一致）。接缝 MUST NOT 作为独立 shot 行写入镜头表数据模型。

#### Scenario: 三镜集显示两条接缝

- **WHEN** 本集按序有 S01、S02、S03
- **THEN** 表中出现 S01—S02 与 S02—S03 两条接缝行，分别对应 S01 与 S02 的 `transitionOut`

#### Scenario: 插入新镜后出现新接缝

- **WHEN** 用户在 S02 后插入 S07
- **THEN** 自动出现 S02—S07 与 S07—S03（或下一镜）接缝；缺省 `transitionOut` 按硬切解释

### Requirement: 硬切默认可折叠

硬切接缝（`relation=cut` 或无生成/效果配置）MUST 默认以单行摘要展示（例如「硬切」），用户 MUST 可展开以编辑或升级为转场。

#### Scenario: 默认折叠

- **WHEN** 用户打开未配置转场的接缝行
- **THEN** 仅显示硬切摘要，不占用与生成转场相同的完整表单高度

#### Scenario: 展开编辑

- **WHEN** 用户展开硬切接缝并选择「转场」
- **THEN** 系统写入 `relation=transition` 并展示效果/生成编辑区，与画布落「转场」语义一致

### Requirement: 接缝与 transitionOut 双向一致

接缝行上的编辑 MUST 读写源镜 `transitionOut`；在画布转场面板或连线上的修改 MUST 在重开镜头表后反映在同一条接缝行。接缝字段 MUST 与转场面板「画面与过渡」「声音描述」及模式/效果控件同义，不得维护第二份冲突副本。

#### Scenario: 表中改 prompt

- **WHEN** 用户在接缝行修改 `generated.prompt` 并保存项目
- **THEN** 源镜 `transition_out.generated.prompt` 更新，画布转场面板显示相同值

#### Scenario: 画布改 sound

- **WHEN** 用户在转场面板修改声音描述并保存
- **THEN** 镜头表对应接缝行显示相同 `soundPrompt`

### Requirement: 非相邻边不参与接缝列表

画布上不相邻于播放序列的连线 MUST NOT 在镜头表接缝列表中占一行；若存在孤立 `transitionOut` 配置，系统 MAY 在镜头表脚注或维护工具中提示，但 MUST NOT 当作默认接缝编辑入口。

#### Scenario: 跳切连线

- **WHEN** S01 与 S05 在画布相连但播放序列为 S01-S02-S03…
- **THEN** 接缝列表不含 S01—S05；S01—S02 仍为默认接缝编辑对象
