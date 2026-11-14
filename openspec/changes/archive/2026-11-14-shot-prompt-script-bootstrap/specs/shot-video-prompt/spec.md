# Spec Delta

## ADDED Requirements

### Requirement: 自动正文优先级

在无手改层时，出片自动正文 MUST 按下列顺序择一：`video_prompt` 非空 → 使用该字段；否则 `prompt` 非空 → 使用该字段；否则使用脚本拼装结果。`video_prompt_rendered` 及 `video_prompt_render_meta` MUST NOT 参与该优先级链。

#### Scenario: 忽略陈旧九段层

- **WHEN** 镜头存有 `video_prompt_rendered` 且 `video_prompt` 非空
- **THEN** 出片正文为 `video_prompt`，面板不显示「模板渲染过期」类警告

#### Scenario: 双空走脚本

- **WHEN** 镜头无手改、`video_prompt` 与 `prompt` 皆空
- **THEN** 出片正文为脚本拼装，来源标识为脚本拼装

#### Scenario: 手改优先

- **WHEN** 镜头存在有效 `video_prompt_override`
- **THEN** 出片正文为手改全文，脚本拼装与语义层均不覆盖

### Requirement: 恢复自动拼装含脚本路径

用户点「恢复自动拼装」或等价操作时，系统 MUST 清除手改层并按自动正文优先级重新计算正文；若双空提示词则 MUST 回落到脚本拼装而非空字符串。

#### Scenario: 清除手改后双空

- **WHEN** 用户清除手改且 `video_prompt` 与 `prompt` 皆空
- **THEN** 面板显示脚本拼装正文

## MODIFIED Requirements

### Requirement: 手改提示词保存到本镜并逐字使用

系统 SHALL 允许把最终提示词正文改为手写版本并按镜头保存；保存后生成 MUST 逐字发送该版本，刷新页面和重新打开项目后 MUST 仍保留。用户 MUST 能清除手改并恢复自动拼装（语义层或脚本拼装，见「自动正文优先级」）。

#### Scenario: 手改后生成

- **WHEN** 用户编辑正文并保存，然后点生成
- **THEN** 请求的 `prompt` 等于用户保存的全文，不再追加自动拼装的任何段落

#### Scenario: 重新打开项目

- **WHEN** 用户保存手改版本后刷新页面或重新打开项目
- **THEN** 该镜头仍显示手改版本和「已手改」状态

#### Scenario: 恢复自动拼装

- **WHEN** 用户点「恢复自动拼装」
- **THEN** 手改版本被清除，正文回到当前输入的自动拼装结果

#### Scenario: 旧镜头

- **WHEN** 镜头没有手改记录
- **THEN** 出片使用自动拼装结果，行为与没有该能力时一致
