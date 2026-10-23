# Proposal

## Why

聊天面板在“聊天 / 代码”页签之间切换时会被条件渲染卸载，局部消息、工具卡、滚动位置全部丢失；如果 agent 正在运行，组件卸载还会中止请求并释放沙箱。用户想边看代码边让 agent 继续工作，目前做不到。

同时，聊天只显示工具卡，模型每一轮的调用和简短说明没有进入 UI；运行时使用 `graph.invoke()`，现有的 LangGraph 事件映射没有接入。用户无法看到完整的可观察执行轨迹，只能看到最终摘要。

## What Changes

- 聊天和代码面板在打开的工作台内保持挂载，只用可见性切换；页签切换不得清空消息、帧、清单、滚动位置，也不得取消正在运行的 agent。
- 用 LangGraph `graph.streamEvents()`（v2）驱动 agent 执行事件，替代当前只靠 `toolsNode` 手动发工具事件的模式。
- 事件桥展示模型轮次开始/结束、模型的简短说明、工具开始/结束、代码/抓帧/视觉验收、结束和错误；事件按调用 id 去重，不产生孤立卡片。
- 不展示 chain-of-thought、系统提示或 reasoning token；只展示可观察动作和模型面向用户的简短说明。工具参数中的完整代码/图片数据只保留摘要。
- 保留现有取消行为：用户主动取消会中止运行并释放沙箱；关闭工作台仍会结束当前会话。跨关闭、刷新或项目切换的聊天持久化不在本次范围内。
- 增加 chat 页签切换、运行中切换、模型轮次事件顺序、去重和隐藏推理过滤的自动化测试。

## Capabilities

### New Capabilities

无。本次只修改已有 agent 运行和聊天 UI 的行为。

### Modified Capabilities

- `scene-agent-runtime`: 运行轨迹从手动工具事件改为 LangGraph `streamEvents` 事件源，增加模型轮次事件、去重、参数摘要和隐藏推理过滤。
- `scene-agent-chat-ui`: 聊天会话在聊天/代码页签切换时保持挂载并继续运行，同时显示模型轮次和完整可观察执行轨迹。

## Impact

- 主要代码：`src/SceneCodeWorkbench.tsx`、`src/agent/SceneAgentChat.tsx`、`src/agent/sceneAgentGraph.ts`、`src/agent/sceneAgentEvents.ts`、`src/agent/sceneAgentTypes.ts`。
- 测试：`verify-agent-graph.mjs`、`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`，以及必要的页签切换/事件顺序用例。
- 不改变 `/api/text`、模型渠道、项目数据结构或沙箱 ABI；不增加对 API Key 的访问。
- `streamEvents` 只提供每轮模型结束事件，不保证 token 级实时输出；token 流式渲染不在本次范围。
