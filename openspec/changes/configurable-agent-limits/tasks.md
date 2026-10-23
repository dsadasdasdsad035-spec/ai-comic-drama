# Tasks

## 1. 移除步骤上限设置

- [x] 1.1 客户端 `agentLimits` 只保留 `totalSeconds`，移除 `maxSteps` 的类型、默认值、范围和 normalize；验证：`npx tsc --noEmit` 通过。
- [x] 1.2 服务端设置 normalizer/save 不再读取或写回 `maxSteps`，旧字段被忽略但其他设置保留；验证：服务端 round-trip 测试覆盖旧 `maxSteps` 和默认/夹取。
- [x] 1.3 设置页删除“最大执行步数”字段和说明，只保留总运行时长；验证：设置页回显、保存 600 秒后重新加载生效。
- [x] 1.4 更新 `verify-agent-limits.mjs` / `verify-agent-limits-api.mjs`：不再断言 maxSteps，覆盖旧字段忽略、总时长默认/夹取/保存；验证：脚本全部通过。

## 2. 运行时不再按图节点数终止

- [x] 2.1 删除 gate 和路由中的 `state.steps >= maxSteps`，删除 `recursionLimit` 随 maxSteps 推导；固定内部递归安全阀；验证：长序列 mock 不再出现“步骤达到上限”。
- [x] 2.2 保留总运行时长 timer 与 `timedOut`，与用户取消分开；验证：短超时返回“运行超时”，不是 `cancelled`。
- [x] 2.3 更新图测试：长工具序列继续执行到 timeout/cancel，步骤不再提前截断；超时/取消不产生新草稿；验证：`verify-agent-graph.mjs` 全部通过。
- [x] 2.4 更新聊天失败/取消测试：超时文案和输入恢复仍正确，不再有步骤上限提示；验证：`verify-agent-chat-failure.mjs` 通过。
- [x] 2.5 更新 README：不再提可配置步骤上限，明确只可配置总时长，内部 recursion safety 不暴露；验证：文档与设置/错误文案一致。

## 3. 集成

- [x] 3.1 运行 `npm run build`、`npx tsc --noEmit`，确认主应用和 agent chunk 构建通过。
- [x] 3.2 运行 `verify-agent-graph.mjs`、`verify-agent-limits.mjs`、`verify-agent-limits-api.mjs`、`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`，确认新行为全部通过。
- [x] 3.3 回归 `verify-code-workbench.mjs`、`verify-code-sandbox.mjs`、`verify-theme.mjs`，确认设置页/运行时改动无回归。

## Workflow follow-up

- 归档前同步 `agent-run-settings` 与 `scene-agent-runtime`，并确认 `maxSteps` 已从设置和代码路径移除。
