# voice-synthesis Specification

## Purpose

让画布台词可以通过火山 Agent Plan 的 Seed TTS 2.0 合成语音，并按当前配音模型提供对应音色。

## Requirements

### Requirement: 火山 TTS 渠道可独立配置

系统 SHALL 支持新增一个火山语音渠道，使用语音服务 Base URL 与 Agent Plan 专属 Key；该渠道 MUST 只承接音频能力，MUST NOT 出现在文本、图片或视频渠道列表中。

#### Scenario: 音频渠道分组

- **WHEN** 用户查看音频渠道分组
- **THEN** 可以看到火山 Seed TTS 渠道及其音频模型预设

#### Scenario: 不参与其他能力

- **WHEN** 用户为文本、图片或视频选择渠道
- **THEN** 火山语音渠道不出现在这些列表中

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

### Requirement: 解析行式 JSON 并落盘音频

系统 SHALL 按行解析 TTS 响应；`code` 为 0 的行 MUST 收集其 base64 音频，`code` 为 20000000 的行 MUST 视为结束；收集到的音频 MUST 合并写入本地 mp3 并返回站内路径、真实时长与引擎标识。

#### Scenario: 多块音频合并

- **WHEN** 响应包含多个 `code: 0` 的音频块和一个结束标记
- **THEN** 系统按顺序拼接音频块，写出一个可播放的 mp3，并返回其站内路径

#### Scenario: 没有音频数据

- **WHEN** 响应结束但没有产生任何音频块
- **THEN** 系统返回合成失败，不写入空文件

#### Scenario: 非 JSON 行

- **WHEN** 响应中出现无法解析的非空行
- **THEN** 系统返回可读的协议错误，不静默丢弃

### Requirement: TTS 错误提示可操作

系统 SHALL 把鉴权失败、扣减未开启和其他业务错误映射为可读消息；`AgentPlanDeductNotEnabled` MUST 明确提示用户去控制台开启 Agent Plan 扣减。

#### Scenario: 扣减未开启

- **WHEN** TTS 服务返回 `AgentPlanDeductNotEnabled`
- **THEN** 画布显示“需在 Agent Plan 控制台开启扣减”的提示，并保留服务端原始错误信息

#### Scenario: Key 无效

- **WHEN** TTS 服务返回 401 或 403
- **THEN** 画布显示鉴权失败与可读原因

#### Scenario: 其他业务错误

- **WHEN** TTS 服务返回其他非零业务码
- **THEN** 画布显示该业务码与服务端消息

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

### Requirement: 音频渠道测试不触发合成

系统 SHALL 为火山 TTS 渠道提供不产生音频的连通性测试；测试 MUST 区分鉴权成功、扣减未开启和 Key 无效，且 MUST NOT 写入音频文件。

#### Scenario: 鉴权通过

- **WHEN** 测试请求得到“缺少 req_params”类响应
- **THEN** 测试结果显示鉴权通过，不生成音频

#### Scenario: 扣减未开启

- **WHEN** 测试请求得到 `AgentPlanDeductNotEnabled`
- **THEN** 测试结果显示“Key 可用，但需开启 Agent Plan 扣减”

#### Scenario: Key 无效

- **WHEN** 测试请求得到 401 或 403
- **THEN** 测试结果显示鉴权失败

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
