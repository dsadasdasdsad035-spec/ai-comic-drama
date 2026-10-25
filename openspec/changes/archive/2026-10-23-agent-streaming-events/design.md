# Design

## Context

见 `proposal.md - Why`。实现层面的现状：

- `/api/text` 用 `await r.text()` 读完整段上游响应后再 `JSON.parse`，请求体里没有 `stream`（`vite.config.ts`）。
- `ZCodeChatModel._generate` 一次返回整个 `AIMessage`，没有 `_streamResponseChunks`；协议是 JSON action（`{content, tool_calls}`），不是 provider 原生工具调用。
- 图节点 `agentNode` 用 `model.invoke`；`streamEvents` 能拿到 `on_chat_model_stream`，但 `sceneAgentEvents.ts` 显式丢弃它（第 186 行附近）。
- `AgentEvent` 只有 `agent_step`、`tool_start/end`、`code/frames/review`、`done/cancelled/error`；`agent_step` 同时承载步骤与助手文本，文本没有 `messageId`。
- UI 用 `useExternalStoreRuntime` + `convertMessage` 把 parts 投影成 `ThreadMessageLike`；工具卡用 `makeAssistantToolUI` 注册。
- 约束：工具在浏览器执行（Blender 走 HTTP、资产 prep 用 canvas），所以 agent 循环必须留在浏览器；不新增依赖。

## Goals / Non-Goals

**Goals:**

- 一套内部事件词表，能同时表达 L1 进度、L2 文本流、L3 工具参数流，后续加层不推翻数据形状。
- L1 不依赖协议改动即可交付。
- L2/L3 在原生工具调用落地后是加法，不是重写。
- 保留扁平事件日志：可回放、可审计、可测试。

**Non-Goals:**

- 不把 agent 迁到服务端，不引入 AG-UI/AI SDK 运行时依赖。
- 不实现 `StateSnapshot/StateDelta`；工作台状态继续留在 React。
- 不流 reasoning/thinking；不做 L4（剧本/提示词 JSON 的逐字展示）。
- 不在本变更实现审批 UI，只保留事件语义。

## Decisions

### 1. 借 AG-UI 的名字与语义，不接它的 SDK

采用 AG-UI 的一个子集作为内部词表：`run`、`step`、`text_message`、`tool_call`、`custom`。理由：现有 UI 已经按事件构建 parts，扁平日志比消息树更适合回放与测试；AG-UI 的 SDK 面向"图跑在服务端、UI 通过 HTTP 连"的形态，和这里不符。

**Alternatives**：直接引入 `@ag-ui/core` 类型与 `@ag-ui/langgraph`（多一层依赖和版本约束，收益只是事件名）；直接采用 AI SDK 的 `UIMessage` 作为内部模型（会把传输格式绑进领域事件）。

### 2. 步骤与文本消息分开

- `step` = 一次后端处理边界（模型节点开始/结束），只带 `stepName`。
- `text` = 助手说的一段话，带 `messageId`、`role`，生命周期 start → content* → end。
- `tool_call` = 独立实体，带 `toolCallId`。

现状的 `agent_step{text}` 是三者揉在一起，必须先拆，否则 L2 没有承载结构。

### 3. 事件词表（内部子集）

| 事件 | 字段 | 用途 |
|---|---|---|
| `run_started` | `runId` | 一次 agent 运行 |
| `run_finished` | `result` | 正常结束 |
| `run_cancelled` | `reason?` | 本地扩展；AG-UI 无取消事件 |
| `run_error` | `message`, `phase?` | 失败 |
| `step_started` / `step_finished` | `stepName` | 模型节点边界 |
| `text_message_start` | `messageId`, `role` | 助手说明开始 |
| `text_message_content` | `messageId`, `delta` | **L2** |
| `text_message_end` | `messageId` | 助手说明结束 |
| `tool_call_start` | `toolCallId`, `toolName` | 工具开始 |
| `tool_call_args` | `toolCallId`, `delta` | **L3**，原始 JSON 片段 |
| `tool_call_input_available` | `toolCallId`, `input` | 唯一可执行信号 |
| `tool_call_end` | `toolCallId` | 参数结束 |
| `tool_call_result` | `toolCallId`, `content`, `isError?` | 结果 |
| `custom` | `name`, `value` | `code` / `frames` / `review` / `video` / `progress` |

`text_message_content` 的 `delta` 承诺是**面向用户的说明文字**，不是 JSON 片段。

### 4. 三档交付，L1 先行

- **L1 进度**：代理按块计数，发 `custom{name:'progress', value:{chars}}`；不改 JSON 协议、不改事件结构，所有长输出面（剧本、分镜、提示词、代码）都能复用。默认开启，非 SSE 响应自动回退。
- **L2 文本流**：需要原生工具调用，让 provider 把 `content` 与 `tool_calls` 分开流；否则只能做增量 `content` 提取。
- **L3 代码流**：工具参数分片到达；`tool_call_input_available` 前不进入草稿、不试运行。

不做"假装 L2"：直接转发 JSON 片段再在 UI 里裁剪，会把转义、半截字符串和 CoT 风险带进聊天层。增量 `content` 提取只作为原生工具调用被卡死时的内部兜底，且只提取 `content`，绝不提取工具参数。

### 5. 传输：POST + SSE，自己解析

