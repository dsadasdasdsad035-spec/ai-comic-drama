# Spec Delta

## ADDED Requirements

### Requirement: transition-planner 技能与 joins 契约

系统 MUST 提供独立 Agent 技能 `transition-planner`（环节可配置模型），工具包含读取本集镜头与提交接缝草稿。提交契约 `joins-v1` MUST 接受数组项：`after_no`（源镜号）、`to_no`（目标镜号）、`relation`、`mode`、`taxonomy`、可选 `recipe_ids`、`effect` 或 `generated`（含 `prompt`、`sound_prompt`、`target_seconds`）。Agent MUST NOT 调用视频生成 API。

#### Scenario: 批量提交本集接缝

- **WHEN** 用户在线头表聊天触发「规划本集镜间转场」且 Agent 返回合法 `joins-v1`
- **THEN** 系统将各条合并进对应源镜 `transitionOut`，镜头表接缝行可预览更新；未保存前按工作台草稿语义提示用户

#### Scenario: 非法镜号拒绝

- **WHEN** `joins-v1` 中 `after_no` 在本集不存在
- **THEN** 契约校验失败并返回可执行错误，不部分写入

### Requirement: 接缝分类 taxonomy

每条生成类或建议类接缝 MUST 携带主分类 `taxonomy` 之一：`scene`、`character`、`space`、`vfx`、`camera`、`ai_video`。Agent 输出 MUST 避免将复杂转场仅描述为默认叠化，除非 `taxonomy=scene` 且 rationale 说明仅时间流逝。

#### Scenario: 人物连续跳跃

- **WHEN** 源镜描述主体起跳、下镜描述落地且场别可不同
- **THEN** 建议或写入 `taxonomy=character`，`mode` 倾向 `generated`，`prompt` 描述动作连续

#### Scenario: 同场对话固定机位

- **WHEN** 两镜同场、运镜固定、无动作跨度
- **THEN** 允许 `mode=effect` 与短叠化，taxonomy 可为 `scene`

### Requirement: 食谱索引引用

Agent MUST 可引用扩展后的转场食谱（对齐 video-shotcraft 卡片 id/摘要）。引用 MUST 仅存 `recipe_ids` 与由食谱衍生的自然语言 `prompt`/`sound_prompt`；MUST NOT 要求运行 Remotion 或 bundled shotcraft 源码。

#### Scenario: 引用 whip 语义

- **WHEN** Agent 选择甩镜类食谱 id
- **THEN** 写入的 `prompt` 含运动模糊与换景意图，`recipe_ids` 含对应 id

## MODIFIED Requirements

### Requirement: 建议须含可执行摘要

用户触发转场智能建议或 transition-planner 时，系统 MUST 基于源镜与目标镜的公开字段（景别、运镜、提示词摘要、是否已有成片、当前转场模式）生成建议。建议 MUST 包含：`mode`（`effect`、`generated` 或显式硬切）、效果模式下的 `presetId` 或合法效果参数、生成模式下的 `prompt`/`soundPrompt` 文本、主 `taxonomy` 及可选 `recipeIds`（食谱卡片引用，仅作文案意图）。

#### Scenario: 跨景别推荐生成

- **WHEN** 两镜景别跨度大且均有边界帧条件
- **THEN** 建议倾向 `generated`，`taxonomy` 倾向 `space` 或 `scene`，并在 prompt 中描述衔接意图；可附 `recipeId` 仅作参考标签

#### Scenario: 同场景硬切

- **WHEN** 两镜同场、运镜均为固定且时长充足
- **THEN** 建议可为短效果叠化或保持硬切，并说明理由；硬切时 `relation=cut`

### Requirement: 确认后才写入

Agent 或建议接口 MUST NOT 直接调用视频生成 API。用户确认保存草稿或点「应用建议」后，系统 MUST 将建议合并进 `transitionOut`；若存在 `videoPromptOverride`，应用生成类建议时 MUST 仅写入非 override 字段或先征得覆盖（默认不覆盖 override）。transition-planner 批量结果在未保存前 MUST 视为草稿，与镜头表 Agent 草稿语义一致。

#### Scenario: 应用效果建议

- **WHEN** 用户确认一条效果类建议
- **THEN** `transitionOut.mode` 为 `effect` 且 `effect` 含建议的预设或类型/时长

#### Scenario: 保留手改正文

- **WHEN** 已有非空 `videoPromptOverride` 且用户应用新生成建议
- **THEN** override 不被静默替换；建议中的正文进入 `generated.prompt` 或单独提示用户改 override
