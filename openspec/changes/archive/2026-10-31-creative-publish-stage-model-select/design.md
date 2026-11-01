# Design

## Context

见 `proposal.md`。代码侧已具备 `Stage`、`stageModels`、`StagePick`、`StageModelSelect` 与 `resolveStageModel`；五工作台在 `WorkbenchBar` 接线完整，创意 / 发布仅消费 `stagePick` 且 UI 只读。`SettingsPage` 的 `STAGE_META` 缺 `creative`。

## Goals / Non-Goals

**Goals:**

- 与剧本/角色/镜头台相同的环节手选 UX（compact `StageModelSelect` + `pickStageModel`）。
- 设置页可单独配置 `stageModels.creative`。
- 复用现有解析链，不新增持久化格式。

**Non-Goals:**

- 不把创意文本模型迁入 `creative.models` 或会话表。
- 不改 `CapabilityTray` 能力列表。
- 不扩展 `WorkbenchHeader` 给五工作台（仅发布助手需要）。

## Decisions

### D1. 手选仍用全局 `StagePick`（localStorage）

**决定**：创意与发布的手选继续写 `storyboard-stage-model-pick`，与 `App.pickStageModel` 一致。

**理由**：与现有工作台一致；用户跨视图切换时期望同一环节手选保持。创意设计 D7 否决的是用 StagePick 存**媒体**能力，不是对话文本。

**备选**：会话级文本模型存 SQLite —— 需迁移与 UI 同步，超出本次范围。

### D2. 发布：`WorkbenchHeader` 增加可选 `modelSelect` 节点

**决定**：给 `WorkbenchHeader` 增加可选 `ReactNode modelSelect`；有则替换上下文条里只读的「模型 {label}」片段，无则保持现状（五工作台 `SkillChat` 不受影响）。

**理由**：避免复制整段 header；发布助手与将来其它只读模型头可复用。

**备选**：仅在 `PublishChatPanel` 在 header 下方加一行 —— 视觉不统一。

### D3. 创意：在 `CreativeHeader` 元信息行嵌入 `StageModelSelect`

**决定**：`CreativeStudio` 传入 `settings`、`stagePick`、`onPickStage`；`CreativeHeader` 在「模型 xxx」位置改为 compact select，或 select + 缩短展示（与 `ScriptBoard` compact 一致）。

**理由**：头部已有模型位；不另开一行，符合 `creative-layout` 密度。

### D4. 设置：`STAGE_META` 追加 creative 行

**决定**：在 `publish` 附近插入 `{ stage: 'creative', label: '创意（对话助手）', hint: '...' }`，空选项文案与其它文本环节相同（跟随文本默认）。

**理由**：`Stage` / `STAGES` / `stageModelEntries` 已支持 `creative`，只缺 UI 行。

## Risks / Trade-offs

- **[Risk] 全局 StagePick 在创意与剧本共用键空间** → 不同环节键独立（`creative` vs `script`），无冲突。
- **[Risk] Header 变宽挤压模式切换** → 使用 `compact` 与 `title` 展示完整 `stageDefaultLabel`。
- **[Trade-off] 创意文本手选不随会话同步** → 与五工作台一致；若未来要 per-session，另开变更。

## Migration Plan

纯前端发布；无数据迁移。旧用户无 `stageModels.creative` 时行为与现在相同（回退文本默认）。

## Open Questions

无。
