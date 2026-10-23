# Tasks

## 1. Agent 运行上限设置

- [x] 1.1 在客户端设置类型中加入可选 `agentLimits`（`maxSteps`、`totalSeconds`），实现默认值 24/300 和 12–120、60–1800 的整数规范化；验证：`npx tsc --noEmit` 通过，边界单测覆盖空值、越界和非数字。
- [x] 1.2 在服务端 `AppSettings`、`normalizeSettings`、`saveAppSettings` 中加入同样的字段和夹取逻辑，旧设置缺字段时补默认值；验证：设置读写 round-trip 测试保留模型/渠道/规则，且新字段可保存。
- [x] 1.3 在设置页新增“Agent 运行上限”区：最大执行步数和总运行时长（秒），复用现有保存按钮和 `.st-grid` 布局；验证：设置页能回显、修改、保存并重新加载生效。
- [x] 1.4 新增/扩展设置验收脚本，覆盖默认值、越界夹取、非数字回退、旧设置兼容和“不影响其他设置”；验证：Playwright 脚本全部通过。

## 2. 运行时接入与超时语义

- [x] 2.1 `runSceneAgent` 从 settings 解析本次运行上限，gate、路由和 `recursionLimit` 使用同一个 `maxSteps`；步骤上限错误包含当前值并提示设置页；验证：图测试用自定义步数触发并断言错误文案。
- [x] 2.2 总超时使用配置的 `totalSeconds`，timer 触发时记录 `timedOut`，与外部取消分开；验证：短超时测试返回“运行超时”，不是 `cancelled`。
- [x] 2.3 保持旧代码/视频不变：超时、步骤上限和用户取消都不写入半成品；验证：mock 图测试断言无新草稿、取消仍返回 cancelled。
- [x] 2.4 更新 README 的 agent 上限说明：默认 24 步/300 秒、图步数约 3 步/轮、可配置范围、超时与取消区别；验证：文档描述与设置项、错误文案一致。
- [x] 2.5 聊天 UI 显示步骤上限/超时错误并保留可重试输入；验证：Playwright 或图事件测试覆盖超时文案和输入可用。

## 3. 集成

- [x] 3.1 运行 `npm run build`、`npx tsc --noEmit`，确认主应用和 agent chunk 构建通过。
- [x] 3.2 运行设置验收、`verify-agent-graph.mjs`、`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`，确认新上限与旧聊天行为都通过。
- [x] 3.3 回归 `verify-code-workbench.mjs`、`verify-code-sandbox.mjs`、`verify-theme.mjs`，确认设置页改动不影响工作台、沙箱和主题。

## Workflow follow-up

- 归档前同步 `agent-run-settings` 新主 spec 和 `scene-agent-runtime` 修改，并确认所有任务完成。
