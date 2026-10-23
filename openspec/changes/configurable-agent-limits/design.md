# Design

## Context

见 [proposal.md](proposal.md)。当前 `configurable-agent-limits` 已经实现 `maxSteps` 设置和 gate 终止，但该值实际是 LangGraph 图节点计数，用户无法把它理解为工具调用或重试次数。总运行时长和用户取消仍需要保留。

## Goals / Non-Goals

**Goals:**

- 删除用户可见的步骤上限和 `agentLimits.maxSteps` 数据。
- 保留可配置的总运行时长，默认 300 秒、范围 60–1800。
- 总超时显示“运行超时”，用户取消显示“已取消”。
- 用一个不可配置、取值较高的 LangGraph `recursionLimit` 作为框架安全阀，不把它包装成产品步骤上限。
- 保持代码修复/验收预算和现有工具行为不变。

**Non-Goals:**

- 不增加迭代/循环检测算法（本次先移除错误的步数设置，运行仍由总时长和取消约束）。
- 不开放代码修复、验收、单工具或抓帧上限。
- 不改变 agent 工具、聊天 UI 或项目数据。
- 不把 `recursionLimit` 作为设置项或错误提示暴露给用户。

## Decisions

### 1. 设置只保留总运行时长

`AppSettings.agentLimits` 收敛为：

```ts
agentLimits?: {
  totalSeconds?: number
}
```

默认 300 秒，范围 60–1800。旧 JSON 中已有的 `maxSteps` 字段保留但不读取、不显示；保存时不再写回该字段。设置页删除最大执行步数输入和说明。

### 2. 不再按图节点数终止

删除 `gate` 中的 `state.steps >= limits.maxSteps` 终止、`routeAfterGate` 的同条件，以及 `recursionLimit` 随 `maxSteps` 推导的逻辑。模型可以连续进行工具调用，直到：

- 总运行时长到期；
- 用户取消；
- 代码修复/视觉验收预算耗尽；
- LangGraph 内部递归安全阀触发。

### 3. LangGraph 内部安全阀固定且不暴露

LangGraph 必须有一个有限 `recursionLimit`；将其固定为 512（或一个足够高但有限的常量），只作为框架级异常保护，不作为设置项和正常流程的步骤预算。正常 5 分钟运行应由总时长先结束；若内部安全阀先触发，错误应显示为内部安全限制，而不是“agent 步骤达到上限”。

### 4. 总超时和取消分流

保留当前 timer 与 `timedOut` 标记：

```text
timer fires -> timedOut = true -> abort
external signal/user cancel -> timedOut = false -> abort
```

- `timedOut`：`error = "运行超时（N 秒）；可在设置页调整"`，不标记 cancelled。
- 用户取消：保持 cancelled。
- 两者都不写入半成品，旧代码不变。

### 5. 其他预算保持常量

`maxCodeAttempts=3`、`maxReviewAttempts=2`、`toolMs=30s`、`maxFrames=5` 继续使用 `DEFAULT_AGENT_LIMITS`；它们是修复/验收/单工具预算，不是总图步骤。

## Risks / Trade-offs

- [没有步骤上限后模型持续循环] → 总运行时长仍是硬边界，用户可随时取消；本次不扩大为自动进展检测。
- [内部 recursionLimit 先于总时长触发] → 使用足够高的固定常量和明确的内部错误文案；不把它当作正常产品限制。
- [旧设置仍带 `maxSteps`] → 读取时忽略，保存时不写回；不迁移、不破坏其他设置。
- [用户误以为总时长也是“调用次数”] → 设置标签只写“总运行时长（秒）”，不显示步骤/轮次。
- [代码修复预算与总时长混淆] → 保留 3/2 的独立预算并在设置提示外保持文档说明。

## Migration Plan

1. 客户端/服务端设置移除 `maxSteps` normalizer 和 UI 输入，只保留 `totalSeconds`；旧字段不读取。
2. 运行时移除 gate/route 的步骤判断，固定内部 `recursionLimit`。
3. 更新超时/取消错误文案和测试：长序列不被步骤上限截断、总时长仍生效。
4. 更新 README；回滚时恢复旧 `maxSteps` 字段和 gate，但旧设置中的 `totalSeconds` 可保留。
