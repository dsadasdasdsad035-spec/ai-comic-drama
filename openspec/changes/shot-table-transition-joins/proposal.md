# Proposal

## Why

转场的「画面与过渡」「声音描述」与生成策略目前只存在于画布连线的 `transitionOut`，镜头表与 `shotlist` Agent 不产出接缝内容，导致规划阶段无法批量写六类电影级转场（场景/人物/空间/特效/运镜/AI 首尾帧），也与 video-shotcraft 的接缝词汇脱节。需要在播放序列的每一对相邻镜上提供可编辑接缝行，并由独立 Agent 阶段写入与画布共用的持久化字段。

## What Changes

- **镜头表接缝行（选项 A）**：本集按播放顺序在每对相邻镜之间显示一行接缝 UI（含硬切）；硬切默认可折叠摘要，展开后可升级为效果/生成转场。接缝行读写源镜 `transitionOut`（`to` = 下一镜 shotId），不新增 shot 实体行。
- **字段对齐**：接缝行暴露与转场面板同构的核心字段：`relation`（cut/transition）、`mode`（effect/generated）、效果预设/时长、生成的 `prompt`/`soundPrompt`/`targetSeconds`/`taxonomy`/`recipeIds`；完整出片正文仍走现有 `effectiveTransitionVideoPrompt` 与 override 规则。
- **transition-planner 技能**：镜头表（或专用工作台）聊天新增阶段技能与 `submit_joins`（`joins-v1` 契约），在 `shotlist` 之后为本集相邻镜批量写接缝；不触发出片 API。
- **食谱索引扩展**：`transitionRecipes` 从 video-shotcraft 增量同步至 40+ 条，增加 `taxonomy`、`modeHint`、`seedanceHints`；Agent 引用 `recipe_id` 而非 Remotion 实现。
- **同步规则**：插删镜、改镜号时自动维护接缝行；非相邻画布边在表中灰显「未参与成片」。接缝与画布转场面板双向编辑同一 `transitionOut`。
- **出库范围**：不 bundled shotcraft 仓库；不实现 Remotion 导出；不在此变更内重写 `shotlist` 单次输出 joins（保持两阶段）。

## Capabilities

### New Capabilities

- `shot-table-transition-seams`：镜头表相邻镜接缝行展示、编辑、与 `transitionOut` 同步及硬切/转场默认可折叠行为。

### Modified Capabilities

- `shot-transition-agent`：新增 `transition-planner` 技能、`joins-v1`/`submit_joins`、六类 `taxonomy` 与食谱引用要求；接缝建议可写入镜头表草稿（确认/保存语义与工作台一致）。

## Impact

- **前端**：`ShotTable.tsx`、接缝子组件、与 `TransitionPanel` 字段复用或共享 hook；`project.json` / `shotSync` 无新顶层字段（仍 `transition_out`）。
- **Agent**：`skills/transition-planner/SKILL.md`、`src/skills/contracts.ts`（`joins-v1`）、`src/skills/tools.ts`、`workbenchChat` 路由；设置页环节模型可选绑定。
- **数据**：`transitionRecipes.json`、同步脚本或文档；`verify-transitions.mjs` / 新增 `verify-joins.mjs` 或扩展现有验证。
- **Spec**：新建 `shot-table-transition-seams`；delta `shot-transition-agent`。
