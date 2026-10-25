# Spec Delta

## Purpose

让 3D 场景 agent 使用模型渠道原生的工具调用协议，替代由应用模拟的 JSON action 协议，移除外层 JSON 的解析、转义与截断故障，并让工具参数可以增量展示。

## ADDED Requirements

### Requirement: 工具协议必须按配置显式选择

3D 场景 agent 的工具协议 MUST 由环节配置显式选择：`auto`、`native` 或 `json`。`auto` 只在所选模型已声明支持原生工具调用时使用 native，否则使用 json；最终协议 MUST 在运行轨迹中可见。原生协议不可用时 MUST 返回可读错误或使用用户显式选择的 json，MUST NOT 静默改用其他渠道。

#### Scenario: auto 命中支持的模型

- **WHEN** 环节协议为 auto 且所选模型声明支持原生工具调用
- **THEN** 运行使用 provider 原生 tool_calls，并在轨迹中记录 native

#### Scenario: auto 命中不支持的模型

- **WHEN** 环节协议为 auto 且所选模型未声明支持原生工具调用
- **THEN** 运行使用同一渠道的 json 协议，不切换到其他渠道

#### Scenario: 用户强制 json

- **WHEN** 用户把协议显式设为 json
- **THEN** 即使模型支持 tools，运行仍使用 JSON action 协议

#### Scenario: native 请求失败

- **WHEN** provider 拒绝 tools 或 native 请求失败
- **THEN** 运行返回可读错误，不自动改用其他渠道或另一种协议

### Requirement: 服务端代理必须透传工具定义与调用

模型调用 MUST 继续经过服务端代理。代理 SHALL 接受 `messages`（含 assistant tool_calls 与 tool 角色）、`tools`、`toolChoice`，转发到当前环节选中的渠道，并把非流式 `message.tool_calls` 或流式 `delta.tool_calls` 归一化后返回；渠道 API Key MUST 只存在于服务端。

#### Scenario: 非流式工具调用

- **WHEN** provider 返回带 tool_calls 的非流式响应
- **THEN** 代理把工具名、参数和 finishReason 原样返回给浏览器

#### Scenario: 流式工具参数

- **WHEN** provider 以 `delta.tool_calls` 分片返回参数
- **THEN** 代理按 index 合并 id、name 和 arguments，并在完成事件中返回完整 tool_calls

#### Scenario: 旧调用保持可用

- **WHEN** 调用方仍发送 `system + prompt`
- **THEN** 代理按原有文本生成行为返回，不需要迁移

#### Scenario: Key 不进入浏览器

- **WHEN** 工具调用或聊天轨迹被保存
- **THEN** 不包含渠道 API Key 或鉴权头

### Requirement: 流式工具参数只能作为进度

原生流式工具参数 MUST 只作为可观察进度（参数增量事件）；在参数完整前 MUST NOT 执行工具、MUST NOT 写入代码草稿或触发渲染。只有收到完整的 `tool_calls` 或明确的参数完成信号后才可执行。

#### Scenario: 参数尚未完整

- **WHEN** 流式参数只到达一部分
- **THEN** 只更新工具卡的参数进度，不执行工具

#### Scenario: 参数完整

- **WHEN** 参数完整并得到完成信号
- **THEN** 工具只执行一次，并产生开始/结束/结果事件

#### Scenario: 流在参数完整前结束

- **WHEN** 流中断或输出被截断，参数没有闭合
- **THEN** 不执行工具、不写草稿，返回可读的截断错误

### Requirement: 原生工具调用必须产生等价的运行时事件

native 与 json 两种协议 MUST 产生同一套事件语义：稳定的工具调用标识、开始、参数增量、结束与结果，以及模型轮次和最终摘要。聊天 UI MUST 能按标识就地更新同一张工具卡，MUST NOT 产生重复的孤立卡片。

#### Scenario: 工具开始与结束

- **WHEN** 原生工具调用开始并结束
- **THEN** 聊天中出现一张带开始和结果状态的工具卡

#### Scenario: 同一轮多个工具

- **WHEN** provider 在同一轮返回多个工具调用
- **THEN** 每个调用有独立标识，各自更新自己的卡片

#### Scenario: 事件顺序

- **WHEN** 消费方读取事件流
- **THEN** 事件按发生顺序提供，reasoning 或 thinking 增量不进入事件流

### Requirement: 失败与取消必须可读且不伪造

provider 拒绝 tools、参数 JSON 不合法、输出被截断、网络中断或用户取消时，运行 MUST 给出可读错误或已取消状态，MUST NOT 伪造工具成功、MUST NOT 写入半成品代码。取消 MUST 终止上游请求并停止后续事件。

#### Scenario: 渠道不支持 tools

- **WHEN** provider 返回不支持 tools 的错误
- **THEN** 运行以可读错误结束，不把本轮标记为成功

#### Scenario: 输出被截断

- **WHEN** finishReason 为 length 或工具参数被截断
- **THEN** 运行报告截断原因，代码草稿保持不变

#### Scenario: 用户取消

- **WHEN** 用户在工具执行中取消
- **THEN** 上游请求被终止，之后不再产生文本增量、工具开始或完成事件
