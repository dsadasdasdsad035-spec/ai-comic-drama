# Tasks

## 1. 当前代码基线

- [x] 1.1 `SceneCodeWorkbench` 把当前 `draftCode` 传给 `SceneAgentChat`，`SceneAgentChat` 在每次运行时传给 `runSceneAgent`；验证：`npx tsc --noEmit` 通过。
- [x] 1.2 `runSceneAgent` 接收 `initialCode`，用现有 `checkSceneCode` 校验后 seed `session.code/codeHash`；无效/空代码不 seed；验证：图测试断言 seed 成功和拒绝两条路径。
- [x] 1.3 session 标记 `baseline` 来源，`run_sandbox` 对 baseline 成功运行不重复调用 `onDraftCode`；`set_scene_code` 仍标记 agent 来源；验证：图测试断言 baseline 不重复写草稿。
- [x] 1.4 system prompt 明确“已有代码可直接 run_sandbox；要改画面先 set_scene_code”；验证：图测试的 run-first 脚本不出现“还没有提交代码”。
- [x] 1.5 更新 `verify-agent-graph.mjs`：覆盖已有代码直接 run、空镜头拒绝、无效代码拒绝、后续运行复用当前代码；验证：脚本全部通过。
- [x] 1.6 更新 `verify-agent-chat-ui.mjs` 或新增浏览器脚本：当前代码 + “运行当前场景”时第 1 个工具可直接 run_sandbox 并继续抓帧；验证：Playwright 通过。
- [x] 1.7 在浏览器用真实模型重跑“运行当前场景，不要重新生成代码”，确认不再出现该错误并保存截图/结果；验证：真实场景通过或明确记录失败原因。
- [x] 1.8 更新 README：说明当前工作台代码是 agent 初始基线、空镜头仍需 set_scene_code；验证：文档与行为一致。

## 2. 集成

- [x] 2.1 运行 `npm run build`、`npx tsc --noEmit`，确认主应用和 agent chunk 构建通过。
- [x] 2.2 运行 `verify-agent-graph.mjs`、`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`，确认基线逻辑不破坏失败/取消；验证：脚本全部通过。
- [x] 2.3 回归 `verify-code-workbench.mjs`、`verify-code-sandbox.mjs`、`verify-theme.mjs`，确认工作台和沙箱无回归；验证：脚本全部通过。

## Workflow follow-up

- 归档前先处理/归档 `configurable-agent-limits`，再同步 `scene-agent-runtime` 的新增 requirement。
