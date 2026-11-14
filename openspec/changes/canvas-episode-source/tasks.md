# Tasks

## 1. 集号不变式与工具函数

- [x] 1.1 在 `shotRows.ts`（或同级模块）实现 `canonicalShotId`、`episodeFromShotId`、`reconcileShotRow(s)`；单测或 `node --import` 小段断言 `E02-S03` ↔ episode 2
- [x] 1.2 导出 `formatEpisodeLabel(ep: number)` 供 UI 使用；验证与 `blankShot` 生成格式一致

## 2. 当前集恢复（App）

- [x] 2.1 删除或收紧 `loadSavedEpNo()` 在 mount 时对 `epNo` 的覆盖，确保打开项目仅使用 `loadProjectSaved` 的 `wantedEp` + 钳制；验证：项目 A/B 各存不同 `epNo`，切换不串
- [x] 2.2 确认 autosave 仍写 `epNo` 到 `projectCanvasKey(projectName)`；验证 localStorage JSON 含正确 `epNo`

## 3. 卡片集标（ShotNode）

- [x] 3.1 `ShotNode` 卡头集标改用 `formatEpisodeLabel(data.episode ?? …)`，不再裸 `split('-')[0]`；验证：手工 fixture `episode:2` + `id:E01-*` 显示 `E02`

## 4. 漂移修复写路径

- [x] 4.1 项目加载后、导入 merge 后、改镜号路径对 `projectShots` 跑 reconcile；有变更时 `persistProjectShots` 并同步节点 `shotId`；验证：漂移 fixture 打开后 `id` 变为 `E02-*`
- [x] 4.2 若 `id` 变更，更新指向该 id 的 `transition_out.to`（扫描同集 shots）；验证：转场仍指向正确镜

## 5. 验收脚本

- [x] 5.1 新增或扩展 `verify-canvas-episode.mjs`（或并入 `verify-project-overview.mjs`）：两项目 `epNo`、漂移 id 两条场景；`node verify-*.mjs` 退出码 0
- [x] 5.2 `npm run build` 通过

## Workflow follow-up

- 实现完成后运行 `openspec validate canvas-episode-source --strict`，再归档此变更。
