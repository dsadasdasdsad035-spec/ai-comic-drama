# Spec Delta

## MODIFIED Requirements

### Requirement: 按 Agent Plan TTS 协议提交合成

系统 SHALL 向 `{base}/tts/unidirectional` 提交合成请求，携带 `X-Api-Key`、`X-Api-Resource-Id: seed-tts-2.0` 和连接 ID；请求体 MUST 包含待合成文本、发音人与 `mp3` / `24000` 音频参数。未指定发音人时 MUST 使用一个可用默认音色。该协议 MUST 继续服务角色试音与设置页相关路径；镜头工作台 MUST NOT 调用该协议写入镜头 `voiceUrl`。

#### Scenario: 单句合成

- **WHEN** 用户为角色试音合成一句文本，且当前模型属于火山 TTS 渠道
- **THEN** 系统按 Agent Plan TTS 协议提交文本、发音人与 mp3 音频参数

#### Scenario: 多说话人合成

- **WHEN** 单次合成请求包含多行文本且每行指定了不同发音人
- **THEN** 每一行使用各自的发音人与各自角色绑定的配音模型提交合成，再按既有逻辑拼接为一条音轨

#### Scenario: 未指定音色

- **WHEN** 请求没有指定发音人
- **THEN** 系统使用火山 TTS 的默认可用音色，不提交空发音人

#### Scenario: 角色未绑定配音模型

- **WHEN** 说话角色没有保存配音模型键
- **THEN** 该行使用设置页默认配音模型合成，不静默改用画布上的其他手选模型

#### Scenario: 镜头台词不可从 Inspector 合成

- **WHEN** 用户在画布选中分镜并打开 Inspector
- **THEN** 不存在触发镜头台词 TTS 并写入 voiceUrl 的主操作

### Requirement: 音色列表跟随当前配音模型

系统 SHALL 根据指定音频模型键所属渠道返回音色列表。角色工作台编辑某角色时，音色下拉 MUST 跟随该角色当前绑定的配音模型重新获取列表；切换角色配音模型 MUST 重新拉取对应渠道音色。设置页音色库仍按用户所选模型维护目录，不作为角色绑定的主入口。

#### Scenario: 选择火山 TTS 模型

- **WHEN** 用户在角色卡把配音模型切换为火山 TTS
- **THEN** 该角色的音色列表更新为火山 TTS 的音色，引擎名称显示为火山 Seed TTS

#### Scenario: 切换回其他 TTS

- **WHEN** 用户在角色卡把配音模型切换回 ElevenLabs 或 macOS 音色
- **THEN** 该角色的音色列表重新加载对应渠道的音色，不继续显示火山 TTS 音色

#### Scenario: 没有可用音色

- **WHEN** 角色绑定的配音模型没有返回任何音色
- **THEN** 该角色的音色选择与样本入口禁用或提示没有可用音色

#### Scenario: 多角色不同模型

- **WHEN** 项目内角色 A 绑定 MiniMax、角色 B 绑定火山 TTS
- **THEN** 各自角色卡的音色列表只显示对应渠道条目，互不影响
