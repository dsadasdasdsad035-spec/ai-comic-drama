# Proposal

## Why

创意会话在下一轮重建历史时，把每个历史工具结果压到 4000 字符以内，只保留一句摘要。实测本机 19 个已装技能中 15 个超过这条线（最大 7732 字），模型在第二轮拿到的是 `{"truncated":true,"chars":7818,"summary":"novel-storyboard"}`，而 system 仍写着「已读过某技能全文…可不再重复读取」。技能正文是配置而非工具输出，被当作工具输出裁掉后，模型只能选择反复重读（每读一次 7.7k 字符，下一轮又没了）或凭第一轮印象编造。

## What Changes

- 移除历史重建中的 4000 字符折叠：历史工具结果不再被替换成摘要，技能正文与物料详情完整保留。
- 移除 24 轮过期折叠：摘掉上一条后该层会从死代码变成活代码，必须同批移除，否则技能正文仍会在 24 轮后变成「早期工具结果已折叠」。
- 移除 48 000 字符总量丢弃：不再只保留最后 48 条消息。
- 上述三层去掉后，创意会话不再需要 `transformContext` 改写历史；`compactPiThreadMemory` 降级为只读的体积说明，供检查器展示。
- 上下文溢出的失败必须可操作：上游返回上下文超限时，把原始报错翻译成「本次会话上下文已满，建议新建会话（历史仍保留在侧栏）」，而不是原样抛渠道报文。
- 创意线程保存失败必须可见：当前 `saveCreativeThread(...).catch(() => {})` 会吞掉服务端 1MB 超限错误，用户刷新后静默丢历史。改为提示「本轮未保存」并保留 `thread-too-large` 的原因。
- **BREAKING**（行为口径）：长会话不再静默截断，而是在模型窗口处显式失败。历史只增不减，一旦某轮超限，该会话需新建才能继续。

## Capabilities

### New Capabilities

- `creative-thread-context`: 创意会话线程如何重建为模型历史、历史是否裁剪、上下文溢出如何收尾，以及线程持久化失败如何告知用户。

### Modified Capabilities

<!-- 无：creative-chat 只约束模型选择与专家模式，chat-agent-runtime 约束运行时循环与工具结果分离，均不改动。 -->

## Impact

- `src/agent/pi/threadMemory.ts`：`TOOL_RESULT_MAX`、`KEEP_USER_TURNS`、`MAX_CONTEXT_CHARS` 三层裁剪与 `shrinkJson`/`shrinkOldToolResults` 移除。
- `src/agent/pi/stageRunner.ts`：创意会话不再装配改写历史的 `transformContext`。
- `src/creative/creativeTurnPayload.ts`：system 中「读过可不再重读」的承诺与真实行为对齐。
- `src/creative/CreativeStudio.tsx`：四处 `saveCreativeThread(...).catch(() => {})` 改为可见提示。
- `src/agent/pi/streamFn.ts` 与服务端 `/api/text` 错误路径：上下文超限报错翻译。
- `server/creative.mjs`：`MAX_CREATIVE_THREAD_BYTES` 保留为持久化上限，已有 `kind: 'thread-too-large'` 由前端消费。
- 不受影响：`src/agent/pi/engine.ts` 的 `compactPiHistory`（场景 agent 草稿折叠）、`src/agent/threads.ts` 的 `shrinkResult`（工作台聊天）、`SkillChat`（走 `history` 字符串，不传 `priorMessages`）。
- 模型条目均未声明上下文窗口（`contextWindow: 0`），本变更不引入窗口探测，只把失败变得可读。
