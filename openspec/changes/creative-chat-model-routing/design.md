# Design

## Context

创意会话的模型信息只有一条通路：设置库 → `listStudioModels()` → `writeStudioProfile()` → 宿主的 `cordis.patch.yml` → 网关 → `/api/text`。这条通路上有三处约束决定了下面的实现方式：

- **patch 文件是双向的**。`agent-default-model` 既由应用生成，也由宿主写入：创意里换模型会经 `agentDefaultModel.saveSelection()` 落到 `configEditor.documentPath`，而该路径就是同一份 `profiles/web/cordis.patch.yml`（`packages/boot/config-editor/src/index.ts:34`）。
- **宿主配置是严格 schema**。`agent-default-model` 只接受 `provider` / `model` / `reasoningEffort`（`packages/core/agent-default-model/src/index.ts:52-56`），所以"这个值是谁写的"不能作为字段存进 patch。
- **两端 `Stage` 已经分叉**。前端 `src/api.ts:1276-1287` 的 `Stage` 含 `creative`，服务端 `server/app.ts:394-395` 不含；`normalizeStageModels` 只遍历服务端的 `STAGES`，因此 `creative` 在写库前就被丢弃。

## Goals / Non-Goals

**Goals:**

- `stageModels.creative` 能通过保存校验并落库，且作为宿主默认模型的第二优先级。
- 宿主已保存的显式选择不被应用的重写破坏。
- `stageMaxTokens.creative` 对创意会话生效，语义与 `/api/text` 的 `maxTokens` 一致（空 = 不带）。
- 模型表为空时宿主看到的是"去设置页绑定"的可读错误，而不是"模型不存在"。

**Non-Goals:**

- 不改创意模型选择器的展示（中文 `name`、过滤无 Key 渠道）——独立改动。
- 不向宿主暴露渠道信息（域名、Key、协议）。
- 不改 `dsh` 源码，也不改 `creative-chat` 之外的解析顺序。
- 不尝试恢复已被丢弃的历史 `stageModels.creative` 值。
- 不动其他环节的 `stageMaxTokens`。

## Decisions

### D1：服务端 `Stage` 收编 `creative`，而不是维持两套类型

把 `server/app.ts` 的 `Stage` 联合类型与 `STAGES` 加上 `'creative'`，并让 `BUDGET_STAGES = STAGES`（去掉重复定义）。

理由：服务端的 `STAGES` 只有一个消费点（`normalizeStageModels`，`server/app.ts:503`），加一项的影响面就是"多接受一个合法键"；前端早就是 8 个环节，继续维持两套类型只会把分叉留成下一处 bug。

备选：保留独立 `StageModelKey` 类型 + 手工白名单。否决——白名单和 `BUDGET_STAGES` 已经各写了一份，再加一份就是三处需要同步。

### D2：默认模型来源判定用应用自记状态，而不是靠 patch 里的字段

新增 `<DSH_HOME>/studio-default.json`，记录应用上次写入的 `{ provider, model }`。判定规则按顺序短路：

```
existing   = 读取 patch 里的 agent-default-model
lastWritten = 读取 studio-default.json

1. existing 缺失                                   -> 写回退值，并记录
2. lastWritten 存在且 existing == lastWritten       -> 仍是我们写的，更新为新回退值
3. existing 不在当前模型集内（键已失效）            -> 写回退值
4. 其余（含 lastWritten 缺失且 existing 有效）      -> 保留，不写
```

第 4 条是保守分支：状态文件丢失或首次升级时无从判断来源，保留文件里的有效值，宁可让设置页改动晚一轮生效，也不抹掉用户在创意里选的模型。

备选：
- 在 patch 里加来源标记字段 —— 被宿主的严格 Config schema 拒绝。
- 一律以文件为准 —— 用户改了「创意（对话助手）」后永远不生效。
- 每次覆盖 —— 就是当前缺陷。

### D3：`syncProfile` 的签名纳入默认模型 id

现有签名只由 `id:vision` 组成（`server/index.mjs:266`），默认模型变化不会触发重写。签名改为 `模型列表 | default=<id>`，否则 D1/D2 的解析结果只在模型集同时变化时才生效。

### D4：`maxTokens` 在网关层附带，而不是写进模型 profile

`llm-pi-ai` 的 `modelProfile.maxTokens` 是"该模型最大输出"的能力声明，会被宿主用于钳制请求；而 `stageMaxTokens` 的语义是"这次请求带不带 `max_tokens`"，与 `/api/text` 的入参一一对应（`server/app.ts:4950`）。写在网关的 `upstreamBody` 上，既符合语义，也能保留"留空 = 不带"。

备选：写 profile 的 `maxTokens`。否决——会影响所有使用该模型的会话，且无法表达"留空"。

读取方式：网关创建时注入 `getCreativeMaxTokens()`，与 `getModels()` 同样按请求读取，不做缓存（设置页改完立即生效）。

### D5：模型表为空时由网关给出可读错误

`listStudioModels()` 为空时保留写入 `sb/default` 作为占位（防止宿主回落到内置 DeepSeek 官方路由绕过账本），但网关在 `models` 列表为空时直接返回可读错误，而不是让它走到 `resolveModelId` 的"没有对应的应用模型键"。

理由：spec 要求"解析不到可用模型时 MUST 以可读错误提示去设置页绑定"，而 `sb/default` 在模型表为空时永远不会存在于列表中。

### D6：解析逻辑放在 `server/app.ts` 并导出

新增导出（与 `listStudioModels()` 相邻），保持"设置库是唯一真相"：

```
studioDefaultModel(): string
  usable(m) = hasTextCap(m) && isRunnableModel(m)
  stageModels.creative（usable）→ defaults.text（usable）→ 首个 usable
  返回 'sb/<key>'；表为空返回 'sb/default'
```

理由：`server/index.mjs` 只做编排，不该自己理解 `usable` 的判定；`listStudioModels()` 与它共享同一个 `usable` 谓词，避免两处判定漂移。

## Risks / Trade-offs

- **状态文件丢失会让设置页的创意默认暂不生效** → 规则第 3 条兜底"键失效即覆盖"；同时在同步日志里输出判定分支，便于排障。
- **已有实例默认模型会跳变**（`sb/ark-text-lite` → 当前 `defaults.text`）→ 属于向 spec 对齐的预期变化，写进迁移说明。
- **历史 `stageModels.creative` 已不可恢复** → 迁移说明里明确要求用户重设一次。
- **patch 文件仍存在并发写窗口**（宿主 `configEditor` 与我们同时写）→ 本次不引入新窗口，沿用现有"写前重读"行为；D2 的"保留有效值"分支反而降低了覆盖用户选择的风险。记为已知限制。
- **用户显式配了很小的输出上限** → 工具调用可能被截断。缓解：沿用设置页现有 1–200000 的校验范围，不在本次放宽或收紧。

## Migration Plan

1. 发布后首次同步会重新解析默认模型并可能重写 `agent-default-model`。
2. 状态文件不存在时走 D2 的第 4 条：patch 里的有效值被保留，因此老用户不会因为升级丢掉创意里的选择。
3. 回滚：删除 `studio-default.json` 并恢复旧的 `writeStudioProfile` 行为即可；patch 文件本身可由下一次同步重建。

## Open Questions

无。默认模型来源判定、输出上限的作用层、以及空模型表的退化行为都已在上面的决策中确定。
