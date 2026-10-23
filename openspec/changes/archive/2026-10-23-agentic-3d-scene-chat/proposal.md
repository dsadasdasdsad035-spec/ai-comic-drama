# Proposal

## Why

当前 3D 聊天是一次性代码生成加一次文本修复，模型看不到沙箱错误以外的执行结果，也不能抓帧自检；聊天窗口只渲染纯文本，用户看不到工具执行、代码试运行、关键帧和验收过程。用 LangGraph 编排多步工具循环、用 assistant-ui 渲染结构化工具事件，才能把“模型执行了什么、失败在哪、是否真的生成了目标场景”直接展示在 3D 调度里。

## What Changes

- 在浏览器内运行 LangGraph StateGraph（懒加载），编排 `读取上下文 → 生成代码 → 沙箱运行 → 抓帧 → 视觉验收 → 修复`；最多 3 轮生成/修复、2 轮视觉验收，支持取消和超时。
- 新增 `ZCodeChatModel` 适配器，把 LangGraph 的 model/tool 协议接到现有 `/api/text` JSON 模式；API Key 仍只在服务端，不把模型 Key 发到浏览器。
- 新增受控工具集：`get_shot_context`、`set_scene_code`、`run_sandbox`、`capture_frames`、`review_frames`、`finish`。工具只能通过现有沙箱、视觉能力和镜头状态工作，不提供任意 shell、网络或文件写入。
- 用 assistant-ui `ExternalStoreRuntime` 重做聊天渲染：文本、tool-call/tool-result、代码摘要、关键帧缩略图和验收清单分别渲染；不展示隐藏 chain-of-thought。
- 聊天显示可审计执行轨迹：工具名称、参数摘要、running/done/error、沙箱错误、修复次数、帧和验收结果；代码只进草稿/代码页签。
- 保持现有安全门禁：代码试运行成功才进入草稿；失败保留旧代码；保存和渲染仍由用户显式触发；agent 不自动保存、不自动出片。
- 增加验收场景：山顶/山谷背景，一名男人和一名女人持剑对打，镜头从远处环绕飞行并始终正对两人；验收代码、5 张关键帧、4 秒 mp4 和清单。
- 新增 mock LangGraph 图测试（不消耗真实模型）和真实模型验收脚本；测试必须验证聊天工具卡片、状态、帧/清单渲染以及场景内容。

## Capabilities

### New Capabilities

- `scene-agent-runtime`: 浏览器内 LangGraph 场景 agent、模型适配、工具集、修复/验收循环、取消限额和“山/男女/双剑/环绕”验收场景。
- `scene-agent-chat-ui`: assistant-ui ExternalStoreRuntime 的聊天渲染、tool-call/tool-result 卡片、代码/帧/验收清单展示，以及与工作台状态的安全联动。

### Modified Capabilities

无。现有代码优先 3D 工作台还没有归档到主 spec；本变更依赖 `code-first-3d-chat` 的代码与规格，实施前应先完成/归档该变更，避免重复或冲突的聊天要求。

## Impact

- 代码：新增 `src/agent/`（LangGraph 图、`ZCodeChatModel`、工具、事件桥）；重写 `SceneCodeWorkbench` 聊天页签为 assistant-ui；复用 `SceneSandbox`、`sceneCodeJob`/`sceneCodePrompt`、`askVision`、代码准入和持久化。
- 依赖：新增 `@langchain/core`、`@langchain/langgraph`、`@assistant-ui/react`、`zod`；不使用要求 LangGraph Server 的 `@assistant-ui/react-langgraph`；agent 面板懒加载。
- API：继续使用 `/api/text`、`/api/vision`；如需要模型流式输出，后续单独加 SSE，本期工具步骤级更新即可。
- 数据：agent 会话和工具轨迹只保存在编辑器会话内，除非用户保存代码；不新增项目字段。最终代码仍写入 `sceneCode`，渲染仍写 `scheduleVideo`/`sceneCodeMeta`。
- 安全：工具参数和代码仍走现有沙箱/CSP/超时/大小上限；agent 不得自动保存、渲染、修改其他镜头或访问网络。
- 测试：新增 `verify-agent-3d-duel.mjs`（mock 图 + 真实模型模式）、assistant-ui 工具卡片渲染、取消/超时/修复上限、场景验收清单和回归。
- 文档：README 增加 LangGraph + assistant-ui 架构、工具列表、模型前置、验收场景和 mock/真实测试说明。
