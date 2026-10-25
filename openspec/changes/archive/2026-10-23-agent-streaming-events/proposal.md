# Proposal

## Why

3D 聊天的每一层都在等整段结果：`/api/text` 用 `await r.text()` 缓冲全文，`ZCodeChatModel` 没有流式分块，图节点用 `model.invoke`，事件桥还显式丢弃 `on_chat_model_stream`。结果是长代码生成、剧本和提示词生成期间界面只有一条「第 N 轮 · 模型调用中…」，用户无法判断是在生成还是卡死。

同时，现有 `AgentEvent` 把「步骤」和「助手消息」揉成一个 `agent_step`，文本没有独立生命周期，工具参数也没有增量；这让"流式"即使接通也没有承载它的结构。本变更借 AG-UI 的事件词表和 AI SDK 的流部件语义补齐这层契约，不更换运行时、不更换聊天 UI、不更换样式框架。

## What Changes

- 事件契约升级为三组：运行/步骤生命周期（run / step）、文本消息生命周期（start / content / end）、工具调用生命周期（start / args / end / result）；领域负载继续走 `custom`。
- 拆分 `agent_step`：步骤边界与助手文本分开，文本拥有稳定 `messageId`；工具调用保留 `toolCallId`。
- 事件桥不再丢弃模型流事件；新增增量事件与「参数完整才可执行」的显式信号。
- 流式分三档交付：
  - **L1 进度**：只流已生成字符数，不改 JSON 协议，所有长输出面复用；
  - **L2 文本流**：只流面向用户的 `content`，需要原生工具调用或增量 JSON 提取；
  - **L3 代码流**：工具参数增量到达，但代码页签只在参数完整后接受草稿。
- `/api/text` 增加可选的流式模式（SSE）；不选流式时保持现有整段 JSON 行为，所有一次性 JSON 生成面不受影响。
- 明确忽略 reasoning/thinking 增量，不进入事件流、不进入聊天。
- 修复重试时丢弃上一步已流出的半截文本（reset-step 语义）；取消走 transport abort，并保留本地 cancelled 事件。
- 明确不采纳 `StateSnapshot/StateDelta`：工作台状态留在 React，领域负载用 `custom` 表达。
- 不新增依赖；SSE 解析、增量解码和 UI 节流都自己实现。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-agent-chat-ui`: 聊天在模型生成期间显示增量进度或文本；重试/取消时清理半截内容；不展示 reasoning 与原始 JSON 片段。
- `scene-agent-runtime`: 运行事件新增 run/step/text/tool 四组生命周期与增量字段；工具参数完整前不可执行；取消终止未完成的流。

## Impact

- 代码：`src/agent/sceneAgentTypes.ts`（事件与部件类型）、`sceneAgentEvents.ts`（映射与去重）、`sceneAgentGraph.ts`（节点改为流式聚合）、`SceneAgentChat.tsx`（事件消费与消息更新）、`zcodeChatModel.ts`（流式分块接口）、`src/chat-ui/`（进度/文本渲染）、`vite.config.ts`（`/api/text` 流式分支）。
- 协议：`/api/text` 新增 opt-in 流式；非流式请求与响应结构保持不变。
- 测试：`verify-agent-*.mjs` 里的 `/api/text` mock 需要支持流式；Playwright 无法分块，需要本地 SSE 测试服务或解析器单测。
- 数据：不涉及项目结构、SQLite 字段或渲染指纹。
- 依赖：不新增 npm 包；不迁移到 AI SDK 或 AG-UI SDK。
