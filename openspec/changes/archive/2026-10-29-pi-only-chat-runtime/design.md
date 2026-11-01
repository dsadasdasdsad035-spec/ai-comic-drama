# Design

## Context

见 `proposal.md`。当前实现的关键事实：

- 存在四套聊天入口：`runSceneAgent`（3D）、`runStageAgent`（五个工作台 + 发布 + 创意，共 7 个界面）以及它们各自的门面/工具工厂。
- `runSceneAgent` 已有引擎接缝：`pi` 为默认，模型不在能力表时回退 `langgraph`；`runStageAgent` 只有 `StateGraph` 一条路。
- 工具共 47 个：`sceneAgentTools` 12、`stageTools` 8、`creative/tools` 12、`publish/publishTools` 15，全部是 `DynamicStructuredTool`（zod schema）。
- `pi/tools.ts` 为 12 个 scene 工具手写了 TypeBox 参数副本，注释要求与 zod 定义逐项对齐——这是必然 drift 的第二份真相。
- 两个 `BaseChatModel` 适配器：`ZCodeChatModel`（JSON action + 三次截断重试）、`NativeToolChatModel`（原生 tool_calls）。`agentHistory.compactDraftHistory` 只被它们使用。
- 服务端 `/api/text` 在带 `tools` 时用能力表守卫，未声明模型直接 400；SSE 只发 `meta / progress / tool_call_delta / done / error`。
- `@earendil-works/pi-agent-core` 与 `pi-ai` 已是现有依赖；pi 的 `validateToolArguments` 走 `typebox/compile`，对普通 JSON Schema 有 `coerceWithJsonSchema` 兜底路径（已实测接受 `required` 校验与数字强制转换）。
- 真实模型探测结论（绕开应用守卫直连渠道）：ark-plan 通道 8 个模型在单工具与深层嵌套两种 schema 下都稳定通过；标准方舟 Key 已返回 401；APIMart 忽略 `stream:false` 且高频请求会断连。

## Goals / Non-Goals

**Goals:**

- 全应用只剩一个循环、一个工具外壳、一套事件映射。
- 删除 LangChain 依赖而不改变任何 `submit_*` 草稿语义、门禁、镜头隔离或线程记录。
- 工具参数只有一个 schema 来源，且模型可见声明与执行前校验使用同一份定义。
- 能力判定失败在运行开始前给出可读错误，而不是运行中途静默降级。

**Non-Goals:**

- 不改 `/api/text` 协议、不做 token 级正文流式。
- 不改聊天 UI 版式、技能内容、草稿合并逻辑与项目数据结构。
- 不引入 pi 的 provider 体系、subagent、MCP 或工具市场。
- 不为 APIMart 做限流处理，也不把它加入能力表。

## Decisions

### D1：本地工具定义取代 `DynamicStructuredTool`

新增 `src/agent/tool.ts`，定义一个框架无关的工具形状：

```
type ToolDef = {
  name: string
  description: string
  schema: ZodType                 // 唯一 schema 来源
  run: (args) => Promise<unknown>
}
```

四个工具工厂改为返回 `ToolDef`，`run` 函数体原样保留（`ok:false` 语义、`boundJson` 截断、契约校验都不动）。再由 `src/agent/pi/toolAdapter.ts` 把 `ToolDef` 转成 pi 的 `AgentTool`：

- `parameters = z.toJSONSchema(schema, { io: 'input' })`，去掉 `$schema` / `$id`。
- `execute()` 调 `run()`，`content` 放 `modelFacingResult(name, result)` 的 JSON，`details` 放完整结果，`ok:false` 映射为 `isError`，`finish` 额外返回 `terminate: true`。

替代方案是保留 `DynamicStructuredTool` 并在外面包一层适配器。否决原因：那正是现在 `pi/tools.ts` 的形态——两套外壳、两份 schema、一处分叉就要改两个地方；而且它会迫使保留 `@langchain/core`。

### D2：JSON Schema 必须用 input 语义生成

`z.toJSONSchema()` 默认 `io:'output'`，会把带 `.default([])` 的字段放进 `required`，模型漏传即被判为非法；`designs` 的 `scenes/props`、`evidence_frames` 正是这种字段。因此适配层固定传 `{ io: 'input' }`。

