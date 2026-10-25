# Design

## Context

See `proposal.md` for motivation. Current constraints that shape the approach:

- 模型适配层是 `src/agent/zcodeChatModel.ts` 里的自定义 `BaseChatModel`：把历史压平成一段文本，要求模型返回 `{"content","tool_calls"}`，再还原成 `AIMessage.tool_calls`。工具本身是 `DynamicStructuredTool`（zod schema），执行发生在浏览器的 LangGraph `tools` 节点。
- `/api/text` 目前只接受 `system + prompt`：服务端拼 messages、按环节模型路由、SSE 只回文本增量和 `finishReason`；`server/text-stream.mjs` 只收集 `delta.content`。
- 事件桥/聊天 UI 已经支持 `tool_start`、`tool_call_args`、`tool_call_input_available`、`tool_end`；工具卡按工具名注册，替换协议不需要改 UI。
- 五个阶段技能聊天（`SkillChat`/`stageAgentGraph`）与 3D agent 共用 `ZCodeChatModel`；本变更只改 3D 路径，JSON 路径必须保持可用。
- 已实测支持原生 tools 的模型：MiniMax-M3、Agent Plan 的 `doubao-seed-2-1-lite-260915`、`deepseek-v4-flash`、`kimi-k3`；标准方舟 Key 当前 401，DeepSeek 直连未配置 Key。

## Goals / Non-Goals

**Goals:**

- 3D agent 可按显式配置使用 provider 原生 tool_calls，且与现有工具、事件、上限、取消语义完全兼容。
- `/api/text` 向后兼容地支持 `messages`、`tools`、`toolChoice`，并归一化流式/非流式 tool_calls。
- 原生工具参数能以增量事件展示，但只在参数完整后执行。
- 保留 JSON action 路径，支持按环节回滚。
- 协议选择、模型能力、thinking 策略在配置与轨迹中可见。

**Non-Goals:**

- 不把五个阶段技能聊天切到原生 tools（后续变更可复用同一模型层）。
- 不改变工具集合、草稿 API、Blender 渲染/验收流程。
- 不新增并行工具执行语义；同一轮多个 tool_calls 仍按现有顺序执行。
- 不提高输出 token 上限，也不移除代码分片/补丁工作流。
- 不重做聊天 UI；只可能在设置页增加协议选择与能力状态。

## Decisions

### 1. 扩展现有 `/api/text`，不新建 agent 专用端点

请求体新增可选的 `messages`、`tools`、`toolChoice`；保留 `system + prompt`。响应新增 `toolCalls`；SSE 的 `done` 事件携带聚合后的完整 tool_calls。

理由：路由、Key 解析、thinking 策略、错误格式都在这一个处理器里，新端点会造成两套渠道逻辑。替代方案是 `/api/agent-chat`，被否：重复鉴权/路由代码，且旧调用仍要维护。

### 2. 新增 `NativeToolChatModel`，不把协议分支塞进 `ZCodeChatModel`

两者共享 `compactDraftHistory`、工具 schema/结果塑形和错误约定，但消息构造完全不同：JSON 模型把历史压平成 prompt；原生模型构造 provider messages（system / user / assistant.tool_calls / tool.tool_call_id）。

理由：JSON 路径已有兜底逻辑，混在一起会让两条路的回归面翻倍。替代方案是单类加 `protocol` 分支，被否：可读性和测试隔离都更差。

### 3. 原生消息映射保留真实角色

- `SystemMessage` → `system`；`HumanMessage` → `user`。
- 带 `tool_calls` 的 `AIMessage` → assistant，参数用 `JSON.stringify(args)`。
- `ToolMessage` → `tool`，带 `tool_call_id` 与 name；内容仍是 `modelFacingResult` 的 JSON 字符串。
- 映射前先跑 `compactDraftHistory`，把旧 append/patch 参数折叠；否则原生路径的历史会比 JSON 路径更长。

### 4. 工具 schema 用现有 zod 定义生成，不维护第二份

`z.toJSONSchema(tool.schema)` 生成 `parameters`，包装成 OpenAI function 格式；`toolChoice` 默认 `auto`。暂不使用 strict schema（各渠道支持不一致），参数仍由 `tool.invoke` 的 zod 校验兜底。

