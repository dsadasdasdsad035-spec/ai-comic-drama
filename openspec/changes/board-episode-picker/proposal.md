# Proposal

## Why

画布当前把「选集」做成顶栏下拉，用户一进左栏「画布」就直接落在某一集的 React Flow 上，缺少以集为单位的目录感。产品期望：**先看到分集卡片墙（封面取自该集分镜首帧），点进某一集后再进入单集分镜工作台**；从左栏进入画布时**始终先展示集列表**，不因上次停留的集而跳过（用户已确认方案 1）。

## What Changes

- **画布两阶段**：`board` 视图拆为 **集目录** 与 **单集画布**；左栏点「画布」→ 集目录；点某一集卡片 → 单集 Flow + 原有工作台条/工具。
- **集卡片墙**：网格展示各集（`episodes[]` 与 `shots[].episode` 并集），每卡显示镜数、标题/目标时长、**封面**（该集按镜号排序后第一条有 `keyframe` 的镜头；无则首条有 `clip` 的可展示帧；再无则占位）。
- **顶栏集选择器**：在画布 **集目录** 阶段隐藏 `EpPicker`；在 **单集画布** 阶段用「返回集列表」换集，不在顶栏保留下拉换集（角色/素材等视图仍可用全局 `EpPicker`）。
- **概览分集行**：点某集仍 `setEpNo` 并进入 `board`，但 **先展示集目录**（可对应该集滚动/高亮）；用户再点卡片或约定为「概览点集 = 已明示选集」可直接进该集画布——本变更采用：**概览点集直接进入该集画布**（二次确认式选择），**仅左栏进画布强制先进目录**。
- **深链与恢复**：`#/p/<proj>/board` 打开为集目录；可选 `#/p/<proj>/board/E02` 或查询参数表示已在单集画布（实现细节见 design）。`localStorage` 的 `epNo` 仍记录编辑上下文，**不得**作为左栏进画布的自动跳过条件。

不做：

- 不改分镜数据模型与 `canvas-episode-source` 已落地的 id/`epNo` 不变式。
- 不把角色/素材改成同样的两阶段（除非后续单独立项）。
- 不引入 react-router；仍用 hash 路由扩展。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `canvas-shots-workbench`：集目录屏、封面规则、进入/退出单集画布、与 Agent/导入的作用域。
- `workbench-shell`：画布视图下全局带不再以 `EpPicker` 作为换集主入口；单集画布在上下文带展示当前集与返回目录。

## Impact

- **前端**：`App.tsx`（`boardPhase` 或路由段）、新 `BoardEpisodePicker.tsx`（或类似）、`AppShell`/顶栏条件渲染、`OverviewPage` 回调、`nav.ts`/`EPISODE_VIEWS`、样式 `theme.css`。
- **验收**：`verify-project-overview.mjs`、新增 `verify-board-episode-picker.mjs`；左栏进 board 断言无 Flow、点集后进 Flow。
- **冲突注意**：`workbench-shell`「单一集入口」需在画布目录阶段改为「目录为集入口、单集阶段上下文带显示集号」。
