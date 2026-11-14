# Proposal

## Why

画布上的「集」同时来自顶栏当前集 `epNo`、节点 `data.episode`、`shotId`（`E01-S03`）以及 localStorage 里两套恢复路径。探索显示：卡片角标直接截取 `shotId` 前缀，过滤可见节点却用 `episode` 数字字段；切项目后 `wantedEp` 读项目画布存档，又可能被全局 `loadSavedEpNo()` 覆盖。用户容易看到「顶栏是 E02、卡片仍标 E01」或「换项目后回到错误的集」，且数据漂移时系统不自检。

## What Changes

- **统一「当前集」恢复**：打开项目时只从**该项目**画布 localStorage（`storyboard-canvas-v1:<项目名>`）恢复 `epNo`；移除或降级全局 `storyboard-canvas-v1` 对 `epNo` 的二次覆盖，避免跨项目串集。
- **卡片集标与数据一致**：分镜卡头上的集标签 SHALL 由 `data.episode`（或从 `shotId` 解析并与 `episode` 交叉校验）派生，而非单独截取 `shotId` 前缀且不校验。
- **漂移检测与修复**：水合或保存前，若 `shots[].id` 的 `E{nn}` 前缀与 `shots[].episode` 不一致，系统 SHALL 以 `episode` 为真源重建 `id`（或按既定规则一次修复并 toast），避免过滤与角标分裂。
- **切换集时的视图对齐**：用户改顶栏集时，画布过滤、`fitView` 焦点与集摘要 MUST 同步；不出现「当前集无卡但其他集节点仍被选中的错觉」（保持既有无 `shotId` 实验卡始终可见规则）。
- **文档化不变式**：在实现与 verify 中固定不变式：`id === E{pad(episode)}-{no}`（有正式业务 ID 的镜头）。

不做：

- 不改 `project.json` 顶层 schema（仍用 `shots[].episode` + `episodes[]`）。
- 不新增「跨集同屏编辑」或多集画布并排。
- 不重做 EpPicker UI；只修数据与展示语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `canvas-shots-workbench`：补充「当前集恢复」「可见镜头过滤」「卡片集标展示」与 `shotId`/`episode` 一致性的要求与场景。
- `project-context`：补充「每个项目的画布 UI 状态（含 `epNo`）独立持久化，不得用无项目键的全局存档覆盖」的要求。

## Impact

- **前端**：`src/App.tsx`（`epNo` 加载/保存、`loadSavedEpNo`）、`src/ShotNode.tsx`（`shot-ep` 展示）、`src/EpisodeBar.tsx`（行为不变或可补测试钩子）、`src/shotRows.ts` / `src/canvasShotOps.ts` / `rename` 路径（`id` 与 `episode` 同步）。
- **同步**：`src/shotSync.ts`（`shotToData` / 写回 project）、可选 `src/shotRows.ts` 校验辅助函数。
- **验收**：新增或扩展 `verify-canvas-shots-bar.mjs` / `verify-project-overview.mjs` 类脚本，覆盖切项目恢复集号、漂移修复、角标与 `epNo` 一致。
