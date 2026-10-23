# Design

## Context

见 [proposal.md](proposal.md)。当前上限集中在 `DEFAULT_AGENT_LIMITS`（[sceneAgentTypes.ts](../../../src/agent/sceneAgentTypes.ts)），设置页只持久化模型、环节绑定、计价和规则。`state.steps` 是 LangGraph 图节点计数，每个 `agent -> tools -> gate` 循环约 3 步；本次保留这个语义，只在设置层开放它。

## Goals / Non-Goals

**Goals:**

- 设置页可配置最大步数和总运行时长，保存到现有 settings SQLite，旧设置自动补默认值。
- 运行时按保存值执行；达到步骤上限的错误包含当前值，总超时显示“运行超时”而不是“已取消”。
- 输入有明确默认值和范围，避免无上限或明显无效配置。
- 保持现有 3D agent 工具、沙箱和聊天 UI 契约不变。

**Non-Goals:**

- 不做工作台按次覆盖；本次只做全局默认。
- 不重算 `state.steps` 为模型轮次；设置文案说明约 3 步/轮。
- 不开放代码修复次数、视觉验收次数、单工具超时或抓帧数量。
- 不新增数据库表或迁移脚本；不改变模型渠道与 API Key 逻辑。

## Decisions

### 1. 设置结构使用秒，运行时转换为毫秒

`AppSettings` 增加可选：

```ts
agentLimits?: {
  maxSteps?: number
  totalSeconds?: number
}
```

默认 `{ maxSteps: 24, totalSeconds: 300 }`，范围分别为 `12–120` 和 `60–1800`。运行时把秒转换成毫秒；设置页直接显示秒，避免用户面对 `300000`。服务端和客户端各有一份轻量 normalize 逻辑（项目现有 `AppSettings` 也是双份声明），保证读旧数据、非法值和保存后回显一致。

### 2. 设置页新增独立“Agent 运行上限”区

放在“生成环节默认模型”之后、“模型表”之前或“计价”之前，复用现有 `.st-grid` / `.st-field` 数字输入。两个字段：

- 最大执行步数：hint 说明按图节点计，约 3 步/轮；低于默认值可能提前结束。
- 总运行时长（秒）：hint 说明与“取消”不同，超时会终止并保留旧代码。

保存继续走现有“保存”按钮和 `/api/settings`，不增加独立接口。

### 3. 运行时从 settings 解析一次并冻结本次运行

新增轻量 `resolveAgentLimits(settings)`（客户端 normalization 的一部分），`runSceneAgent` 在开始处解析一次，后续 gate、路由和 `recursionLimit` 使用同一个值。这样运行中修改设置不会改变当前运行，避免半途改变上限。`runSceneAgent` 保留一个可选的 `limits` 注入点仅供测试缩短总超时；生产路径不传，始终从 settings 解析。

`maxSteps` 仍来自 `state.steps`；`recursionLimit` 继续按 `maxSteps * 4 + 16` 计算，保证 LangGraph 递归限制不小于业务上限。

### 4. 总超时和用户取消分流

当前 timer 触发 `controller.abort()`，随后被统一识别为 cancelled。新逻辑记录 `timedOut`：

```text
timer fires -> timedOut = true -> abort
external signal/user cancel -> timedOut = false -> abort
```

最终结果：

- `timedOut`：`error = "运行超时（N 秒）；可在设置页调整"`，不标记 cancelled。
- 用户取消：保持 `cancelled`，显示“已取消”。
- 两者都不写入半成品，旧代码不变。

步骤上限错误改为包含 `maxSteps` 和设置入口提示；不把错误静默截断。

### 5. 其他上限保持常量

`maxCodeAttempts`、`maxReviewAttempts`、`toolMs`、`maxFrames` 继续使用 `DEFAULT_AGENT_LIMITS`。本次只处理用户遇到的步骤/总时长交互，减少设置页复杂度；如果后续需要开放，在同一 settings 结构上扩展。

## Risks / Trade-offs

- [用户把最大步数调得很低] → 范围下限 12，且 hint 说明低于默认可能提前结束；设置本身不能保证任务完成。
- [只调步数仍被 5 分钟截断] → 同时开放总时长并在设置页相邻展示，超时错误明确指向设置。
- [旧设置没有字段] → normalize 使用默认值，保存时只补该字段，不覆盖模型、渠道、计价和规则。
- [设置页和运行时 normalize 不一致] → 两侧共享同一组默认值和范围常量（允许双份声明时），并加设置保存/重载测试与运行时边界测试。
- [步数语义被误解为模型轮次] → UI 和错误文案都写“图执行步数，约 3 步/轮”，不在本次改计数方式。

## Migration Plan

1. 在客户端和服务端设置类型/规范化中加入 `agentLimits`，旧数据读取时补默认值。
2. 设置页加输入和保存；保存后回显规范化结果。
3. 运行时解析设置，接入 gate、递归限制和 timer；补超时/取消分流。
4. 加设置页、图运行时和错误文案测试，更新 README。
5. 回滚时删除字段消费和 UI 区即可，数据库中的 `agentLimits` 作为未知 JSON 字段保留，不影响旧版本读取。
