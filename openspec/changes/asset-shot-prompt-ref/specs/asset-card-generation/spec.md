# Spec Delta

## ADDED Requirements

### Requirement: 音频卡可引用分镜文案

音频素材卡 MUST 允许用户建立到分镜的引用关系。生成音频时，系统 MUST 合并用户填写的 `prompt` 与引用分镜上用户选择的字段（`dialogue` 或 `video_prompt`）。合并结果 MUST NOT 包含连线中的图片或视频媒体。

#### Scenario: 引用 dialogue 生成

- **WHEN** 音频卡引用分镜且选择 dialogue 字段，用户请求生成
- **THEN** 合成请求文本包含该镜 dialogue 与卡上 prompt（若有）

#### Scenario: 无引用仅 prompt

- **WHEN** 音频卡未引用分镜且有 prompt
- **THEN** 行为与变更前一致，仅提交 prompt

### Requirement: 字幕卡可引用分镜

字幕素材卡 MUST 允许用户建立到分镜的引用，用于填充或生成 cue 的文案来源。系统 MUST NOT 因引用而修改分镜字段。

#### Scenario: 连线后填充

- **WHEN** 字幕卡引用分镜且用户请求从分镜填充
- **THEN** cue 文案来自所选字段，分镜 dialogue 不变