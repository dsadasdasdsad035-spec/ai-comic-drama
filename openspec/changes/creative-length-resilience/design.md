# Design

## Context

见 `proposal.md - Why`。当前实现的三处关键约束：

- 运行时只有两条入口：`src/agent/pi/stageRunner.ts`（创意、工作台、发布）与 `src/agent/pi/engine.ts`（3D 调度）。两者共用 `createPiStreamFn`。
- `stageRunner` 没有 `transformContext`，历史只在每轮开始时由 `uiThreadToPiMessages` 重建成初始消息，运行内不再变化。
- `submit_*` 由 `src/agent/stageTools.ts` 用契约 schema 生成；`applyProjectDraft` 对 `shots-v1` 以 `mode: 'full'` 写回，缺席镜头会被判为删除。

## Goals / Non-Goals

**Goals:**

- 三种长度失败都变成可继续的状态，且用户能看懂发生了什么。
- 分批写入与一次写入在数据上完全等价。
- 压缩只作用于「送往模型的投影」，持久化线程与界面历史不变。

**Non-Goals:**

- 不做多 Agent 拆分（planner/writer 子任务），本变更只解决单循环的长度问题。
- 不做向量记忆或跨会话长期记忆。
- 不开启渠道前缀缓存（`cache_control` / `prompt_cache_key`），那是独立的成本优化项。
- 不引入 tokenizer；预算以字符为单位。

## Decisions

### D1：续写在运行时层用「推动消息」实现，不走渠道侧 prefill

`createPiStreamFn` 在 `finish_reason === 'length'` 时不再 `fail()`，而是：

- 无工具调用：把已流出的正文作为正常 `stop` 结束，并在闭包里记录 `lastStop = 'length-text'`。
- 有工具调用：**丢弃**这些调用（不 emit `toolcall_*`），记录 `lastStop = 'length-tools'`。这样 pi 不会执行半截参数，也不需要新增 stopReason。

运行时在 `finishTurn` 读到 `lastStop` 后，通过已有的 `prepareNextTurn` 注入推动消息：

| `lastStop` | 推动消息 | 上限 |
|---|---|---|
| `length-text` | 「继续从上文断点往下写，不要重复已写内容」 | 每运行 3 次 |
| `length-tools` | 「单次工具参数超过输出上限：请缩小单次 payload，或用 `limit`/`cursor` 分批提交」 | 每运行 2 次 |

每次续写计为一次普通轮次，受总时长与 `MAX_TURNS` 约束（对应 `chat-agent-runtime` 的修改后要求）。

**替代方案**：用渠道的 assistant prefill / continue 接口。被否：代理是 OpenAI 兼容层，各渠道对 prefill 支持不一致，且需要按渠道分叉，违反「一个运行时」。

**替代方案**：新增自定义 `stopReason: 'length'` 让 pi 感知。被否：需要改 pi 的 union 类型与循环语义，收益不抵风险；闭包标记更小。

### D2：分批写入把分页字段放在工具声明层，不写进契约

- `getContractToolSchema` 返回的声明在运行时被包一层：`{ ...payloadShape, cursor?: string, limit?: number }`。契约 schema 本身不变，仍是唯一参数来源。
- 执行前先剥离 `cursor` / `limit`，再走 `validateContract`，避免契约把分页字段当业务字段。
- `cursor` 是 base64 的 `{ contract, epNo, offset, fp }`，`fp` 为当前快照指纹。校验失败（自造、过期）返回带「先读取再继续」的结构化错误。
- 回执固定为 `{ ok, accepted, remaining, total, nextCursor? }`。

**关键点：分批写入必须用 `mode: 'merge'`。** 现有 `applyProjectDraft` 对 `shots-v1` 使用 `FULL`，缺席即删除；分批提交的 payload 天然是子集，若沿用 `FULL` 会把未提交的镜头标成 orphan。判定规则：请求带 `cursor` 或 `limit` 即视为分批，走 `merge`；不带则保持现有 `FULL` 语义。这是本变更最容易出错的地方，必须有专门的回归测试（12 镜分三批，写完后镜数仍为 12）。

**超限预检**：在契约校验前先比较序列化长度与 `MAX_SUBMIT_CHARS`（默认 24 000 字符）。超限直接返回 `{ ok: false, error, suggestedLimit, hint }`，而不是让模型看到「不符合契约」。

### D3：历史预算采用「近期保真 + 旧工具结果指针化」

新增 `src/agent/pi/budget.ts`，导出纯函数 `applyHistoryBudget(messages, opts)`，按顺序执行：

