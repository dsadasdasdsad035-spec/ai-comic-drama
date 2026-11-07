# Spec Delta

## Purpose

定义连播与导出如何为每镜选择音轨：成片优先，拒绝镜头 TTS 混音（R2）。

## ADDED Requirements

### Requirement: 连播不播放镜头 TTS

连播预览构建播放序列时，系统 MUST NOT 将镜头的 `voiceUrl` 作为可播放音轨来源。每镜音频 MUST 仅来自其 `videoUrl` 内嵌音轨（含 native 出片）；无视频或视频无音轨时该镜预览为无声。

#### Scenario: 仅有 TTS 无视频

- **WHEN** 镜头存有 voiceUrl 但没有 videoUrl
- **THEN** 连播该段无声，不播放 voiceUrl

#### Scenario: 有视频 native

- **WHEN** 镜头有 videoUrl 且为 native 或自带 AAC
- **THEN** 连播播放该视频音轨

### Requirement: 导出不混镜头 TTS

导出成片时，系统 MUST NOT 将 `voiceUrl` 提交为 assemble 的独立音轨。导出音频 MUST 取自各镜 `videoUrl`（或效果转场片段自身音轨）；无视频镜按静音或仅画面时长处理，与现有导出规则一致。

#### Scenario: 导出 payload 无 TTS

- **WHEN** 用户导出含多镜的成片且部分镜仅有 voiceUrl
- **THEN** 请求中不包含 voice 字段指向 voiceUrl，成片不混入该 TTS

#### Scenario: 有视频镜导出有声

- **WHEN** 镜头已有带音轨的 videoUrl
- **THEN** 导出结果包含该镜视频音轨

### Requirement: 字幕仍可由台词派生

移除 TTS 后，系统 SHALL 仍可根据台词生成字幕 cue；无 TTS 时长时 MAY 按镜头时长或视频时长分配 cue，行为与变更前无 TTS 时一致。

#### Scenario: 无配音仍有字幕

- **WHEN** 镜头有台词无 voiceUrl 但有 video
- **THEN** 连播可显示字幕且不与 TTS 对齐要求绑定