已实测：`io:'output'` 的 `required` 为 `["b","c"]`，`io:'input'` 为 `["c"]`。这条写进适配层注释，避免后人改回去。

### D3：能力表以模型标识为键

现状以 `providerId + model` 匹配，导致同一模型换渠道后能力判定翻转。改为以 `model` 匹配，渠道只作为审计信息记录。表内容从 4 条扩到 8 条（全部为 ark-plan 通道实测）：

```
MiniMax-M3
doubao-seed-2-1-lite-260915 / doubao-seed-2-1-pro-260915 / doubao-seed-evolving
deepseek-v4-flash / deepseek-v4-pro
kimi-k3 / glm-5.3
```

保留 `toolThinkingMode` 的 thinking 关闭策略——工具模式下 reasoning 会吃掉参数输出预算。

替代方案是继续双键并给每个渠道行单独验证。否决原因：协议能力是模型属性而非渠道属性，双键只会让用户换渠道时莫名失效；多渠道重复验证也把维护成本翻倍。

### D4：能力校验前移到运行入口

`runSceneAgent` 与新的 stage runner 都在构造 `Agent` 之前解析当前环节模型并查表；未命中直接抛可读错误（渠道、模型、可用清单），不再有回退分支。服务端 `/api/text` 的 `toolRequestError` 守卫保留，作为第二道防线。

设置项收缩：删除 `agentEngine`；`agentToolProtocol` 不再服务协议选择，删除该设置与下拉。3D 聊天头部的 `[data-agent-engine]` 芯片改为展示「原生工具调用可用 / 不可用」的能力状态，保留排查价值。

### D5：stage runner 用 `finishTurn` 复刻现有循环语义

新增 `src/agent/pi/stageRunner.ts`，接口与 `RunStageAgentInput` 保持一致（`userText` / `system` / `tools` / `history` / `modelKey` / `stage` / `signal` / `onEvent`）。

- 有工具调用 → pi 自动继续；无工具调用且 `finishTurn` 返回 `undefined` → 循环结束。与现行为一致，不需要额外门禁。
- `maxSteps`（默认 16）改为 `finishTurn` 内的轮次计数，到点返回 `{ action: 'end' }` 并置标记，退出后补发原有「工具循环达到 N 步上限」错误。
- 总超时仍由 runner 的 `setTimeout + agent.abort()` 控制；`streamFn` 负责在 `signal.aborted` 时以 `stopReason: 'aborted'` 结束——pi 的 `abort()` 只停当前流，不会停循环，这是已知踩过的坑。
- 截断：pi 在 `stopReason === 'length'` 时自动让整批工具调用失败，不再执行参数残缺的调用。这是对 `actionRetryHint` 三次重试的替代，语义更硬（宁可失败也不执行坏参数）。

### D6：事件映射只保留一份

`src/agent/pi/events.ts` 已把 pi 事件映射为步骤/文本/工具三类 `AgentEvent`，且有去重集合；stage runner 直接复用。`sceneAgentEvents.ts` 只保留与框架无关的纯函数（`sanitizeToolInput`、`safe`、`extractModelText` 的等价物），删除 `createAgentEventBridge` / `mapLangGraphEvent` / `RawLangGraphEvent`。

`thinking_*` 事件继续丢弃，保持「不展示隐藏推理」。

### D7：历史压缩只留 pi 版本

`agentHistory.compactDraftHistory` 只被两个将删除的 ChatModel 使用；`runStageAgent` 的历史是 `threadTranscript()` 产出的纯文本，不需要消息级压缩。因此删除 `agentHistory.ts`，保留 `pi/compact.ts` 作为草稿分片折叠的唯一实现，`docs/scene-agent-engine.md` 里「两份实现必须保持一致」的限制随之消失。

### D8：契约 `required` 收紧是必做前提

原生工具模式下 schema 是模型的第一手指令；JSON action 时代模型主要读提示词里的文字契约，宽松 schema 不发作。实测 `kimi-k3` 在 `shots.items.required = ["no"]` 下返回 `{no:"S01"}` 且能通过 `validateContract` 写入空草稿；把 required 收紧到 `["no","scene_no","seconds","size","desc"]` 后同一模型稳定通过。