- 代理侧：`text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`；逐行解析上游 `data:`，遇 `[DONE]` 结束；`req.on('close')` 时 abort 上游 fetch。
- 客户端：`fetch` + `ReadableStream` + `TextDecoder`，按 `\n\n` 切事件；`AbortSignal` 一路透传。
- 不用 `EventSource`（只支持 GET）；不引入流式解析库。

### 6. 工具参数：分片只做观察，完整才执行

`tool_call_args` 是 JSON 字符串片段，可能在任意位置切断。消费者规则：

- 代码页签只在 `tool_call_input_available` 后接收草稿；
- 试运行/保存/验收只认完整参数；
- 分片期间最多显示"已接收 4.2k 字符"，不渲染代码。

### 7. reasoning 在代理层就丢掉

上游的 `reasoning_content` / `thinking` 增量在代理解析时直接丢弃，不进入事件流、不进入日志；这与现有"不展示 chain-of-thought"的约束一致，属于有意的过滤，不是"没有这个事件"。

### 8. 重试用 reset 语义

现有 agent 最多修复 3 次。流式后，失败那一轮已流出的文本必须作废：

- 每次尝试使用新的 `messageId`；
- 失败时发 `text_message_end`（或内部 reset），UI 移除该 `messageId` 的增量；
- 不用"同一个 messageId 覆盖"，避免半截文字和新内容拼接。

### 9. 取消是 transport 行为，不是普通错误

- 客户端 abort → 代理 abort 上游 → 不再有 delta；
- 本地发 `run_cancelled`，UI 保留取消前的已确认内容；
- 不把取消塞进 `run_error`；也不采用 AG-UI 的 `RunFinished.outcome:'interrupt'`（那是 HITL，不是取消）。

### 10. UI 更新按帧合并

每个 delta 都 `patchMessage` 会带来 30–60 次/秒的 React 更新。实现上把增量写入 ref，按 `requestAnimationFrame` 或 80ms 节流刷新到 state；助手消息在流式期间 `status` 保持 `running`，结束后才 `complete`。

### 11. 领域负载继续用 custom

`code`、`frames`、`review`、`video` 保持独立事件，不塞进 `state_delta`。理由：这些是工具卡片的领域数据，不是可 JSON Patch 的共享状态；`convertMessage` 里已经有 `data` part 的投影路径。

### 12. 审批语义预留，不在本轮实现

AI SDK 的 `tool-approval-request/response` 正好对应"验收通过才保存"的闸门。本轮只把语义记在设计里：未来若要"用户点一下采用"，用 `approvalId` 关联请求与响应，不把它混进工具结果。

## 一条带流式的时序

```
客户端                  本地代理(SSE)                 模型
  | run_started            |                          |
  | step_started           |                          |
  | text_message_start     |<-- content delta --------|
  | text_message_content   |<-- content delta --------|
  | text_message_end       |                          |
  | tool_call_start        |<-- tool_call delta ------|
  | tool_call_args(delta)  |<-- args fragments -------|
  | tool_call_end          |                          |
  | tool_call_input_available                          |
  | tool_call_result       |  本地执行（Blender/视觉） |
  | custom(frames/review)  |                          |
  | step_finished          |                          |
  | run_finished           |                          |
```

工具执行在浏览器，`tool_call_result` 与 `custom` 是本地事件；只有文本和参数增量来自代理。

## Risks / Trade-offs

- **[各渠道 SSE 形状不同]** → 代理内按 provider 写一个解析器，用录制样本做 golden test；解析失败回退到非流式整段响应。
- **[分片 JSON 被误用]** → 执行入口只认 `tool_call_input_available`；代码页签在分片期间只显示字符数。
- **[Playwright 无法分块 mock]** → 解析器单测 + 测试里起本地 SSE server；现有六个 agent mock 需要流式变体。
- **[React 更新风暴]** → ref + rAF/80ms 节流；长文本只在结束时做一次最终对齐。
- **[重复轮次事件]** → 沿用 `run_id` 去重，并新增 `messageId` 作为文本维度去重键。
- **[L2 需要协议改造，可能被无限期推迟]** → L1 独立交付，不依赖原生工具调用；L2 明确标记为依赖项。
- **[reasoning 泄漏]** → 代理层过滤 + UI 层不处理未知增量类型；测试覆盖含 `reasoning_content` 的样本。

## Migration Plan

1. **L1**：`/api/text` 增加 opt-in 流式；代理只发字符计数；UI 在模型轮次上显示进度。默认开启：渠道不支持 SSE 时代理回退整段 JSON，不阻塞生成。
2. **事件词表**：新增类型与桥接映射，旧事件保留别名一个版本，测试逐步迁移。
3. **原生工具调用**（独立变更）：代理透传 `tools`，adapter 解析 `tool_calls`；L2 在此之后开启。
4. **L3**：接 `tool_call_args` 与 `input_available`，代码页签加"流式接收中，暂不可运行"状态。
5. **回滚**：所有档位由同一个开关控制；关闭后回到整段 JSON 路径，事件仍可消费旧字段。

## Open Questions

- Ark（含 Agent Plan 入口）、MiniMax、DeepSeek 的 `/chat/completions` 是否都支持 `stream:true`，以及流式错误与 usage 的形状；需要一次录制型 spike。
- L1 的进度单位用字符数还是近似 token 数（流式过程中 usage 通常不可得）。
- 如果模型 `content` 被设计成一句话，L2 的观感收益是否值得先于 L3 投入。
