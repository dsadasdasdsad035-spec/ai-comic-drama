# Spec Delta

## Purpose

让所有配音渠道都通过一个统一音色目录工作：能动态列出的渠道列出账号音色，只能预置的渠道明确说明，允许自定义 ID 的渠道可以添加自己的音色，并让角色选择与配音校验使用同一份目录。

## ADDED Requirements

### Requirement: 统一音色目录包含来源和渠道

系统 SHALL 把各配音渠道的音色归一化为统一条目，至少包含 `id`、显示名、渠道 id、模型键、来源和能力标记。来源 MUST 能区分预置、账号音色、克隆、设计、系统语音和自定义；同一音色 MUST NOT 被归到其他渠道。

#### Scenario: 来源分组

- **WHEN** 用户打开角色卡音色下拉
- **THEN** 音色按渠道和来源分组，能看到“预置 / 账号 / 自定义 / 系统”等标记

#### Scenario: 渠道隔离

- **WHEN** 当前音频模型是 MiniMax
- **THEN** 下拉不显示 ElevenLabs 或 macOS 的音色，也不把其他渠道的 voice id 发给 MiniMax

### Requirement: 各渠道按自身能力提供音色

系统 SHALL 为每个配音渠道声明 `supportsList`、`supportsCustomVoiceId`、`supportsClone`、`supportsDesign`、`supportsPreview`。MiniMax、ElevenLabs、火山 SHALL 在账号/接口允许时动态列出音色；APIMart 只列 OpenAI 兼容预置；macOS 只列本机已安装语音。未声明的能力 MUST 视为不支持。

#### Scenario: MiniMax 账号音色

- **WHEN** MiniMax Key 可用且账号有克隆/设计音色
- **THEN** 目录包含系统音色和账号音色，并标出来源

#### Scenario: APIMart 预置

- **WHEN** 当前渠道是 APIMart `gpt-4o-mini-tts`
- **THEN** 只显示预置音色，`supportsCustomVoiceId` 和 `supportsClone` 为 false，不显示新增入口

#### Scenario: macOS 系统语音

- **WHEN** 当前渠道回落到 macOS say
- **THEN** 只显示本机探测到的已安装语音，不提供应用内创建

### Requirement: 目录支持刷新和缓存失效

系统 SHALL 缓存每个渠道的音色目录，并提供手动刷新；刷新 MUST 重新读取该渠道的账号音色/本机语音。用户切换音频模型、修改渠道 Key 或供应商返回鉴权失败时，相关缓存 MUST 失效或显示可读错误，不得继续展示过期账号音色。

#### Scenario: 手动刷新

- **WHEN** 用户在音色管理里点刷新
- **THEN** 系统重新请求当前渠道目录，新增/删除的账号音色出现在下拉中

#### Scenario: Key 失效

- **WHEN** 账号音色请求返回 401/403
- **THEN** 目录显示鉴权错误，预置音色仍可作为回退，不静默展示旧账号音色

### Requirement: 支持自定义音色的渠道可以添加条目

对支持 `supportsCustomVoiceId` 的渠道，系统 SHALL 允许用户添加自定义音色条目，包含渠道、模型键、voice id、显示名和可选说明；条目 MUST 保存在设置库，MUST NOT 写进项目数据。删除自定义条目 MUST NOT 影响供应商账号里的真实音色。

#### Scenario: 添加 MiniMax 自定义音色

- **WHEN** 用户在音色管理里添加一个 MiniMax voice id
- **THEN** 该条目出现在 MiniMax 分组，可在角色卡选择

#### Scenario: 不支持的渠道

- **WHEN** 用户在 APIMart 或 macOS 渠道尝试添加自定义音色
- **THEN** 新增入口禁用并说明该渠道只支持预置/本机音色

#### Scenario: 删除自定义条目

- **WHEN** 用户删除一个自定义音色
- **THEN** 目录不再显示它，供应商账号音色和其他条目不变

### Requirement: 角色卡音色下拉合并目录与自定义条目

角色卡的音色下拉 SHALL 合并当前渠道目录、自定义条目和旧项目里已保存的 `voiceId`。旧 `voiceId` 不在当前目录时 MUST 显示为“未知/保留原值”，允许用户保留或改选；MUST NOT 静默清空或替换成其他音色。

#### Scenario: 旧项目音色仍保留

- **WHEN** 打开一个项目的角色 `voiceId` 不在当前渠道目录
- **THEN** 下拉显示该原值并标记未知，保存项目不会改写它

#### Scenario: 选择自定义音色

- **WHEN** 用户选择一个自定义音色并保存角色
- **THEN** 角色的 `voiceId` 写入该 id，重新打开项目仍能选中

#### Scenario: 切渠道

- **WHEN** 用户把音频模型从 MiniMax 切到 ElevenLabs
- **THEN** 下拉显示 ElevenLabs 目录；旧 MiniMax voice id 作为不可用原值保留，不自动换成 ElevenLabs 音色

### Requirement: 显式音色不被静默回落

配音时如果角色/镜头显式指定了 `voiceId`，系统 MUST 使用该 id；供应商拒绝时 MUST 返回可读错误，MUST NOT 静默回落到默认音色。只有未指定音色或用户明确选择“跟随默认”时才使用渠道默认音色。

#### Scenario: 自定义 id 有效

- **WHEN** 角色选择了一个供应商接受的自定义 id
- **THEN** 合成请求使用该 id，不替换成默认音色

#### Scenario: 自定义 id 无效

- **WHEN** 供应商返回 voice id 不存在/无权限
- **THEN** 界面显示该错误和音色管理入口，保留角色原值，不静默换音色

#### Scenario: 没有显式音色

- **WHEN** 角色没有 voiceId 或选择跟随默认
- **THEN** 使用当前渠道默认音色

### Requirement: 音色目录按设置库和项目边界工作

自定义音色和渠道目录属于设置库（本机/账号级），角色选择属于项目数据；切换项目 MUST 保留各项目角色的 `voiceId`，MUST NOT 把项目 A 的自定义音色写成项目 B 的角色音色。音色 Key MUST NOT 出现在项目文件、线程或导出中。

#### Scenario: 项目 A/B

- **WHEN** 项目 A 的角色选择自定义音色，切到项目 B
- **THEN** B 的角色保持自己的 voiceId，A 的选择不变

#### Scenario: Key 不落项目

- **WHEN** 保存项目或导出项目
- **THEN** 项目文件不包含 TTS Key 或音色接口凭据

### Requirement: 音色管理有可操作的空态和错误态

音色管理页 MUST 区分“没有 Key”“账号没有音色”“渠道不支持自定义”“目录加载中”和“加载失败”；每种状态 MUST 给出下一步操作，不得只显示空下拉。

#### Scenario: 没有 Key

- **WHEN** 当前渠道没有配置 Key
- **THEN** 显示去渠道设置填 Key 的入口，预置音色仍可查看

#### Scenario: 账号没有克隆音色

- **WHEN** 目录请求成功但只返回系统音色
- **THEN** 显示“该账号还没有自定义音色”，不伪造条目

#### Scenario: 目录加载失败

- **WHEN** 目录接口超时或返回错误
- **THEN** 显示错误和重试按钮，不让用户误以为音色被删除
