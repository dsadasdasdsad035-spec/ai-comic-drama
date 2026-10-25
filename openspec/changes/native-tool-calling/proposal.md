# Proposal

## Why

3D 场景 agent 现在用「JSON action 协议」模拟工具调用：模型必须把 `{"content","tool_calls"}` 整段写成文本，代码再作为字符串嵌进 `tool_calls[].args`。这带来了一类已经实际发生的故障：外层 JSON 末尾多 `]}`、输出被截断、代码换行/引号转义失败，工具没有执行，模型却继续声称「已提交」；历史也只能压平成一段文本，长会话里的工具结果更容易错位。

当前配置里的模型已经支持原生工具调用（本机实测：MiniMax-M3、Agent Plan 的 doubao-seed-2-1-lite、deepseek-v4-flash、kimi-k3 都能返回正确的 `tool_calls`，并支持流式 `delta.tool_calls`）。把协议交给 provider，可以从根上移除「外层 JSON 是否合法」这一类失败，并让工具参数可以增量展示。

## What Changes

- 服务端文本代理支持工具协议：`/api/text` 接受 `messages`（含 assistant tool_calls / tool 角色）、`tools`（OpenAI function schema）、`toolChoice`，转发到当前环节选中的渠道；非流式回传 `message.tool_calls`，流式合并 `delta.tool_calls`（index/id/name/arguments），并继续透传 `finishReason`。
- 新增原生工具模型适配层：把 LangChain 消息按角色映射为 provider messages（system/human/ai/tool + `tool_call_id`），用 `z.toJSONSchema` 生成工具参数 schema，把 provider 的 `tool_calls` 还原成 `AIMessage.tool_calls`；继续复用 `compactDraftHistory` 折叠旧草稿分片。
- `runSceneAgent` 支持两种协议：按显式配置（`auto | native | json`）选择；`auto` 只使用已声明支持工具的模型，不做跨渠道或静默协议回退。原生模式跳过 JSON 协议提示，保留工具纪律与草稿分片规则。
- 工具执行时机：原生流式参数只作为进度事件；收到完整参数（或非流式完整 tool_calls）后才执行工具，沿用现有 `tool_start / tool_call_args / tool_call_input_available / tool_end` 事件词表，聊天 UI 不改。
- 范围边界：本变更先只覆盖 3D 场景 agent（sceneCode）；五个阶段技能聊天（SkillChat/stageAgentGraph）继续走现有 JSON 路径。工具集合、草稿语义、Blender 渲染与验收流程不变。
- 不把「协议不支持」当成自动回退理由：模型不支持工具时在请求前拒绝并返回可读错误，或由用户显式切换到 JSON；请求失败 MUST NOT 自动改用其他渠道。

## Capabilities

### New Capabilities

- `agent-native-tool-calling`: 场景 agent 的原生工具调用传输：服务端 tools 透传、provider `tool_calls` 归一化、流式参数事件、按模型能力选择协议、完整的失败语义。

### Modified Capabilities

- `scene-agent-runtime`: 模型适配层不再只消费「文本/JSON」，还要支持 provider 原生 `tool_calls`；运行时 MUST 在两种协议下保持相同的事件、工具执行门槛（参数完整才执行）与审计轨迹。
- `model-provider-routing`: 文本渠道需要声明是否支持原生工具调用，并说明工具调用模式下的 thinking 策略；协议选择 MUST 只使用声明支持的模型，MUST NOT 因协议不支持而改用其他渠道。

## Impact

- 服务端：`vite.config.ts` 的 `/api/text` 请求/响应形状与流式解析；`server/text-stream.mjs` 可能需要保留/转发 tool_calls 增量。
- 客户端：`src/api.ts` 的 `callTextStream`/`TextResult`；新增原生工具模型（或扩展 `zcodeChatModel`）；`src/agent/sceneAgentGraph.ts` 的模型选择与事件；`SceneAgentChat.tsx` 的协议配置与系统提示拼接。
- 配置：环节模型增加协议/能力字段（`auto | native | json`，以及模型是否支持 tools）；设置页需要可读的开关或状态说明。
- 工具与运行时：`sceneAgentTools.ts`、草稿 API、Blender host、验收流程不改；聊天 UI 的工具卡与事件 reducer 不改。
- 兼容性：`/api/text` 现有的 `system + prompt` 调用保持可用；JSON 路径保留，作为不支持 tools 的模型与回滚通道。
- 验证面：同一组镜头（S01 双人对打、S05 多人混战）分别跑原生与 JSON，比较首次工具调用成功率、修复轮数、事件完整性和 token 使用；标准方舟 Key 目前 401，原生路径先在 MiniMax / Agent Plan 上验证。
