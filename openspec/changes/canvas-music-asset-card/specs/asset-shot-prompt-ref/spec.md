# Spec Delta

## ADDED Requirements

### Requirement: 音乐卡可引用分镜文案

音乐素材卡 MUST 允许用户建立到分镜的引用关系，语义与音频卡一致。生成音乐时，系统 MUST 合并用户填写的 prompt 与引用分镜上用户选择的字段（`dialogue` 或 `video_prompt`），并将合并结果用于音乐请求的 sound_prompt。合并结果 MUST NOT 包含连线中的图片或视频媒体。

#### Scenario: 引用 dialogue 生成配乐

- **WHEN** 音乐卡引用分镜且选择 dialogue 字段，用户请求生成
- **THEN** sound_prompt 包含该镜 dialogue 与卡上 prompt（若有）

#### Scenario: 无引用仅 prompt

- **WHEN** 音乐卡未引用分镜且卡上或歌词足以生成
- **THEN** 行为与无引用时一致，仅使用卡上字段

#### Scenario: 连线语义与音频卡一致

- **WHEN** 用户从分镜连到音乐卡或使用与音频卡相同的分镜引用连线
- **THEN** 音乐卡 `sourceShotIds` 更新方式与音频卡相同