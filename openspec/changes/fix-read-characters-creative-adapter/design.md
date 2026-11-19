# Design

## Context

见 `proposal.md` — Why。当前实现里，读工具在「会话草稿」与「项目快照」之间二选一，分支依据是适配器的 `artifact` 字段：

- `src/agent/builtinPlatformTools.ts` 的 `createReadAdapter` 声明 `artifact: 'characters'`，但 `ownDraft: () => undefined`（创意会话没有本地草稿）。
- `src/agent/stageTools.ts` 的 `charactersData` 在 `artifact === 'characters'` 时**只**读 `ownDraft()`，结果为 `undefined` 就返回 `[]`，永不调用 `projectSnapshot()`。
- `read_designs`（`artifact` 不是 `designs`）与 `read_shots`（`artifact` 不是 `shots`/`prompts`）因此都读快照，只有角色读空。

约束：`artifact` 同时决定 `read_shots` 的草稿分支，把适配器的 `artifact` 换成 `'shots'` 只是把 bug 从角色挪到镜头，不是修复。

## Goals / Non-Goals

**Goals:**

- 创意会话下 `read_characters`、`read_designs` 始终反映当前项目数据。
- 空结果只在项目确实没有数据时出现；未选项目时是可读错误。
- 既有参数、返回形状与截断语义完全不变。

**Non-Goals:**

- 不引入「会话级角色草稿」这一新概念（本次没有该需求）。
- 不改 DSH 宿主、工具桥协议、专家 preset、前端角色板。
- 不改写 `read_shots` / `read_episodes` 的预算与装填策略。

## Decisions

### 决策 1：把「没有草稿」表达为 `undefined`，并回退到项目快照

`ownDraft()` 的返回值语义收敛为：数组 = 有草稿，`undefined`/非数组 = 没有草稿。读工具在「没有草稿」时统一回退 `projectSnapshot()`，而不是返回空集合。

- 抽一个共用判定（例如 `pickList(ownDraft(), loadSnapshot, key)`），`charactersData`、`designsData`、`shotsData` 共用，避免只修角色、下次同样的问题出现在别的读工具上。
- 工作台路径（草稿是真数组，包括空数组）行为不变：空数组仍表示「草稿就是空的」。

**备选 A：把 `createReadAdapter` 的 `artifact` 改成 `'shots'`** — 否决：`read_shots` 会立刻开始读 `ownDraft()` 并返回空镜头，等于换个工具继续坏。

**备选 B：给适配器加 `readFrom: 'snapshot' | 'draft'` 显式开关** — 更干净但改动面更大（类型、所有构造点、测试），且与「草稿缺失即回退」这一更普遍的语义重叠；本次不引入。

**备选 C：只在 `charactersData` 里加回退** — 能修当前 bug，但把同类隐患留在 `designsData`/`shotsData`；否决。

### 决策 2：空数组与「无草稿」严格区分

`Array.isArray(own)` 为真时直接返回该数组（含 `[]`），只有非数组才回退快照。这样工作台「草稿为空」不会被误读成「去读已保存项目」。

### 决策 3：回归测试走创意构造路径，而不是技能工作台路径

现有 `tests/shot-read.ts` 用的是 `artifact: 'shots'` + 真草稿，覆盖不到本 bug。新增断言用 `createBuiltinPlatformTools({ projectName, getSnapshot: () => 含角色的项目 })` 直接调用 `read_characters`，因为该路径**不经过** `getSnapshot` 短路——修复前必然返回空，能真实复现。

## Risks / Trade-offs

- [工作台草稿返回异常值（非数组）时由「空」变为「读已保存项目」] → 这是期望行为：非数组只可能来自未实现或异常适配器；如需严格区分，可在开发期断言 `ownDraft` 返回类型。
- [快照读取增加一次请求] → 创意路径本来每次读工具都走 `ensureProjectLoaded`，同轮内由 `stageTools` 的快照 promise 合并，不增加额外往返。
- [角色字段形状差异] → `read_characters` 一直透传 `project.characters` 原始形状，本次不改形状，仅改数据来源。

## Migration Plan

无数据迁移。部署后新会话即生效；同一会话内工具实现按 `server-build` 时间戳重载，无需重启宿主或应用。
