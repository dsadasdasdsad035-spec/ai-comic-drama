# Design

## Context

见 [proposal.md](proposal.md)。浏览器复现：工作台已有代码 `159e724f67`，但每次 `runSceneAgent` 新建 `SceneAgentSession` 时 `code` 为空；model 直接调用 `run_sandbox`，触发 [sceneAgentTools.ts](../../../src/agent/sceneAgentTools.ts) 的“还没有提交代码”守卫。现有工具白名单固定为 6 个，本次不增加新工具。

## Goals / Non-Goals

**Goals:**

- 当前工作台镜头的有效代码成为本轮 agent 的初始运行基线。
- 已有代码时 `run_sandbox` 可直接运行，不必先 `set_scene_code`。
- 空镜头/无效代码仍拒绝运行，不伪造成功。
- 修改场景仍必须 `set_scene_code`。
- 后续每条消息都使用当前工作台最新有效代码。
- 覆盖图测试、聊天 UI 测试和浏览器真实场景。

**Non-Goals:**

- 不增加“读取完整当前代码”的工具；agent 目前仍无法逐行读取旧代码再修改，只能生成/提交新代码。
- 不改变工具白名单、沙箱 ABI、项目数据或 step/time 上限。
- 不把 agent session 跨消息持久化；每条消息仍启动新运行，但会重新注入当前代码。

## Decisions

### 1. 工作台通过 prop 传递当前 draftCode

`SceneCodeWorkbench` 已有 `draftCode`，新增传给 `SceneAgentChat` 的 `currentCode` prop。`SceneAgentChat` 在每次 `runSceneAgent` 调用时把该值作为 `initialCode`。不读取 localStorage，也不跨镜头读取；值只来自当前打开的工作台。

### 2. 运行时校验后 seed session，而不是直接信任 UI

`runSceneAgent` 接收可选 `initialCode`，用现有 `checkSceneCode` 做静态检查；只有通过检查的代码才写入 `session.code`，并计算 `codeHash`。无效/空代码不 seed。

`session.codeOrigin` 标记为 `baseline` 或 `agent`：

- baseline：来自工作台，`run_sandbox` 通过后不重复调用 `onDraftCode`（避免同一代码重复写入撤销历史）。
- agent：由 `set_scene_code` 提交，成功沙箱后照旧交给工作台草稿。

### 3. 运行工具语义不变

`run_sandbox` 仍只检查 `session.code`；有 baseline 时可运行，没有时仍返回“还没有提交代码”。`capture_frames`、`review_frames`、`finish` 的既有前置条件不变。这样空镜头行为保持诚实。

### 4. system prompt 明确两条路径

增加一句：

- 当前镜头已有有效代码且用户只要求运行/验收时，可直接 `run_sandbox`；
- 用户要求改变画面或场景时，先 `set_scene_code` 提交新代码，再运行。

不改变工具顺序约束本身；模型仍对工具调用负责。

### 5. 后续消息重新注入当前草稿

每次 run 都从 `SceneCodeWorkbench` 的 `draftCode` 取最新值；用户在一次运行后继续“再运行一次”时，新 session 会再次 seed。若用户改了代码但未保存，使用当前 draft（通过检查即可）。

## Risks / Trade-offs

- [draftCode 无效但旧代码有效] → 不 seed 无效 draft，agent 必须先提交有效代码；不会静默使用旧代码。
- [baseline 运行成功后重复写入工作台历史] → 用 `codeOrigin` 跳过 baseline 的 `onDraftCode`。
- [用户改代码后运行旧草稿] → 每次从当前 `draftCode` 取值，不缓存上一次 session。
- [工具白名单保持不变] → 不新增 `get_current_code`；修改旧代码的能力仍受限，作为后续独立变更。
- [activity 与 `configurable-agent-limits` 同时修改 runtime spec] → 新 requirement 只增加“当前代码基线”，不碰上限要求；归档前先处理该活动变更。

## Migration Plan

1. Workbench → SceneAgentChat → runSceneAgent 传 `currentCode`。
2. runSceneAgent 校验/seed session，并给 session 标记 baseline。
3. 更新 system prompt 和 `run_sandbox` 的 onDraftCode 条件。
4. 加图测试：baseline 直接 run、空/无效代码拒绝、后续消息；加聊天 UI 和浏览器真实场景验收。
5. 更新 README；回滚时删除 prop/seed 逻辑，现有空 session 行为恢复。