1. 保留最近 `KEEP_TURNS = 2` 轮的 `toolResult` 原文。
2. 更早的 `toolResult` 内容替换为一行 stub：`[read_shots 结果已卸载：31 条 / 18 420 字符，需要时用 read_shots 重新读取]`。
3. 仍超预算时，把更早的 assistant 正文截为「首行 + 摘要标记」，并记录摘要轮数。
4. 最后仍超预算，交由 D4 的溢出路径处理。

预算单位是字符（默认 48 000，与既有规格里的阈值口径一致），因为项目没有 tokenizer；`usage` 里的真实 token 数只用于诊断。

接入点有两处：

- `stageRunner` 新增 `transformContext`，覆盖运行内的历史增长。
- `buildCreativeTurnPayload` 在构造 system 之前先算一次投影，得到 `compacted: boolean`，据此决定 system 说「已读过可不再重复读取」还是「需要时用读工具重取」（对应 `creative-thread-context` 的 system 一致性要求）。

**为什么是指针化而不是摘要优先**：项目数据与技能全文都能用现有读工具按需重取，指针是**无损**的；摘要会编造细节。摘要只作为第二级兜底。

**替代方案**：滚动窗口直接丢旧轮。被否：会丢掉任务约束（比如「本集只写 4 镜」），模型会重新问一遍。

### D4：上下文溢出先压缩重试一次

服务端已经在 `server/app.ts` 打上 `kind: 'context-overflow'`。客户端把它解析成带 `kind` 的 `TextStreamError`。`stageRunner` 捕获该错误后：

1. 用激进预算（所有 `toolResult` 指针化、只保留最近 1 轮）重建 `priorMessages`。
2. 新建 `Agent` 重新执行一次，事件沿用同一 `bridge`，但不再重复发送已经发过的文本增量。
3. 仍失败才发可读错误，明确「已尝试压缩」并建议新建会话。

**替代方案**：在服务端重试。被否：服务端不掌握历史语义（哪条是工具结果、哪条可卸载）。

### D5：环节输出预算保持可选，默认仍交给渠道

`StageRuntimeConfig.maxTokens` 从占位变为可解析：设置页可为创意/分镜显式配置，未配置时不带 `max_tokens`。错误文案带上实际预算（渠道默认或配置值），避免用户以为是代码缺陷。

**替代方案**：给所有环节写死一个「够大」的值。被否：不同渠道上限不同，写过小反而制造截断。

### D6：续写与压缩作为一等事件进入线程

新增两个 custom 事件：

- `continuation`：`{ attempt, total, reason: 'text' | 'tools' }`
- `context_compaction`：`{ stubbed, summarized, charsBefore, charsAfter, aggressive: boolean }`

`agentMessageReducer` 把它们渲染成步骤条目标记（与现有 `progress` 同路径），并持久化为步骤部件。这样重新打开线程仍能看到「第 2 次续写」与「已卸载 14 条工具结果」，满足可见性要求，且不会伪造成用户气泡。

## Risks / Trade-offs

- [续写放大 token 消耗] → 每运行最多 3 次，且与总时长共享预算；诊断里报告续写次数。
- [指针化后模型反复重读同一工具，形成来回] → stub 里写明精确的读工具与关键参数；system 同步改成「需要时重取」，避免模型凭记忆作答。
- [分批写入误用 `FULL` 导致镜头被删] → 用「带 cursor/limit 即 merge」的硬规则，并加 12 镜分批回归测试；代码路径上把 mode 作为显式参数传入，不靠默认值。
- [丢弃截断的工具调用后，模型重复同一超长 payload] → 推动消息给出明确的拆分指令与 `limit` 建议；同一运行内 `length-tools` 最多 2 次，之后以可读错误收尾。
- [压缩是投影层，持久化线程仍会无限增长] → 本变更不解决落库体积；线程保存上限仍按既有要求报错。若要控制落库体积，另开变更。
- [既有验收脚本断言「只提示新建会话」] → 随行为更新 `verify-creative-context-overflow.mjs`，并在任务里显式列出。

## Migration Plan

- 无数据迁移：项目数据结构不变，`cursor` 是运行期临时值，不落库。
- 线程记录兼容：压缩只影响发送给模型的投影，旧线程照常打开；新增的步骤部件对旧线程无影响（读不到就当没有）。
- 回滚：三处改动彼此独立，可分别回退（`streamFn` 续写、`budget.ts` 投影、`stageTools` 分页）；回退后旧线程与项目数据不受影响。
- 验收顺序：先跑分页等价性（纯函数 + 项目写回），再跑续写（mock 渠道连续返回 `length`），最后跑溢出重试（复用现有 mock 上游）。
