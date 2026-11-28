# Spec Delta

## Purpose

在画布上维护可导出的字幕 cue 资产，与镜头 dialogue 解耦，供用户单独编辑与导出 SRT 片段。

## ADDED Requirements

### Requirement: 可新建字幕素材卡

系统 MUST 允许在画布新建字幕素材卡。该卡 MUST NOT 分配镜号，MUST NOT 计入当前集镜数或总时长。

#### Scenario: 新建字幕卡

- **WHEN** 用户新建字幕素材卡
- **THEN** 画布出现字幕卡且当前集镜数不变

### Requirement: 字幕卡保存 cue 列表

字幕卡 MUST 在项目素材中保存 cue 列表；每条 cue MUST 至少包含可读文本与起止时间。重新打开项目后 MUST 保留。

#### Scenario: 重开后 cue 仍在

- **WHEN** 用户编辑字幕卡 cue 并保存项目后重新打开
- **THEN** 该卡仍显示相同 cue 列表

### Requirement: 不写回镜头 dialogue

字幕卡的 cue 或生成结果 MUST NOT 自动写入任何镜头的 `dialogue` 或其它镜头字段。

#### Scenario: 生成 cue 不改变镜头

- **WHEN** 用户从字幕卡生成或刷新 cue
- **THEN** 被引用分镜的 `dialogue` 保持不变

### Requirement: 可导出 SRT 片段

用户 MUST 能从字幕卡导出该卡 cue 列表形成的 SRT 文件。无有效 cue 时 MUST 提示而非导出空文件。

#### Scenario: 有 cue 时导出

- **WHEN** 字幕卡至少有一条带文本的 cue，用户请求导出 SRT
- **THEN** 浏览器下载 UTF-8（含 BOM）的 `.srt` 且内容对应该卡 cue

#### Scenario: 无 cue 时拒绝

- **WHEN** 字幕卡没有可导出的文本 cue
- **THEN** 系统不下载文件并给出可读提示

### Requirement: 可选文本模型生成或改写

字幕卡 MUST 允许用户选择文本族模型（手选或设置页文本默认）。用模型生成时 MUST 将选定分镜字段与可选说明作为输入；失败时 MUST 保留原 cue 并提示原因。

#### Scenario: 选择模型后生成

- **WHEN** 用户选择已配置文本模型并请求从分镜文案生成 cue
- **THEN** 系统调用文本能力并更新该卡 cue 列表

### Requirement: 字幕卡不提供 TTS

字幕卡 MUST NOT 提供音频生成或音频模型选择。用户需要配音 MUST 使用音频素材卡。

#### Scenario: Inspector 无音频生成

- **WHEN** 用户选中字幕素材卡
- **THEN** 界面没有「生成音频」或音频模型下拉