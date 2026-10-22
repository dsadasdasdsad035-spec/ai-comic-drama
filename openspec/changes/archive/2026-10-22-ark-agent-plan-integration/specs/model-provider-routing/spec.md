# Spec Delta

## Purpose

让应用可以按能力把生成请求路由到标准方舟或 Agent Plan 渠道，并按渠道维护可用的模型清单与能力边界。

## ADDED Requirements

### Requirement: Agent Plan 渠道可独立配置并承接文本与图片

系统 SHALL 支持新增一个 Agent Plan 渠道，使用独立 Base URL 与独立 API Key；该渠道的文本请求 MUST 发往其 `chat/completions`，图片请求 MUST 发往其 `images/generations`，且图片请求继续支持参考图。该渠道 MUST NOT 因缺少自身 Key 而回退使用标准方舟 Key。

#### Scenario: 文本走 Agent Plan

- **WHEN** 用户在设置里选中一个绑定到 Agent Plan 渠道的文本模型
- **THEN** 文本生成请求发往该渠道 Base URL 下的 `chat/completions`，并携带该渠道自己的 Key

#### Scenario: 图片走 Agent Plan

- **WHEN** 用户选中一个绑定到 Agent Plan 渠道的图片模型并附带参考图
- **THEN** 请求发往该渠道 Base URL 下的 `images/generations`，参考图按既有方舟协议提交

#### Scenario: Agent Plan 渠道缺 Key

- **WHEN** Agent Plan 渠道没有填写自己的 API Key
- **THEN** 文本或图片请求返回明确的缺 Key 错误，不静默改用标准方舟 Key

#### Scenario: 视频不提供 Agent Plan 选项

- **WHEN** 用户为视频或视频参考能力选择渠道
- **THEN** 只列出声明了视频能力的渠道，当前套餐的 Agent Plan 渠道不出现在列表中

### Requirement: 提供经过验证的 Agent Plan 模型预设

系统 SHALL 预置当前套餐可用的 Agent Plan 模型：文本使用 `doubao-seed-2.1-lite-260915` 与 `doubao-seed-2.1-pro-260915`，图片与三视图使用 `doubao-seedream-5-0-pro-260628`。图片与三视图的初始默认 MUST 指向 Agent Plan；文本、高质量文本与配音的初始默认 MUST 指向 MiniMax（见下一条）。已有设置中保存的默认值 MUST 保持不变。Key 解析 MUST 优先使用设置库中的渠道 Key，其次使用本地 `.env` / 环境变量中的专用 Key；两者都没有时才返回明确缺 Key 错误。预设 MUST NOT 使用已标记下线的模型 ID。

#### Scenario: 文本预设可用

- **WHEN** 用户查看模型表的文本与高质量文本分组
- **THEN** 可以看到绑定到 Agent Plan 渠道的 `doubao-seed-2.1-lite-260915` 与 `doubao-seed-2.1-pro-260915`

#### Scenario: 图片预设可用

- **WHEN** 用户查看图片与三视图分组
- **THEN** 可以看到绑定到 Agent Plan 渠道的 `doubao-seedream-5-0-pro-260628`

#### Scenario: 不预置下线模型

- **WHEN** 用户查看 Agent Plan 预设
- **THEN** 看不到截图中标记“即将下线”的模型作为预设默认值

#### Scenario: 全新实例图片默认 Agent Plan

- **WHEN** 应用在一个没有保存过设置的环境里启动
- **THEN** 图片与三视图默认指向 Agent Plan 的 Seedream 模型，视频与视频参考仍指向标准方舟

#### Scenario: Key 留空不串号

- **WHEN** 初始默认模型所属渠道和本地配置都没有 API Key
- **THEN** 文本、图片或配音请求返回明确的缺 Key 错误，不回退使用其他渠道的 Key

#### Scenario: 本地配置有 Key

- **WHEN** 渠道本身没有填 Key，但本地 `.env` 或环境变量里有对应渠道的专用 Key（如 `MINIMAX_API_KEY`、`ARK_AGENT_PLAN_API_KEY`、`VOLC_TTS_API_KEY`）
- **THEN** 文本、图片或配音请求使用本地配置的 Key，不返回缺 Key 错误

#### Scenario: 设置库 Key 优先

- **WHEN** 设置库里渠道 Key 与本地 `.env` 同时存在且不同
- **THEN** 请求使用设置库里的渠道 Key

