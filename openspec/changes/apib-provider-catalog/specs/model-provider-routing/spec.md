# Spec Delta

## ADDED Requirements

### Requirement: APIMart 渠道可独立配置并承接四类能力

系统 SHALL 支持新增 APIMart 渠道，使用独立 Base URL 与 API Key；该渠道 MUST 声明文本、图像、视频、音频四类用途。Key MUST 优先取设置库，其次取 `APIB_API_KEY` / `APIMART_API_KEY`；缺少自身 Key 时 MUST 返回缺 Key 错误，MUST NOT 回退方舟或其他渠道的 Key。

#### Scenario: 配置 APIMart 渠道

- **WHEN** 用户在设置页添加 APIMart 渠道并填入 Key
- **THEN** 该渠道可以承接文本、图像、视频与音频请求

#### Scenario: 缺少 APIMart Key

- **WHEN** APIMart 渠道既没有设置库 Key，也没有 `APIB_API_KEY` / `APIMART_API_KEY`
- **THEN** 请求返回明确的缺 Key 错误，不静默改用方舟 Key

#### Scenario: 用途列表

- **WHEN** 用户为文本、图像、视频或音频选择渠道
- **THEN** APIMart 只出现在它声明了用途的能力列表中

### Requirement: APIMart 文本与视觉走统一 chat 协议

系统 SHALL 向 `{base}/chat/completions` 发送 APIMart 文本请求，并兼容响应外层 `{code, data}` 与裸 OpenAI 响应；流式 MUST 同时解析两种分片。视觉请求 MUST 只在模型声明视觉能力时可用。

#### Scenario: 非流式包装响应

- **WHEN** APIMart 返回 `{code: 200, data: {choices: [...]}}`
- **THEN** 系统读取内层 `choices` 并返回文本，不把外层 `code` 当成错误

#### Scenario: 流式包装分片

- **WHEN** SSE 分片的 `choices` 位于外层或 `data` 内层
- **THEN** 系统都能解析增量文本，并在结束时返回完整内容

#### Scenario: 视觉能力已声明

- **WHEN** 用户为视觉能力选择了一个带视觉标签的 APIMart 模型
- **THEN** 系统按 OpenAI 兼容的 image content part 提交图片与提示词

#### Scenario: 视觉能力未声明

- **WHEN** 用户试图用未声明视觉能力的 APIMart 模型做图像理解
- **THEN** 系统拒绝该请求并提示模型不支持视觉输入

### Requirement: APIMart 图像走异步任务

系统 SHALL 向 `{base}/images/generations` 提交图像任务并读取 `data[0].task_id`，轮询 `GET {base}/tasks/{id}` 直到 completed、failed 或 cancelled；完成时 MUST 立即下载结果到本地。参考图 MUST 先通过 `{base}/uploads/images` 换成 URL 后再提交。

#### Scenario: 文生图

- **WHEN** 用户用 APIMart 图像模型生成画面且没有参考图
- **THEN** 系统提交任务、轮询到完成后下载图片并返回站内路径

#### Scenario: 带参考图

- **WHEN** 用户提交本地参考图
- **THEN** 系统先上传参考图取得 URL，再把它放入图像任务的参考图字段

#### Scenario: 任务失败

- **WHEN** 轮询返回 failed 或 cancelled
- **THEN** 系统返回可读失败原因，不把空结果当成成功

#### Scenario: 结果链接过期

- **WHEN** 任务完成并返回临时结果 URL
- **THEN** 系统在返回给画布前把文件下载到项目目录，不依赖过期链接

#### Scenario: 请求取消

- **WHEN** 用户在任务完成前取消生成
- **THEN** 系统停止轮询并返回已取消，不写入半成品图片

### Requirement: APIMart 视频使用统一字段的通用适配

系统 SHALL 通过 `{base}/videos/generations` 的通用字段提交生成型视频模型：`prompt`、`duration`、`resolution`、`aspect_ratio`、`first_frame_image`、`last_frame_image`、`image_urls`、`video_urls`。Seedance 2.5 与 Kling v3 MAY 使用各自专用字段。需要源视频/源任务的编辑、动作控制、再生成或提示词增强模型 MUST 标记为目录可用但运行不可选。

#### Scenario: 通用首帧出片

- **WHEN** 用户选择一个通用 APIMart 视频模型并提交首帧图片
- **THEN** 系统提交 `first_frame_image`、`prompt`、`duration`、`resolution` 与 `aspect_ratio`，轮询完成后下载视频

#### Scenario: 通用多参考图

