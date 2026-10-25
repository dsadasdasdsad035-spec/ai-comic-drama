# Spec Delta

## Purpose

让每句台词有可执行的表演参数，并在不改变音色身份的前提下，按当前 TTS 引擎把情绪、语速和音量映射到原生能力；不支持的引擎必须明确降级，不能把表演标签读进台词。

## ADDED Requirements

### Requirement: 台词行携带表演参数

系统 SHALL 允许每个台词行携带可选的 `emotion`、0-5 `intensity`、`pace`、`volume` 和 `emphasis`；`emotion` 取值限定为 neutral、happy、sad、angry、fearful、disgusted、surprised、calm，`pace` 限定为 slow、normal、fast，`volume` 限定为 whisper、soft、normal、loud、shout。缺少字段时 MUST 按 neutral、normal 处理；旧项目没有这些字段时 MUST 正常读取。

#### Scenario: 旧台词

- **WHEN** 打开一个台词只有 speaker 和 text 的旧项目
- **THEN** 每句按 neutral / normal 合成，不报错、不要求迁移

#### Scenario: 同镜不同句

- **WHEN** 同一角色在一镜里第一句压低声、第二句爆发
- **THEN** 两句分别保存自己的情绪与音量，合成时按句应用

#### Scenario: 只填部分参数

- **WHEN** 用户只给一句台词选了 sad，没有填强度、语速和音量
- **THEN** 情绪为 sad，其余使用默认值，不把未填字段写成空字符串

#### Scenario: 清空表演

- **WHEN** 用户清空某句的表演参数
- **THEN** 该句回到默认值，其他句不受影响

### Requirement: 音色身份与表演分离

选择情绪、语速或音量 MUST NOT 改写角色的 `voice` / `voiceId`；更换角色音色 MUST NOT 改写已经保存的表演参数。一镜多说话人时 MUST 继续按角色取各自音色，不得因为情绪不同而换音色。

#### Scenario: 改情绪不换音色

- **WHEN** 用户把同一角色的台词从 calm 改成 angry
- **THEN** 角色的音色 id 保持不变，只改变表演参数

#### Scenario: 换音色不丢表演

- **WHEN** 用户给角色换了一个音色
- **THEN** 该角色之前的情绪、语速和音量仍然保留，等待重新合成

#### Scenario: 多说话人

- **WHEN** 一镜里 A 和 B 各有一句台词
- **THEN** A 用 A 的音色与表演，B 用 B 的音色与表演

### Requirement: 按引擎映射表演参数

系统 SHALL 在当前 TTS 引擎支持时把归一化表演参数映射为引擎原生参数：MiniMax 使用 `voice_setting` 的 emotion / speed / vol；火山 Seed TTS 使用 emotion / emotion_scale / speech_rate / loudness_rate；ElevenLabs 使用音频标签或 style；OpenAI 兼容渠道使用 `instructions`。合成文本 MUST 只包含台词原文，表演标签 MUST NOT 被朗读。

#### Scenario: MiniMax

- **WHEN** 当前引擎是 MiniMax speech-2.8-hd，台词情绪为 sad、音量为 soft
- **THEN** 请求的 `voice_setting` 带上对应 emotion 与 vol，text 仍是台词原文

#### Scenario: 火山 TTS

- **WHEN** 当前引擎是火山 Seed TTS，台词情绪为 angry、强度 4
- **THEN** 请求带上对应 emotion、emotion_scale、speech_rate 与 loudness_rate，不把情绪写进 text

#### Scenario: ElevenLabs

- **WHEN** 当前引擎是 ElevenLabs 且模型支持音频标签
- **THEN** 表演标签只进入发送给引擎的文本或 style 参数，不进入项目台词与字幕

#### Scenario: OpenAI 兼容渠道

- **WHEN** 当前引擎是支持 `instructions` 的 gpt-4o-mini-tts 兼容渠道
- **THEN** 情绪、语速、音量和重音写入 `instructions`，text 仍是台词原文

### Requirement: 不支持的引擎显式降级

引擎或当前音色不支持某个表演参数时，系统 SHALL 继续合成默认语气，并在结果中标记哪些参数未应用；MUST NOT 因为情绪不支持而失败，也 MUST NOT 静默假装已应用。

#### Scenario: 引擎不支持情绪

- **WHEN** 当前引擎没有情绪参数，用户给台词选了 angry
- **THEN** 系统按默认语气合成，并显示“该引擎未应用情绪”

#### Scenario: 音色不支持强度

- **WHEN** 引擎支持情绪但不支持 0-5 强度
- **THEN** 系统保留情绪、忽略强度，并在结果中标记强度未应用

#### Scenario: 台词为空

- **WHEN** 要合成的台词为空
- **THEN** 沿用现有错误，不发起请求

### Requirement: 表演标签不进入台词与字幕

表演参数 MUST 作为元数据保存；TTS 实际朗读文本、项目台词和字幕 MUST 使用用户可读的台词原文。由系统生成的 provider 标签、参数说明或情绪括号 MUST NOT 出现在字幕或台词编辑框中。

#### Scenario: 字幕不带标签

- **WHEN** 一句台词使用 ElevenLabs 音频标签合成
- **THEN** 字幕仍显示原句，不显示 `[angry]` 等标签

#### Scenario: 用户自己写的括注

- **WHEN** 用户在台词正文里自己写了“（低声）”
- **THEN** 这段括注仍属于台词原文，按现有规则处理，不被系统擅自删除或改写

#### Scenario: 切回通用引擎

- **WHEN** 用户从支持标签的引擎切到不支持标签的引擎
- **THEN** 系统重新生成干净的合成文本，不把上一引擎的标签发过去

### Requirement: 配音结果可追溯且可判定失效

配音结果 SHALL 记录实际使用的引擎、模型、音色、已应用/未应用的表演参数，以及台词与表演的指纹。当台词文本或表演参数变化时，系统 MUST 把已有配音标记为需要重生成，但 MUST NOT 删除已有音频；重新合成成功后替换标记。

#### Scenario: 改台词

- **WHEN** 用户改了一句台词的字
- **THEN** 该镜配音标记为需要重生成，旧音频仍可播放

#### Scenario: 改情绪

- **WHEN** 用户只改了某句的情绪，没有改字
- **THEN** 配音标记为需要重生成，因为表演指纹已经变化

#### Scenario: 未变化

- **WHEN** 台词与表演都没有变化，用户重新打开项目
- **THEN** 配音保持已生成状态，不要求无意义地重生成
