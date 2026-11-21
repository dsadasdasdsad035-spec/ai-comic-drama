# shot-narration-tts Specification

## Purpose

让画布分镜可对旁白行合成 TTS 并在 Inspector 试听与下载，使用项目级旁白声线；旁白音频不参与连播与导出成片音轨。

## ADDED Requirements

### Requirement: 项目配置旁白声线

系统 SHALL 允许为当前项目配置旁白专用的配音模型键与音色 ID。旁白声线 MUST 与角色卡声线独立存储。未配置完整旁白声线时，画布「生成旁白」MUST 禁用或失败并提示用户先配置。

#### Scenario: 已配置旁白声线

- **WHEN** 项目已保存旁白模型键与音色 ID
- **THEN** 画布选中含旁白行的镜头时可启用「生成旁白」

#### Scenario: 缺少旁白音色

- **WHEN** 项目未配置旁白音色
- **THEN** 用户点击「生成旁白」时收到可读错误，不产生扣费请求

### Requirement: 只合成旁白说话人行

系统 SHALL 从镜头 `dialogue` 中识别旁白类说话人（含旁白、画外音、内心独白及大小写等价的 os/vo/narrator）并仅对这些行提交 TTS。角色对白行 MUST NOT 进入本次合成。音效与无说话人纯描述 MUST NOT 进入合成。

#### Scenario: 仅旁白

- **WHEN** 镜头台词为「旁白：雨夜，这座城市从不睡眠。」
- **THEN** 合成文本仅包含该旁白句

#### Scenario: 旁白与对白混排

- **WHEN** 镜头台词同时含「陈默：别出声。」与「旁白：他不知道门外是谁。」
- **THEN** 仅旁白句进入 TTS，角色对白不被念出

#### Scenario: 无旁白行

- **WHEN** 镜头台词只有角色对白或无台词
- **THEN** 「生成旁白」不可用或返回「本镜没有旁白」

### Requirement: 写回旁白配音元数据

成功合成后，系统 MUST 将 mp3 站内路径写入该镜 `voiceUrl`，写入真实时长与引擎信息到 `voiceMeta`，并在 `voiceMeta` 中标记范围为旁白专用（与历史整镜台词配音区分）。失败时 MUST NOT 覆盖既有 `voiceUrl`。

#### Scenario: 成功写回

- **WHEN** TTS 返回可播放 mp3
- **THEN** 镜头保存 `voiceUrl`、`voiceSeconds` 与旁白范围的 `voiceMeta`

#### Scenario: 失败保留旧文件

- **WHEN** TTS 请求失败
- **THEN** 原有 `voiceUrl` 不变，界面显示错误原因

### Requirement: 旁白指纹仅跟踪旁白文本

系统 SHALL 在旁白行或其旁白表演变更时标记配音 stale；角色对白或画面字段变更 MUST NOT 单独触发旁白 stale。

#### Scenario: 改旁白文本

- **WHEN** 用户修改旁白一句原文
- **THEN** 界面提示需重新生成旁白

#### Scenario: 改角色对白

- **WHEN** 用户只修改角色对白、旁白未变
- **THEN** 旁白配音不标记 stale

### Requirement: Inspector 试听与下载

画布分镜 Inspector MUST 在叙事或音画 Tab 提供「生成旁白」主操作。存在 `voiceUrl` 时 MUST 提供试听控件与下载入口。页面 MUST 说明旁白 mp3 不进连播与导出成片。

#### Scenario: 试听

- **WHEN** 镜头已有旁白 `voiceUrl`
- **THEN** 用户在 Inspector 可播放该 mp3

#### Scenario: 下载

- **WHEN** 用户请求下载旁白配音
- **THEN** 系统提供该 mp3 的下载或等效外链

### Requirement: 连播与导出不使用旁白 voiceUrl

连播预览、时间线播放与导出 assemble MUST NOT 将镜头的 `voiceUrl` 作为音轨来源，即使 `voiceMeta` 标明旁白。每镜成片有声仍仅来自 `videoUrl` 或静音规则。

#### Scenario: 连播无声旁白轨

- **WHEN** 镜头仅有旁白 `voiceUrl` 而无带音轨视频
- **THEN** 连播该段仍按无声或视频规则播放，不播放旁白 mp3

#### Scenario: 导出不提交旁白

- **WHEN** 用户导出含旁白配音镜的成片
- **THEN** 导出请求不包含旁白 `voiceUrl` 音轨