- **WHEN** 用户为通用 APIMart 视频模型提交多张参考图
- **THEN** 系统把参考图放进 `image_urls`，超出模型上限时返回参数错误

#### Scenario: 专用视频族

- **WHEN** 用户选择 Seedance 2.5 或 Kling v3
- **THEN** 系统继续使用该族的专用字段（首尾帧角色、参考视频任务类型）

#### Scenario: 非生成型视频模型

- **WHEN** 用户为编辑、动作控制、再生成或提示词增强模型发起生成
- **THEN** 系统返回“需要源视频/源任务”，不提交近似请求

#### Scenario: 本地参考视频没有公网 URL

- **WHEN** 用户为 APIMart 视频参考提交本地视频且没有可公开访问的 URL
- **THEN** 系统返回可读错误，提示该渠道只接受公网参考视频

### Requirement: APIMart 配音走 OpenAI 音频协议

系统 SHALL 向 `{base}/audio/speech` 提交模型、文本、音色与输出格式，把二进制音频落盘并返回站内路径与真实时长；音色列表 MUST 使用 APIMart 的 6 个音色，未知音色 MUST 回落到 APIMart 默认音色。

#### Scenario: 合成一句台词

- **WHEN** 用户用 APIMart 配音模型合成台词
- **THEN** 系统提交 `input`、`voice` 与 `response_format`，保存音频并返回时长

#### Scenario: 音色列表

- **WHEN** 用户把配音模型切换为 APIMart
- **THEN** 音色列表更新为 APIMart 的 6 个音色，不继续显示其他渠道音色

#### Scenario: 未知音色

- **WHEN** 请求传入的音色不在 APIMart 音色表中
- **THEN** 系统改用 APIMart 默认音色提交，不把其他渠道的音色名发给 APIMart

#### Scenario: 返回非音频

- **WHEN** APIMart 音频接口返回错误 JSON 或空响应
- **THEN** 系统返回可读错误，不写入空音频文件

### Requirement: 一个模型可声明多个能力

系统 SHALL 允许模型条目声明多个能力，并按能力谓词路由；同一模型 MUST NOT 需要重复登记才能被不同能力选中。

#### Scenario: 文本与高质量文本

- **WHEN** 一个文本模型同时声明文本与高质量文本
- **THEN** 两个默认路由都能选中同一行模型，不需要两条模型记录

#### Scenario: 图像与三视图

- **WHEN** 一个图像模型同时声明图像与三视图
- **THEN** 画布出图与角色三视图都能选中该模型

#### Scenario: 视频与视频参考

- **WHEN** 一个视频模型声明视频能力并支持视频参考
- **THEN** 视频参考能力可以选中该模型，不需要单独的参考模型行

#### Scenario: 旧单能力条目

- **WHEN** 旧设置中的模型只有单一 `cap`
- **THEN** 系统按该能力继续路由，不因缺少多能力字段而失效

### Requirement: 目录登记但未接入运行时的模型不可被选为默认

系统 SHALL 区分“已登记”与“可运行”；未接入运行时的模型 MUST 在默认路由与生成选择中不可选，并显示“未接入运行时”。直接传入该模型键时 MUST 返回明确错误，不得静默改用同渠道其他模型。

#### Scenario: 默认路由排除

- **WHEN** 用户在某个能力的默认路由中打开模型下拉
- **THEN** 未接入运行时的模型不出现在可选列表中

#### Scenario: 直接传入未接入模型键

- **WHEN** 生成请求显式传入一个目录已登记但运行未接入的模型键
- **THEN** 系统返回“未接入运行时”错误，不改用同渠道其他模型

#### Scenario: 模型库标记

- **WHEN** 用户在模型库查看一个目录已登记但运行未接入的模型
- **THEN** 行内显示“未接入运行时”，且不能把它设为默认

### Requirement: APIMart 渠道测试区分余额不足

系统 SHALL 用 `GET /models` 或一次 1-token 对话测试 APIMart；402 MUST 报告余额不足，401/403 MUST 报告鉴权失败，成功 MUST 报告连通。测试 MUST NOT 创建生成任务或写入媒体文件。

#### Scenario: 余额不足

- **WHEN** APIMart 测试返回 402
- **THEN** 测试结果显示“余额不足”，不显示成 Key 无效

#### Scenario: 鉴权失败

- **WHEN** APIMart 测试返回 401 或 403
- **THEN** 测试结果显示 Key 无效或无权限

#### Scenario: 连通

- **WHEN** APIMart 的模型列表或 1-token 对话返回成功
- **THEN** 测试结果显示连通与耗时，不创建任何生成任务
