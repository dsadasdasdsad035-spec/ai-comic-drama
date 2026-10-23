# Proposal

## Why

3D agent 目前把 LangGraph 图节点数（`state.steps`）作为用户可配置的“最大执行步数”。这个计数约 3 个节点才对应一轮模型/工具循环，既不是工具调用次数，也不是重试次数；真实模型很容易在多轮修复中被 24 步提前截断。用户需要的是不因总步数中止，而不是继续暴露内部图计数。

总运行时长和用户取消仍然保留：没有时间边界时，模型持续循环会无限消耗模型调用和沙箱资源。

## What Changes

- 删除设置页的“最大执行步数”配置和 `agentLimits.maxSteps` 数据；旧的 `maxSteps` 字段读取时忽略，不再显示。
- 删除 `gate`/路由中的 `state.steps >= maxSteps` 终止条件，不再出现“agent 步骤达到上限”。
- 保留可配置的总运行时长（默认 300 秒，范围 60–1800）；超时仍显示“运行超时”，用户取消仍显示“已取消”。
- LangGraph 仍使用一个**不可配置的内部递归安全阀**（取值足够高，正常流程由总时长先结束）；它不是用户设置，也不作为产品步骤上限展示。
- 保留代码修复 3 次、视觉验收 2 次的预算；它们不是总图节点数。
- 更新设置页、运行时、图测试、README 和聊天错误文案。

## Capabilities

### New Capabilities

- `agent-run-settings`: 只定义 Agent 总运行时长的设置、默认值、范围校验和持久化；明确不提供步骤上限配置。

### Modified Capabilities

- `scene-agent-runtime`: “修复与验收循环必须有上限”改为不再使用图步骤上限，仅保留修复/验收预算、总时长和取消。

## Impact

- 设置：`src/api.ts`、`vite.config.ts`、`src/Settings.tsx`；移除 `maxSteps`，保留 `totalSeconds`。
- Agent：`src/agent/agentLimits.ts`、`src/agent/sceneAgentGraph.ts`、`src/SceneCodeWorkbench`/聊天错误文案。
- 测试：`verify-agent-graph.mjs`、`verify-agent-limits.mjs`、`verify-agent-limits-api.mjs`、聊天 UI/失败取消。
- 不新增数据库表；旧设置中的 `maxSteps` 作为未知字段保留但不读取，不改变模型、项目或沙箱 ABI。
