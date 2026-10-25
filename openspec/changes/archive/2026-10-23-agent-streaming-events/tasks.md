# Tasks

## 1. 事件模型与纯 reducer

- [x] 1.1 扩展 `AgentEvent` 与部件类型：`text_message_start/content/end`、`tool_call_args`、`tool_call_input_available`、`custom`（progress）；文本部件带 `id`/`streaming`，步骤部件带 `chars`；验证：`tsc --noEmit` 通过，旧事件类型仍可消费
- [x] 1.2 抽出纯函数 `applyAgentEvent(message, event)` 并接回聊天的事件消费；验证：单测覆盖文本增量追加、进度更新、错误时清理该轮半截文本、取消保留已确认内容
- [x] 1.3 事件桥映射 `on_chat_model_start/stream/end` 为文本生命周期，丢弃 reasoning/thinking 增量，保留 `agent_step` 作为步骤边界；验证：单测注入合成 stream 事件，断言文本顺序与 reasoning 被过滤

## 2. L1 进度流（代理 + 客户端）

- [x] 2.1 新增服务端 SSE 解析器 `server/text-stream.mjs`：解析 `data:` 行与 `[DONE]`、提取 `delta.content`、丢弃 `reasoning_content`、累计字符；验证：Node 单测覆盖跨 chunk 边界、多行、reasoning、`[DONE]`
- [x] 2.2 `/api/text` 增加 `stream: true` 模式：SSE 头、`meta/progress/done/error` 事件、上游 abort、非 SSE 响应回退整段 JSON；验证：脚本对真实 provider 观察到 progress 与 done，非流式请求响应结构不变
- [x] 2.3 新增客户端 `callTextStream` 与纯解析器：`fetch` 流读取、SSE 解析、进度回调、非 SSE 回退；验证：esbuild 单测喂分块流，进度与最终文本正确
- [x] 2.4 接入 agent：`ZCodeChatModel` 使用流式调用并透传 `onProgress`，图把字符数变成 `custom progress` 事件，聊天显示「已生成 N 字符」；验证：SSE mock 下出现进度并正常完成，普通 JSON mock 仍走回退
- [x] 2.5 默认开启与回退策略：更新 `design.md` 的 rollout 说明为「默认开启、provider 不支持时自动回退」；验证：文档与实现一致

## 3. 取消与重试

- [x] 3.1 客户端断开或用户取消时 abort 上游请求，终止后不再产生增量；验证：取消长请求后服务端无孤儿流、无后续事件
- [x] 3.2 模型轮次失败重试时丢弃上一轮已流出的半截文本，使用新的 `messageId`；验证：reducer 单测 + SSE 冒烟：只保留重试后的文本

## 4. 验证与文档

- [x] 4.1 解析器单测（服务端 + 客户端）覆盖 `[DONE]`、reasoning、跨 chunk 边界、JSON 模式不泄露原始片段；验证：测试脚本全绿
- [x] 4.2 Playwright SSE 冒烟：`/api/text` 返回 SSE 时 agent 正常完成、聊天不出现原始 JSON、进度路径不破坏既有 agent 流程；验证：脚本通过
- [x] 4.3 README 更新流式进度、回退条件和事件词表；验证：文档描述的开关与行为与代码一致
- [x] 4.4 回归：`npm run build`、`verify-agent-graph.mjs`、`verify-code-workbench.mjs`、`verify-scene-code-contract.mjs` 全部通过

## Workflow follow-up

- L2 文本流依赖原生工具调用（独立变更），本次不实现。
- L3 代码流依赖 L2，本次只保留事件与门禁语义。
- 归档前先同步 `scene-agent-chat-ui` 与 `scene-agent-runtime` 主规格。
