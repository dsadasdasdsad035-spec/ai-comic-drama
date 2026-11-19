# Spec Delta: shot-video-prompt

## MODIFIED Requirements

### Requirement: 手改提示词保存到本镜并逐字使用

系统 SHALL 允许把最终提示词正文改为手写版本并按镜头保存；保存后生成 MUST 逐字发送该版本，刷新页面和重新打开项目后 MUST 仍保留。用户 MUST 能清除手改并恢复自动拼装（语义层或脚本拼装，见「自动正文优先级」）。**创意 harness 通过 `set_shot_video_override` 保存的手改正文 MUST 与用户在面板保存的版本在存储形状与生成路径上等价**（同一 `video_prompt_override` 字段与 `effectiveVideoPrompt` 规则）。

#### Scenario: 手改后生成

- **WHEN** 用户编辑正文并保存，然后点生成
- **THEN** 请求的 `prompt` 等于用户保存的全文，不再追加自动拼装的任何段落

#### Scenario: Agent 手改后生成

- **WHEN** agent 用 `set_shot_video_override` 保存正文后调用 `generate_clip`
- **THEN** 请求的 `prompt` 等于 agent 保存的全文

#### Scenario: 重新打开项目

- **WHEN** 用户保存手改版本后刷新页面或重新打开项目
- **THEN** 该镜头仍显示手改版本和「已手改」状态

#### Scenario: 恢复自动拼装

- **WHEN** 用户点「恢复自动拼装」或 agent 调用清除 override
- **THEN** 手改版本被清除，正文回到当前 `video_prompt`