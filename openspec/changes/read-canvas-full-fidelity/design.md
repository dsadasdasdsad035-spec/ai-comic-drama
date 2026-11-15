# Design

## Context

当前读工具全部走 `src/agent/workbenchChat.ts` 的 `boundJson(value, max)`：先 `JSON.stringify`，超过上限就返回 `{truncated, chars, preview}`，其中 `preview` 是**字符串切片**。对数组调用时这不只是「少给几条」，而是给出半截 JSON。

`read_shots` 的上限是 `shotIds` 不超过 4 个时 200,000 字符、否则 8,000 字符；`read_episode` 先 `slice(0, 40)` 再套 8,000；`read_characters`、`read_designs`、`read_episodes`、`read_transition_recipes`、`read_asset_detail` 都用 `boundJson`。镜头记录的字段顺序是「基础字段 → `keyframe_prompt` → `video_prompt` → `clip` → `handEdited` → `extra` 展开」，所以预算一超，最先丢的恰好是视频提示词、转场与参考连线。

出片正文的唯一真源是 `src/videoPrompt.ts`：`buildShotVideoRequest` 决定 `textSource`（`video_prompt` → `prompt_fallback` → `script_assembled`），`effectiveVideoPrompt` 再让手改快照优先。见 proposal.md - Why，动机不再重复。

## Goals / Non-Goals

**Goals:**

- 任一读工具在任何数据规模下都只返回合法 JSON，且要么给整条记录、要么明确说没给。
- 一集分镜可以被逐次读到最后一镜，不依赖模型自己算偏移。
- 单镜与单镜出片正文可以一次拿全，不受列表预算影响。

**Non-Goals:**

- 不改变任何写回契约（`shots-v1`、`prompts-v1` 等）与落库行为。
- 不引入字段投影参数（如 `fields`）；钻取工具已覆盖「只要一部分」的场景。
- 不改变画布渲染、节点布局与连线数据。
- 不处理 `video_prompt_rendered` 是否应参与出片的问题（见 Open Questions）。

## Decisions

### 1. 按条装填取代按字符切片

新增纯函数模块（如 `src/agent/readBudget.ts`）导出 `packRecords(items, budget)`：逐条 `JSON.stringify` 量长度，累加装填，返回 `{ items, total, returned, truncated, oversized }`。

- 数组场景一律用它；`boundJson` 不再用于数组。
- 单条自身超预算时**必须整条返回**并标 `oversized: true`。丢弃 = 读不到，切字段 = 说谎，两者都比多花几千字符更糟。
- 唯一保留「字符串级截断」的是白模代码正文，它已有 `includeCode` 显式开关与原始字符数报告（见 `read_asset_detail`），语义是「大文本可选读取」，与本问题不同。

替代方案：把上限从 8,000 直接提到 200,000。实现一行，但一集 31 镜约 45,000 字符会一次性塞满上下文，且超过新上限后仍然退化成半截 JSON。

### 2. 续读游标用「上一镜的 shotId」

`read_shots` 新增可选 `cursor`，响应在有剩余时给出 `nextCursor`（值为本次最后一条的 `shotId`）。

- 不用数值偏移：会话期间镜头可能被插入或删除，偏移会重复或漏读。
- 游标指向的镜头已不存在时不猜测，直接返回可读错误要求重新从头部读。
- 游标与 `episode`、`limit` 正交；`shotIds` 优先于 `cursor`，两者同时出现时以 `shotIds` 为准。

`shotIds` 路径不再有「≤4 个 id 才放宽」的特例：条数上限（沿用 100）之外，一律返回完整记录，超出上限时列出未返回的 id。

### 3. 列表预算分档，不追求一个数字覆盖所有

- 分镜列表：24,000 字符（约 16 镜），足够一次读过大半集，又不至于单次塞爆。
- 其余列表：沿用 8,000，但改为整条装填。
- 单镜钻取：不设预算，按记录自身大小返回。

### 4. 单镜钻取与出片正文拆成两个工具

- `read_shot_detail({ no?, shotId?, episode? })`：返回该镜完整记录，含视频提示词各形态、`transition_out`、`refIds`、`refExtras`、`handEdited`。
- `read_shot_video_prompt({ no?, shotId?, episode? })`：返回 `{ text, source, stale }`，`source` ∈ `override` | `video_prompt` | `keyframe_prompt` | `script_assembled`。

不并入 `read_shots` 的字段投影：模型需要的是「现在到底发什么」，而不只是一个字段；独立工具也能让工具卡片给出可读的正文与来源。

### 5. 出片正文复用既有优先级，不自建拼装

实现直接调用 `effectiveVideoPrompt` 与 `buildShotVideoRequest` 的判定顺序，避免读工具与出片面板出现两套规则。

`buildShotVideoRequest` 需要画布节点与角色表才能走 `script_assembled` 分支。读工具只有 `ProjectData`，拿不到节点图，因此：

- `override`、`video_prompt`、`keyframe_prompt` 三种情况不需要节点图，逐字可复现。
- 三者为空时返回 `ok: true`、`text: null`、`source: 'script_assembled'`、`requiresCanvas: true` 与原因说明。此时刻意不给正文——近似正文会让模型以为它能控制出片，实际发出去的却是另一个人拼的。

替代方案：给工具注入画布节点。可行，但要把节点图从 `App.tsx` 一路穿到 `BuiltinPlatformCtx`，而当前只有创意视图持有它；先留出注入点（可选 `promptResolver`），等确有需要再接。

### 6. 新工具纳入工具清单与专家白名单

`builtinPlatformToolNames()`、`src/skills/tools.ts` 的 `KNOWN_TOOL_IDS`、`src/creative/expertToolGroups.ts` 的 `READ` 与 `DEFAULT_EXPERT_PLATFORM_TOOLS` 三处同步，避免「工具存在但专家选不到」。

## Risks / Trade-offs

- **单次响应变大** → 分镜列表预算 24,000 是折中；超长记录仍可能单条上千字符，靠 `oversized` 与钻取收敛。
- **游标失效**（续读途中镜头被删） → 明确报错而不是静默跳过，模型会重新读，最坏多花一轮。
- **半截 JSON 不再出现，但 `boundJson` 仍被别处引用** → 保留该函数并收窄其用途；数组调用点必须改完，否则等于没修。
- **`read_shot_video_prompt` 在脚本拼装场景给出 null** → 模型可能因此改用 `read_shot_detail` 自己判断；这是有意的降级，比给错正文安全。

## Open Questions

- `video_prompt_rendered`（九段模板正文）目前只入库、出片与面板都不消费，是否应参与「最终正文」由后续独立变更决定；本次读工具如实暴露该字段，但不把它当作发送正文。
