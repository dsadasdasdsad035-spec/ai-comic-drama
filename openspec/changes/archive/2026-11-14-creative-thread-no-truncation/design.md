# Design

## Context

现状与约束（动机见 `proposal.md`，需求见 `specs/creative-thread-context/spec.md`）：

```text
第 N 轮   read_skill_text → 工具返回全文 → 模型看到完整 7,732 字    OK
第 N+1 轮 buildCreativeTurnPayload
         uiThreadToPiMessages()
           shrinkJson()          TOOL_RESULT_MAX = 4_000   ← 折叠成 60 字摘要
         runStageAgent(priorMessages)
           transformContext
             shrinkOldToolResults()   > 4_000 且早于 24 轮   ← 目前被上一层挡住
             MAX_CONTEXT_CHARS = 48_000 → 只留最后 48 条
```

实测数字：本机 19 个已装技能中 15 个超过 4 000 线（2 089 ~ 7 732 字，合计 89 760 字）；创意会话工具 schema 固定 10 413 字；system 597 ~ 1 179 字。

只有创意会话传 `priorMessages`：`CreativeStudio` 传，`SkillChat` 走 `history` 字符串（截断 6 000）。因此 `threadMemory.ts` 的裁剪只作用于创意。`engine.ts` 的 `compactPiHistory` 是场景 agent 的草稿折叠，与本变更无关。

设置库 348 个模型条目均未声明上下文窗口，`stageRunner.ts` 与 `engine.ts` 都硬编码 `contextWindow: 0`，运行时没有任何真实预算可依据。

## Goals / Non-Goals

**Goals**

- 历史内容保真：工具结果原样进入下一轮，直到用户清空或新建会话。
- 失败可读：上下文超限与保存失败都以中文给出下一步，不裸露渠道报文、不静默。

**Non-Goals**

- 不做上下文窗口探测，不引入 tokenizer 或 token 计费。
- 不做自动摘要/压缩替代方案（宁可失败也不静默丢内容）。
- 不改工作台聊天（`threads.ts` 的 4 000 折叠）、场景 agent（`compactPiHistory`）与 SkillChat 的 `history` 截断。
- 不改服务端 1MB 线程上限，只让它可见。

## Decisions

**1. 三层裁剪同批移除，不逐层摘**

三层叠在同一条链上。只摘第 1 层时，第 2 层会从死代码变成活代码（实测 5 000 字技能 + 30 轮，当前折叠来自第 1 层的摘要，说明第 2 层从未生效）；摘两层留第 3 层，则总量到 48k 时仍会丢掉早前全部消息。因此 `TOOL_RESULT_MAX`、`KEEP_USER_TURNS`、`MAX_CONTEXT_CHARS` 与其两个折叠函数一并删除。

替代方案：保留常量为"极大值"（如 10⁹）。否决——留一个永不触发的开关，后人只会再次调小它。

**2. 移除 `transformContext` 装配，而不是保留空实现**

三层去掉后 `compactPiThreadMemory` 无可改写之处。保留一个恒等函数会让"历史会被改写"这一预期留在代码里，也让后续有人往里塞压缩逻辑。改为创意会话不装配 `transformContext`；原函数降级为只读的体积说明，仅供检查器展示轮数与字符数。

**3. 上下文超限由服务端标注 `kind`，前端按 kind 呈现**

只有服务端拿得到渠道的 HTTP 状态与报文，前端正则匹配各家的报错文案必然漂移。做法：`/api/text` 在识别到上下文长度类错误时，在错误事件里带上 `kind: 'context-overflow'`，前端据此显示「本次会话上下文已满，建议新建会话（历史仍保留在侧栏）」。这与既有 `thread-too-large` 的错误约定同构。

替代方案：前端 `message.includes('maximum context length')`。否决——多渠道文案不一致，且中文化文案会漏判。

**4. 保存失败就地提示，不阻断当前轮**

`CreativeStudio` 四处 `void saveCreativeThread(...).catch(() => {})` 改为捕获后 `setActionError` + `onToast`，提示「本轮未保存：超出线程上限/网络错误」。消息仍留在内存与界面，用户可继续操作或新建会话。不采用自动重试：1MB 超限重试必然再次失败。

**5. 保留 1MB 持久化上限**

它是存储边界而非模型边界，去掉会让单行无界增长。本次只保证失败可见。分片存储或提高上限属于另一次变更。

## Risks / Trade-offs

- [长会话必然撞到模型窗口，且历史只增不减，该会话此后每轮都会失败] → 显式失败 + 可读出路，历史仍在侧栏可读。这是有意的取舍：宁可明确失败，不静默丢内容。
- [每轮请求体积显著变大，费用与首字延迟上升] → 接受。同会话重复读取同一技能的浪费可后续用"已读去重"解决，那属于缓存而非截断。
- [48k 摘掉后运行时失去唯一的自我保护，`contextWindow: 0` 仍未知] → 本次不探测窗口，只在失败时给可读原因；窗口探测列为后续 open question。
- [先撞 1MB 还是先撞模型窗口不可预测] → 两条路径都有可见提示，用户可据此新建会话。
- [误伤其它入口] → 已确认 `threadMemory.ts` 仅创意使用；`SkillChat` 不传 `priorMessages`，`engine.ts` 走另一套折叠，均不触碰。

## Migration Plan

纯运行时行为变更，无数据迁移、无 schema 变更、无配置项。发布后已存在的会话在下一轮即按新规则重建历史（历史本就存全文，拿回原文即可）。

回滚：恢复三层常量与 `transformContext` 装配即可，历史数据无需处理。

## Open Questions

- 是否值得做"同会话同技能只保留一次正文"的去重（缓存语义，不是截断）？
- 是否要在模型条目上补 `contextWindow` 声明，把 48k 这类拍脑袋常量换成按模型窗口算预算？
- 1MB 线程上限是否应改为按消息分片存储，以免长会话先撞存储而非模型窗口？
