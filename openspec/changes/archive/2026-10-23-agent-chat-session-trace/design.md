# Design

## Context

`SceneCodeWorkbench` 目前用 `sideTab === 'chat'` 条件渲染聊天面板。`SceneAgentChat` 自己持有 messages、运行状态、取消控制器和沙箱会话，所以切到代码页签会卸载组件并触发 cleanup abort。见 [proposal.md](proposal.md) 的问题描述。

agent 运行时目前调用 `graph.invoke()`；`sceneAgentEvents.ts` 的 LangGraph 事件映射没有接入，模型每轮的 `AIMessage.content` 被丢弃，聊天只剩工具卡和最终摘要。用户已选择用 `graph.streamEvents` 作为事件来源。

## Goals / Non-Goals

**Goals:**

- 打开工作台期间，聊天会话在聊天/代码页签之间切换时完整保留，运行中的 agent 不因切换被取消。
- 聊天展示模型轮次与可观察执行轨迹：模型开始/结束、简短说明、工具开始/结束、代码/帧/验收、结束和错误。
- 事件有稳定标识，工具生命周期和领域结果不会生成重复卡片。
- 不展示 chain-of-thought、系统提示或 reasoning token；模型简短说明和工具参数都做安全裁剪。

**Non-Goals:**

- 不把聊天记录持久化到关闭工作台、刷新页面或切换项目之后。
- 不做 token 级实时打字；本次只消费 `on_chat_model_start/end`，不要求 provider 流式 token。
- 不改变 agent 工具集、沙箱 ABI、`/api/text` 协议或模型渠道。
- 不展示模型原始 reasoning；只展示 provider 返回的面向用户 content。

## Decisions

### 1. 保持两个页签挂载，只切换可见性

`SceneCodeWorkbench` 同时渲染聊天和代码两个 pane，用可见性 class / `hidden` 控制显示，而不是条件渲染。聊天组件保持同一实例，`messages`、`running`、`abortRef`、沙箱会话和 DOM 滚动位置都不丢。关闭工作台时父组件卸载聊天，现有 cleanup 继续负责 abort 和 dispose。

备选方案是把 messages/running 提升到工作台：能支持关闭再打开，但需要重写 assistant-ui runtime 的所有权，超出本次“页签切换”范围。另一个方案是持久化到 IndexedDB：帧是 data URL，体积和生命周期都不合适。

### 2. 用 `graph.streamEvents` v2 作为生命周期事件来源

`runSceneAgent` 从 `graph.invoke()` 改为消费 `graph.streamEvents(input, { version: 'v2', recursionLimit, signal })`。v2 保留现有 `StreamEvent` 形状；不使用 v3 的新协议，避免同时改事件契约。

实现时确认：浏览器内的 LangGraph 会稳定发出 `on_chain_start/end`（节点名 `agent`）和 `on_tool_*`，但不保证发出 `on_chat_model_*`。因此模型轮次以 `agent` 节点的链事件为准，`on_chain_end` 的 `data.output.messages` 提供本轮 AIMessage；chat model 事件忽略，避免同一轮重复。工具节点需要把 LangGraph 注入的 `config` 传给 `tool.invoke(args, config)`，否则工具回调不会进入 streamEvents。工具执行期间已有的领域事件（`code`、`frames`、`review`、`done`）不是 runnable 生命周期，继续通过 `deps.onEvent` 发送。

### 3. 事件桥统一编号、去重和裁剪

新增一个有状态的 event bridge（替代目前未接入的纯 `mapLangGraphEvent`）：

- `on_chain_start` 且节点名为 `agent` 时分配递增轮次 `turn`，发 `agent_step` start。
- `on_chain_end` 且节点名为 `agent` 时找到同一 run 的轮次，发 `agent_step` end，并从 `data.output.messages` 的最后一条 AIMessage content 提取简短说明。
- `on_chat_model_*` 不参与映射，避免与 agent 节点轮次重复。
- `on_tool_start/end/error` 发 `tool_start/tool_end`，以 `run_id` 作为稳定标识；`on_tool_end` 的输出若是 `{ok:false}`，按错误处理。
- `on_chain_error` 发 terminal error，并用 run id/错误文本去重，避免和最终 catch 重复。
- 不在 `toolsNode` 再手动发 tool_start/tool_end；保留领域事件，事件桥只负责生命周期。

模型说明只取 content；不读取 `reasoning_content`、`additional_kwargs` 中的推理字段、系统消息或 stream chunk 中的 reasoning。说明截断到短文本；工具参数去掉完整 `code`、base64/data URL，只保留行数、hash 和摘要。

### 4. UI 增加轻量模型轮次 part

`AgentMessagePart` 增加 `step` part，包含 `turn`、phase、可选说明和状态。`SceneAgentChat` 把它转换为普通文本（例如“第 2 轮 · 模型说明：…”或“第 2 轮 · 模型调用完成”），同一轮 start/end 更新同一个 part，不新增重复气泡。工具卡继续由 `makeAssistantToolUI` 渲染；最终摘要仍由 `done` 事件追加。

这样不需要给 assistant-ui 注册一个伪工具，也不会把模型说明塞进工具卡。没有 content 的轮次仍显示“模型调用完成”，避免用户只看到工具动作。

### 5. 取消、超时和关闭保持现有语义

`streamEvents` 的 `signal` 绑定现有 AbortController；用户取消、总超时和工作台关闭仍会中止流、释放沙箱。页签切换不触发 abort，因为聊天组件不再卸载。取消后保留已有事件和模型轮次，状态显示为已取消。

## Risks / Trade-offs

- [工具回调没有进入 streamEvents] → 工具节点显式传 `config`，并用 mock 图测试断言 `on_tool_start/end` 出现；若 provider 版本行为不同，保留领域事件作为工具结果兜底，但不得重复生成卡片。
- [模型把推理写进 content] → 只显示 provider 的 content，不读取 reasoning 元数据；提示词继续要求简短说明，渲染端限制长度和行数。无法保证所有第三方模型完全遵守。
- [隐藏面板的滚动位置被浏览器重置] → 用保持挂载的 pane 保留 DOM；UI 测试覆盖切换后滚动位置，若平台行为不一致则在 pane 切换时显式保存/恢复 `scrollTop`。
- [streamEvents 只到模型结束，不是 token 流] → 明确记录为非目标；用户仍能看到每轮开始、结束和说明，只是没有逐字打字效果。
- [事件重复或顺序错乱] → 事件桥按 run id/轮次去重，测试断言模型轮次和工具卡顺序；领域事件只更新结果，不创建新的工具卡。

## Migration Plan

1. 先改工作台 pane 结构和聊天状态生命周期，跑现有聊天 UI/失败取消回归。
2. 接入 `streamEvents` 和 event bridge，保留领域事件；补图测试验证事件顺序和去重。
3. 加模型轮次 part 和 UI 样式，更新聊天验收脚本。
4. 最后跑构建、旧工作台/沙箱/主题回归。

不需要数据迁移；没有新增环境变量或依赖。回滚时恢复条件渲染和 `graph.invoke` 即可，已产生的聊天数据只在内存中。
