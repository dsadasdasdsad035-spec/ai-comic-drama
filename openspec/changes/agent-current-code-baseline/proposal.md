# Proposal

## Why

浏览器真实复现：当前镜头已有可运行代码（工作台 hash `159e724f67`），用户说“运行一下当前场景”，agent 第 2 轮直接调用 `run_sandbox`，返回“还没有提交代码；先调用 set_scene_code”。原因是每次 agent 运行都会新建空 session，当前工作台代码只以 hash 出现在上下文里，agent 无法直接运行它。

## What Changes

- 工作台把当前镜头的 `draftCode` 传给聊天/agent；运行时在校验通过后把它作为本次运行的初始可运行代码。
- 已有有效代码时，`run_sandbox` 可以直接运行，不必先调用 `set_scene_code`。
- 空镜头或代码校验失败时，`run_sandbox` 仍返回“先提交代码”，不伪造成功。
- 需要修改场景时仍必须调用 `set_scene_code`；本次不新增“读取完整当前代码”的工具，也不改变工具白名单。
- 更新 system prompt，说明“当前已有代码可直接运行；要改代码才先 set_scene_code”。
- 增加图测试、聊天 UI 测试和浏览器真实场景验收，覆盖已有代码直接运行和空镜头仍拒绝两条路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `scene-agent-runtime`: 新增“当前镜头已有有效代码必须可作为本次运行的基线”要求，明确空镜头/无效代码的拒绝行为。

## Impact

- 前端：`SceneCodeWorkbench` 传递当前代码；`SceneAgentChat` 接收并传给 `runSceneAgent`。
- 运行时：`RunSceneAgentInput`/`SceneAgentSession` 接受初始代码，`run_sandbox` 可运行该基线；不改变现有工具白名单。
- 测试：`verify-agent-graph.mjs`、`verify-agent-chat-ui.mjs`、浏览器真实场景；README 说明当前代码基线。
- 不新增依赖、API 或数据库字段；不改变沙箱 ABI、项目数据或其他镜头。
- 归档前需先处理仍在进行中的 `configurable-agent-limits`（它修改同一 runtime spec，但作用于不同的上限要求）。
