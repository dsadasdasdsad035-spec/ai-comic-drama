# Spec Delta

## Purpose

让用户在画布上单独维护配乐与歌曲素材，按分镜文案驱动风格描述，并用已接入的音乐生成 API 产出可连线出片镜的音频文件。

## ADDED Requirements

### Requirement: 可新建音乐素材卡

系统 MUST 允许在画布新建音乐素材卡。该卡 MUST NOT 分配镜号，MUST NOT 计入当前集镜数或总时长。

#### Scenario: 菜单新建音乐卡

- **WHEN** 用户在画布菜单选择新建音乐素材卡
- **THEN** 画布出现 `kind` 为音乐的素材卡节点

#### Scenario: 不占镜号

- **WHEN** 用户新建音乐素材卡
- **THEN** 该卡不获得镜号，不计入集镜数统计

### Requirement: 音乐卡生成提交风格歌词与时长

用户请求生成时，系统 MUST 调用音乐生成 API：将合并后的风格文本作为 `sound_prompt`，将卡上歌词字段作为可选 `lyrics`，将卡上时长字段钳在合法区间后提交。系统 MUST NOT 在同一次音乐请求中提交 TTS 音色或语音合成参数。

#### Scenario: 风格与歌词齐全

- **WHEN** 用户填写风格 prompt、歌词并请求生成
- **THEN** 请求包含合并后的 sound_prompt 与歌词，且不走语音合成接口

#### Scenario: 仅歌词

- **WHEN** 用户未填风格且无分镜引用，但填写歌词并请求生成
- **THEN** 系统允许仅凭歌词提交音乐生成

#### Scenario: 风格来自分镜合并

- **WHEN** 音乐卡引用分镜且用户请求生成
- **THEN** sound_prompt 包含卡上 prompt 与所选分镜字段的合并结果，歌词仍单独提交

### Requirement: 音乐卡 Inspector 可选择音乐模型

用户选中音乐素材卡时，系统 MUST 在 Inspector 提供音乐能力模型下拉。未手选时 MUST 使用设置页音乐默认；手选 MUST 写入本机会话级 `modelPick.music`，MUST NOT 改写配音用的 `modelPick.audio`。

#### Scenario: 未手选使用默认

- **WHEN** 用户未手选手选音乐模型且设置页已配置音乐默认且已接入
- **THEN** 生成使用该 modelKey

#### Scenario: 手选不影响音频卡

- **WHEN** 用户在音乐卡手选某音乐模型
- **THEN** 音频素材卡后续生成仍使用 `modelPick.audio` 或 audio 默认

### Requirement: 未接入的音乐模型不能提交

用户在音乐卡选择未接入模型时，系统 MUST NOT 提交生成，并说明该模型尚未接入。

#### Scenario: 未接入拦截

- **WHEN** 用户在音乐卡选择目录中未接入的音乐模型并请求生成
- **THEN** 系统不提交请求并提示未接入

### Requirement: 音乐卡可连出片镜作音频参考

已有地址的音乐素材卡 MUST 能连到出片镜并作为单条音频参考。该地址 MUST NOT 进入该镜的图片或视频参考。

#### Scenario: 音乐给出片镜

- **WHEN** 用户把已有地址的音乐卡连到出片镜并出片
- **THEN** 出片请求把该地址作为单条音频参考