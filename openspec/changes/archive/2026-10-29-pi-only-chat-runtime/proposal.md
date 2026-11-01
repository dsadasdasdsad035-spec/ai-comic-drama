# Proposal

## Why

应用里的聊天运行时有两套并存的循环：3D 调度已经能在 LangGraph 与 pi 之间切换，而五个工作台、发布助手和创意会话仍直接依赖 LangGraph 的 `StateGraph` 与两个自写的 `BaseChatModel`。同一份工具语义被两套循环、两种工具外壳（`DynamicStructuredTool` 与 pi 的 `AgentTool`）、两份历史压缩实现分别承载，`pi/tools.ts` 里还手工复刻了 12 份 TypeBox schema，与 zod 定义必然 drift。聊天功能只需要一个循环和一个协议，框架本身不提供产品价值。

## What Changes

- **BREAKING** 删除 LangGraph 与 LangChain：移除 `@langchain/langgraph`、`@langchain/core` 依赖，删除 `StateGraph` 实现、两个 `BaseChatModel` 适配器、`actionJson` 解析器和 LangGraph 事件桥。
- **BREAKING** 删除 JSON action 协议：聊天只使用渠道原生 `tool_calls`。模型返回文本 JSON 不再被解析成工具调用，也不再作为回退路径保留。
- **BREAKING** 聊天模型必须声明支持原生工具调用：运行前按能力表校验，未声明的模型直接给出可读错误，不再自动回退到 JSON 路径。
- 全部 8 个聊天界面（3D 调度、剧本/角色/素材/分镜/提示词五个工作台、发布助手、创意会话）改由同一个 pi 循环驱动，共用现有工具实现、草稿协议、门禁与事件形状。
- 47 个工具从 `DynamicStructuredTool` 迁移到 pi 的 `AgentTool` 外壳，函数体与 `submit_*` 草稿语义不变；参数 schema 直接由现有 zod 定义转成 JSON Schema，删除 `pi/tools.ts` 的手写 TypeBox 副本。
- 原生工具能力表从 4 条扩到 8 条（ark-plan 全通道），并把匹配键从「渠道 + 模型」放宽为「模型」，使同一模型换渠道后能力判定不变。
- 收紧 6 个输出契约的 `required` 列表：原生工具模式下 schema 是模型看到的第一手约束，宽松 schema 会让模型产出「通过校验但内容为空」的草稿。
- 删除 `agentEngine` 设置项与「执行引擎」下拉；`agentToolProtocol` 收敛为能力判定的结果，不再作为用户可选的协议开关。
- 技能 frontmatter 的 `runtime: json-tools` 字面量改为与协议无关的取值。
- 合并 `agentHistory.compactDraftHistory` 与 `pi/compact.ts` 两份等价的历史压缩实现。

## Capabilities

### New Capabilities

- `chat-agent-runtime`: 应用内所有聊天共用的执行循环——单一引擎、只走原生工具调用、模型能力前提、工具声明与结果的分离约定、运行上限与取消、引擎事件到聊天事件的映射。

### Modified Capabilities

- `scene-agent-runtime`: 3D 聊天的循环描述不再绑定具体图实现；mock 验收对象从「agent 图」改为引擎无关的运行器；新增单引擎前提。

## Impact

- 代码删除：`src/agent/sceneAgentGraphLangGraph.ts`、`src/agent/stageAgentGraph.ts`（原地重写）、`src/agent/zcodeChatModel.ts`、`src/agent/nativeToolChatModel.ts`、`src/agent/actionJson.ts`、`src/agent/agentHistory.ts`、`src/agent/sceneAgentEngine.ts`、`src/agent/sceneAgentEvents.ts` 的 LangGraph 映射部分。
- 代码重写：`src/agent/sceneAgentGraph.ts`（门面直连 pi）、新增 `src/agent/pi/stageRunner.ts` 与 `src/agent/pi/toolAdapter.ts`、四个工具工厂（`sceneAgentTools`、`stageTools`、`creative/tools`、`publish/publishTools`）。
- 设置：`agentEngine` 从 `AppSettings`、服务端归一化、设置页与 `SceneAgentResult` 中移除；存量 `"langgraph"` 值必须容错归一化。
- 契约：`src/skills/contracts.ts` 六个契约收紧 `required`。
- 依赖：移除 `@langchain/core`、`@langchain/langgraph`；`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 已是现有依赖。
- 测试：删除 `verify-agent-graph.mjs` 与 `verify-pi-alignment.mjs`；重写 `verify-pi-agent.mjs`、`tests/stage-agent.ts`、`tests/chat-model.ts`、`verify-native-tool-protocol.mjs` 的 mock 形状；多个浏览器验收脚本的 mock 需从 JSON action 改为 `tool_calls`。
- 规格顺序约束：`openspec/changes/scene-agent-pi-engine/` 已完成但未归档，其 delta 新增的「聊天引擎可切换且可回退」等需求与本变更冲突；本变更合入前必须先处理该变更的归档去向。
