# shot-transition-agent Specification

## Purpose
在选中两镜转场时，Agent 根据镜头上下文推荐效果或生成方案，经用户确认写入配置。

## Requirements

### Requirement: 建议须含可执行摘要

用户触发转场智能建议时，系统 MUST 基于源镜与目标镜的公开字段（景别、运镜、提示词摘要、是否已有成片、当前转场模式）生成建议。建议 MUST 包含：`mode`（`effect` 或 `generated`）、效果模式下的 `presetId` 或合法效果参数、生成模式下的 `prompt`/`soundPrompt` 文本及可选 `recipeId`（食谱卡片引用，仅作文案意图）。

#### Scenario: 跨景别推荐生成

- **WHEN** 两镜景别跨度大且均有边界帧条件
- **THEN** 建议倾向 `generated`，并在 prompt 中描述衔接意图；可附 `recipeId` 仅作参考标签

#### Scenario: 同场景硬切

- **WHEN** 两镜同场、运镜均为固定且时长充足
- **THEN** 建议可为短效果叠化或保持硬切，并说明理由

### Requirement: 确认后才写入

Agent 或建议接口 MUST NOT 直接调用视频生成 API。用户点「应用建议」后，系统 MUST 将建议合并进 `transitionOut`；若存在 `videoPromptOverride`，应用生成类建议时 MUST 仅写入非 override 字段或先征得覆盖（默认不覆盖 override）。

#### Scenario: 应用效果建议

- **WHEN** 用户确认一条效果类建议
- **THEN** `transitionOut.mode` 为 `effect` 且 `effect` 含建议的预设或类型/时长

#### Scenario: 保留手改正文

- **WHEN** 已有非空 `videoPromptOverride` 且用户应用新生成建议
- **THEN** override 不被静默替换；建议中的正文进入 `generated.prompt` 或单独提示用户改 override