因此六个契约（`script-v1`、`characters-v1`、`designs-v1`、`shots-v1`、`prompts-v1`、`reverse-v1`）在保留 `.optional()` 语义的前提下，把「业务上不可省略」的字段加入 `required`。校验逻辑本身不变，仍然只做结构校验。

### D9：技能 `runtime` 字面量改名并兼容旧值

10 个技能 frontmatter 写的是 `runtime: json-tools`，在协议删除后名不副实。改为 `runtime: tools`；`parse.ts` 同时接受 `json-tools` 作为别名并归一化为 `tools`，避免用户已保存的技能覆盖因字面量变更而报「未知运行时」。

## Risks / Trade-offs

- **模型可选面收窄** → 只有能力表内 8 个模型能用于聊天。已实测覆盖默认模型表的全部 ark-plan 文本条目与 MiniMax；`ark` 两条因 Key 401、`deepseek` 直连与 `openai` 因无 Key、APIMart 因未验证，都会变成显式报错。缓解：错误信息列出可用模型，设置页显示当前环节模型的能力状态。
- **浏览器打包体积增加** → `pi-ai` 约 6.5 MB，原先只在 3D 聊天路径使用，现在所有聊天都走它。缓解：先测量首屏与聊天路由的实际增量；聊天入口已按界面懒加载，必要时把 pi 适配层也改为动态 import。
- **`agent.abort()` 不停循环** → `streamFn` 与 runner 双层检查 `signal.aborted`；保留「工具执行中取消」的回归用例。
- **pi 对普通 JSON Schema 的兼容是兜底行为** → 依赖 `validateToolArguments` 的非 TypeBox 分支。缓解：适配层单测覆盖 `default` / `optional` / 嵌套数组 / 未知字段，并在升级 `pi-*` 版本时优先跑这组测试。
- **删除 `@langchain/core` 会同时删掉 `DynamicStructuredTool` 的类型便利** → 本地 `ToolDef` 必须覆盖原有能力（zod 校验、描述、名称绑定）。缓解：`bindSkillTools` 的过滤逻辑保持不变，只换返回类型。
- **两个变革的归档顺序冲突** → `scene-agent-pi-engine` 已完成但未归档，其 delta 新增「引擎可切换且可回退」等 6 条需求。若先归档它，主规格会出现与本变更矛盾的双引擎需求。缓解：先决定该变更的归档去向（归档后由本变更改写，或直接作废其 delta），再同步本变更的规格。
- **浏览器验收脚本的 mock 形状失效** → 多个 `verify-*.mjs` 用 `{ json: { content, tool_calls } }` 模拟模型。缓解：统一改为 `{ text, toolCalls, finishReason: 'tool_calls' }`，与 `/api/text` 真实返回一致。

## Migration Plan

1. 处理 `scene-agent-pi-engine` 的归档去向，确认没有双引擎需求残留。
2. 收紧六个契约的 `required`，跑现有契约与工具测试确认无回归。
3. 能力表改 model-only 并扩到 8 条；补 `verify` 覆盖新键语义。
4. 新增 `src/agent/tool.ts` 与 `pi/toolAdapter.ts`；四个工具工厂改为返回 `ToolDef`。
5. 新增 `pi/stageRunner.ts`，把五个工作台、发布、创意的 `runStageAgent` 调用切到新 runner。
6. `runSceneAgent` 去掉引擎选择，直接走 pi；删除 `pi/tools.ts` 的手写 SPECS。
7. 删除 LangChain 实现与依赖：`sceneAgentGraphLangGraph`、`zcodeChatModel`、`nativeToolChatModel`、`actionJson`、`agentHistory`、`sceneAgentEngine` 与事件桥的 LangGraph 部分。
8. 清理设置：移除 `agentEngine`、`agentToolProtocol` 及相关归一化与 UI；存量值忽略而不是报错。
9. 技能 frontmatter 与 `parse.ts` 的 `runtime` 改名并保留别名。
10. 重写测试与文档：删除双引擎对齐与 LangGraph 回归，新增单引擎工具协议回归，更新 `docs/scene-agent-engine.md`。

回滚：整体回退分支即可；线程记录、草稿与服务端数据都不受影响，因为聊天运行时不在持久化层留状态。

## Open Questions

（无）
