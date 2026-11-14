# Design

## Context

- 画布「当前集」：`App.tsx` 的 `epNo`；过滤 `shownNodes` 用 `Number(n.data.episode)||1 === epNo`。
- 卡头 `.shot-ep`：`ShotNode.tsx` 显示 `shotId.split('-')[0]`，与 `episode` 无校验。
- 持久化：项目画布 key `storyboard-canvas-v1:<encodeURIComponent(projectName)>` 已写入 `epNo`（`App.tsx` ~3391）；加载项目时用 `stored?.epNo`（~741）。挂载另起 `loadSavedEpNo()` 读 **全局** `STORAGE_KEY` 且 `saved > 1` 时覆盖（~805–808）。
- 真源：`project.shots[]` 的 `episode` + `id`（`shotRows.blankShot` 同时写 `E{ep}-{no}`）。

见 `proposal.md` 动机。

## Goals / Non-Goals

**Goals:**

- 单一恢复路径：打开项目 → `wantedEp` 仅来自该项目画布存档 ± 合法钳制。
- 展示与过滤一致：卡头集标 = `formatEpisode(data.episode)`。
- 写路径维持 `id` 不变式；读路径可一次修复漂移并 `persistProjectShots`。

**Non-Goals:**

- 不改 EpPicker 视觉或集列表合并逻辑。
- 不做跨集批量改 `episode` 的产品化 UI（仅随改镜号/导入/Agent 路径修复）。
- 不迁移历史 global `epNo` 到新项目（除删除 `loadSavedEpNo` 覆盖行为外）。

## Decisions

### 1. 移除全局 `loadSavedEpNo` 对 `epNo` 的覆盖

**选择**：删除 mount 时 `loadSavedEpNo()` effect，或改为仅在 **无项目** 且读全局演示画布时使用（当前产品路径几乎不依赖）。

**备选**：合并 global `epNo` 进项目迁移 — 拒绝，易再次串项目。

### 2. 卡头集标

**选择**：`episodeLabel(ep: number) => 'E' + pad(ep)`；`ShotNode` 用 `data.episode ?? parseEpisodeFromShotId(data.shotId) ?? 1`，**展示以 `data.episode` 为准**。

**备选**：继续只显示 `shotId` 前缀 — 拒绝，是漂移根因之一。

### 3. `id` 不变式 helper

**选择**：在 `shotRows.ts`（或相邻模块）增加：

- `canonicalShotId(episode: number, no: string): string`
- `reconcileShotId(s: ProjectShot): ProjectShot` — 若 `id` 前缀与 `episode` 不符则返回修正副本

调用点（最小集）：

- `shotToData` / 水合前对 `projectShots` 批量 reconcile（仅内存 + 可选写回）
- `renameShotNo`、改 `episode`（若有）、`planAddShot` / `blankShot`（已一致，断言即可）
- 导入 merge 完成后对当前集 shots 跑一遍

**备选**：只修 UI 不写回 `id` — 拒绝，Agent/导出仍用错误 `id`。

### 4. 写回时机

**选择**：reconcile 发现变更时 `persistProjectShots` + 更新 `syncedRef` + 轻量 toast「已修正 N 条镜头 id 与集号不一致」。

**备选**：静默修复 — 不利于排查历史坏数据。

### 5. 验收

**选择**：扩展 `verify-project-overview.mjs` 或新增 `verify-canvas-episode.mjs`：

- 两项目不同 `epNo` 存档，切换断言不串
- fixture 一条 `id: E01-S01, episode: 2`，打开画布后期望 id 修正或标签 `E02`

## Risks / Trade-offs

- **[Risk] 自动改 `id` 打断外部引用** → 仅改 `project.shots` 与画布 `shotId`；`transition_out.to` 本就存 shot id，reconcile 须同一事务更新指向（若 id 变化则 remap）。
- **[Risk] 大批量 reconcile 首次打开慢** → 只在检测到 mismatch 时写盘；正常项目零开销。
- **[Trade-off] 删除 global epNo 恢复** → 极少数只用过全局 key 的老用户丢「上次集号」，但项目 key 已有 `epNo`。

## Migration Plan

1. 实现 helper + ShotNode 展示 + 去掉 global 覆盖。
2. 项目加载后对 shots 跑一次 reconcile（写回仅当 dirty）。
3. 跑 verify；手工：两项目切集、漂移 fixture。

回滚：还原 `App.tsx` effect 与 ShotNode 一行展示即可，reconcile 为幂等增强。

## Open Questions

- 是否存在「只改 `shotId` 不改 `episode`」的 API 路径（Agent tool）需在 reconcile 前统一审计 — 实现 tasks 时用 grep `shotId` / `patchProjectShots` 扫一遍即可，不阻塞 propose。