### 5. 协议选择用声明式能力表，不做运行时探测

环节配置增加 `toolProtocol: 'auto' | 'native' | 'json'`，默认 `auto`。`auto` 查一张按渠道/模型声明的能力表（首批只包含已实测的模型），命中才用 native，否则用同渠道 JSON。选定结果写入运行轨迹。

理由：运行时探测有成本和延迟，且失败会变成隐性回退；声明式能力表可在设置页展示、可测试、可回滚。替代方案是每次运行前探测，被否。

### 6. 原生请求的 thinking 策略

- MiniMax-M3：沿用 JSON 路径，`thinking: disabled`。
- DeepSeek Flash（Agent Plan）：`thinking: disabled`。
- Ark Plan 豆包：实测默认会 reasoning 并吃掉输出预算；需要在任务里验证 `thinking: {type:'disabled'}` 是否被接受，接受则关闭，否则在能力表标记“无法关闭”并保留 JSON 作为回退。
- Kimi/GLM：先不带 thinking 字段，按实测结果补充。

### 7. 流式工具参数只做进度，执行仍在 `tools` 节点

服务端按 `index` 聚合 `delta.tool_calls`，客户端模型通过新增的 `onToolCallDelta` 回调把增量交给图，映射成 `tool_call_args`；参数完整后返回 `AIMessage.tool_calls`，仍由现有 `toolsNode` 执行。这样不会引入第二条执行路径。

替代方案是收到完整参数后由模型层直接执行工具，被否：会绕过 LangGraph 的工具节点、事件和上限。

### 8. 失败语义：不静默换渠道，也不静默换协议

- provider 400（不支持 tools）：返回可读错误；`auto` 的能力表本应在请求前就避免这种情况。
- `finishReason=length` 或参数截断：不执行工具、不写草稿，报告截断。
- 用户取消：abort 上游，停止后续事件。
- JSON 兜底只在配置显式选择时启用，不在 native 请求失败后自动切换。

### 9. 兼容与迁移

服务端先发布（旧请求行为不变），客户端再上线；新配置默认 `auto`，首批能力表只覆盖已验证模型，其他模型继续 JSON。回滚只需把环节协议设为 `json`，无数据迁移。

## Risks / Trade-offs

- [渠道差异：tools/tool_choice/thinking 字段行为不一致] → 能力表按模型逐项声明；首批只开放已实测模型；失败返回可读错误，不做隐式回退。
- [原生参数同样会被截断] → 保留 `finishReason` 检测与分片提示；不把原生协议当成“不会截断”的保证。
- [两条协议路径长期分叉] → 共享工具执行、事件桥、上限与结果塑形；用同一组 S01/S05 场景做双协议回归。
- [历史映射后 token 反而变多] → 先跑 `compactDraftHistory`，并在验收里对比 JSON/native 的输入 token。
- [阶段聊天共用模型层] → 新模型类为增量新增，`ZCodeChatModel` 与阶段图不改；后续可单独切换。
- [标准方舟 Key 当前无效] → 首批不在标准方舟上启用 native；该项作为独立配置问题处理。

## Migration Plan

1. 服务端：扩展 `/api/text` 与流式解析，保持旧请求行为；先在 MiniMax / Agent Plan 上手工验证 tool_calls。
2. 客户端：新增 `NativeToolChatModel` 与消息映射；`runSceneAgent` 按配置选择模型，默认 `auto`。
3. 配置：能力表与协议字段；设置页显示当前协议与模型支持状态。
4. 验收：S01/S05 双协议对比；覆盖流式参数、截断、取消、不支持 tools 的模型。
5. 回滚：环节协议切回 `json`；无需迁移数据。

## Open Questions

- Ark Plan 豆包与 Kimi/GLM 对 `thinking` 字段的接受度，需在任务中用真实 Key 验证。
- `tool_choice` 与 strict schema 是否值得在首批启用，等双协议回归数据后再定。
- 阶段聊天是否在后续变更中复用原生模型层，不在本次范围。
