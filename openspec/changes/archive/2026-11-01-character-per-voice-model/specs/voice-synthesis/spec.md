# Spec Delta

## MODIFIED Requirements

### Requirement: 按 Agent Plan TTS 协议提交合成

系统 SHALL 向 `{base}/tts/unidirectional` 提交合成请求，携带 `X-Api-Key`、`X-Api-Resource-Id: seed-tts-2.0` 和连接 ID；请求体 MUST 包含待合成文本、发音人与 `mp3` / `24000` 音频参数。未指定发音人时 MUST 使用一个可用默认音色。镜头台词合成时，每一行 MUST 使用说话角色绑定的配音模型键提交；角色未绑定模型时 MUST 回落到设置页默认配音模型。

#### Scenario: 单句合成

- **WHEN** 用户对一句台词生成配音，且当前模型属于火山 TTS 渠道
- **THEN** 系统按 Agent Plan TTS 协议提交文本、发音人与 mp3 音频参数

#### Scenario: 多说话人合成

- **WHEN** 一镜台词包含多行且每行指定了不同发音人
- **THEN** 每一行使用各自的发音人与各自说话角色绑定的配音模型提交合成，再按既有逻辑拼接为一条音轨

#### Scenario: 未指定音色

- **WHEN** 请求没有指定发音人
- **THEN** 系统使用火山 TTS 的默认可用音色，不提交空发音人

#### Scenario: 角色未绑定配音模型

- **WHEN** 说话角色没有保存配音模型键
- **THEN** 该行使用设置页默认配音模型合成，不静默改用画布上的其他手选模型

### Requirement: 音色列表跟随当前配音模型

系统 SHALL 根据指定音频模型键所属渠道返回音色列表。角色工作台编辑某角色时，音色下拉 MUST 跟随该角色当前绑定的配音模型重新获取列表；切换角色配音模型 MUST 重新拉取对应渠道音色。画布 Inspector 生成镜头配音时，MUST 按各说话人角色的绑定模型解析音色与渠道，并显示对应引擎名称。设置页音色库仍按用户所选模型维护目录，不作为角色绑定的主入口。

#### Scenario: 选择火山 TTS 模型

- **WHEN** 用户在角色卡把配音模型切换为火山 TTS
- **THEN** 该角色的音色列表更新为火山 TTS 的音色，引擎名称显示为火山 Seed TTS

#### Scenario: 切换回其他 TTS

- **WHEN** 用户在角色卡把配音模型切换回 ElevenLabs 或 macOS 音色
- **THEN** 该角色的音色列表重新加载对应渠道的音色，不继续显示火山 TTS 音色

#### Scenario: 没有可用音色

- **WHEN** 角色绑定的配音模型没有返回任何音色
- **THEN** 该角色的音色选择与样本/镜头配音入口禁用或提示没有可用音色

#### Scenario: 多角色不同模型

- **WHEN** 项目内角色 A 绑定 MiniMax、角色 B 绑定火山 TTS
- **THEN** 各自角色卡的音色列表只显示对应渠道条目，互不影响

## ADDED Requirements

### Requirement: 角色音色样本使用角色配音模型

生成或重生成角色音色样本时，系统 MUST 使用与该角色相同的配音模型键与 `voiceId` 提交合成；样本指纹与 stale 判定 MUST 在该模型键变化时标记需重生成。

#### Scenario: 生成样本

- **WHEN** 用户为已绑定 MiniMax 模型与音色的角色生成音色样本
- **THEN** 合成请求使用 MiniMax 模型键与该角色 voiceId，样本元数据记录相同 modelKey

#### Scenario: 更换角色配音模型

- **WHEN** 用户更改角色的配音模型但尚未重生成样本
- **THEN** 现有样本标记为 stale 并提示重生成

#### Scenario: 模型与音色渠道不一致

- **WHEN** 角色 voiceId 所属渠道与绑定的配音模型渠道不一致
- **THEN** 系统阻止生成并提示改选音色或更换配音模型，不静默回落默认音色