#### Scenario: 已有设置保留默认值

- **WHEN** 已有设置中保存了旧的文本或图片默认模型
- **THEN** 升级后继续使用已保存的默认值，不被新的初始默认值覆盖

### Requirement: MiniMax 作为文本与配音的默认渠道

系统 SHALL 预置 MiniMax M3 文本模型与 MiniMax speech-2.8-hd 音频模型；全新实例的文本、高质量文本、配音默认 MUST 指向 MiniMax。MiniMax Key MUST 优先取设置库，其次取本地 `.env` / 环境变量的 `MINIMAX_API_KEY`。MiniMax-M3 的结构化 JSON 请求 MUST 使用 OpenAI 兼容 `/chat/completions` 并关闭 thinking；返回空 content 时 MUST 返回包含 finish/usage 的可读错误。选中的 MiniMax 音色不在可用表时 MUST 回落到默认音色，不得把其他渠道的音色名发给 MiniMax。

#### Scenario: 全新实例文本默认 MiniMax

- **WHEN** 应用在一个没有保存过设置的环境里启动
- **THEN** 文本与高质量文本默认分别指向 `minimax-text` / `minimax-text-pro`，模型为 `MiniMax-M3`

#### Scenario: 配音默认 MiniMax

- **WHEN** 应用在一个没有保存过设置的环境里启动
- **THEN** 配音默认指向 `minimax-tts`，模型为 `speech-2.8-hd`，音色列表包含 MiniMax 音色

#### Scenario: 无效音色回落

- **WHEN** 配音请求传入 `Tingting` 或其他渠道的音色名
- **THEN** 系统改用 `male-qn-qingse` 提交，不返回 `2054 voice id not exist`

#### Scenario: 结构化输出关闭思考

- **WHEN** 拆镜/拆集等 JSON 请求使用 `MiniMax-M3`
- **THEN** 请求发往 `/chat/completions` 且 `thinking.type` 为 `disabled`，返回非空 content；若 content 为空，错误信息包含 finish_reason 与 usage

#### Scenario: 本地 Key

- **WHEN** MiniMax 渠道本身没有填 Key，但本地 `.env` 或环境变量里有 `MINIMAX_API_KEY`
- **THEN** 文本与配音请求使用本地 Key，不返回缺 Key 错误

### Requirement: 按能力显式路由且不做自动回退

系统 SHALL 以设置中每个能力选定的渠道与模型为准发起请求；一个渠道不支持某能力时 MUST NOT 出现在该能力的选择列表中；请求失败时 MUST 直接返回错误，不得自动改用其他渠道重试。

#### Scenario: 视频继续走标准方舟

- **WHEN** 用户生成视频或视频参考
- **THEN** 请求使用标准方舟渠道配置的视频模型与 Key

#### Scenario: Agent Plan 失败不自动重试

- **WHEN** Agent Plan 的文本或图片请求返回模型不支持或鉴权错误
- **THEN** 画布直接显示该错误，不向标准方舟渠道重新提交

#### Scenario: 文本切回标准方舟

- **WHEN** 用户把文本默认模型切换为绑定标准方舟渠道的模型
- **THEN** 后续文本请求使用标准方舟 Base URL 与 Key，不影响图片的 Agent Plan 选择

### Requirement: 渠道连通性测试适配 Agent Plan

系统 SHALL 在测试 Agent Plan 渠道时使用一次 1-token 文本对话，因为该渠道不提供 `/models` 列表；测试 MUST 使用该渠道绑定的文本模型，而不是标准方舟默认模型。通道不可用或 Key 无效时 MUST 返回可读错误。

#### Scenario: models 不可用时回退对话

- **WHEN** Agent Plan 的 `models` 请求返回 400 或 404
- **THEN** 系统改用该渠道绑定的文本模型发起 1-token 对话并报告结果

#### Scenario: 测试使用渠道自己的模型

- **WHEN** 用户测试 Agent Plan 渠道
- **THEN** 测试请求中的模型来自该渠道的文本模型绑定，不回退到标准方舟默认模型

#### Scenario: Key 无效

- **WHEN** Agent Plan 渠道的 Key 鉴权失败
- **THEN** 测试结果显示鉴权失败与可读原因

#### Scenario: 没有文本模型可测

- **WHEN** Agent Plan 渠道还没有绑定任何文本模型
- **THEN** 测试返回明确提示，要求先添加文本模型，不发起无模型的请求
