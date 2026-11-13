# Proposal

## Why

平台链接下载（抖音 / B 站等）与参考视频落盘目前藏在「素材 → 白模 → 几何」里，与「素材库」心智不一致；用户在几何页重复粘贴链接才能做 VGGT，而项目里往往已有同一段视频文件。需要把**下载收敛到素材页一级入口**，**几何只做选项目内视频 + 分析**，并在设置里把摄取配置归到素材/媒体语境。

## What Changes

- **素材页（`AssetBoard`）**：顶层「链接下载」面板，粘贴平台或直链 → 复用 `POST /api/shot-3d/ingest-reference` / `ingest.mjs` → 落盘为**视频素材**（项目 assets 目录 + 在 `project.assets` 中登记 `kind: video` 或等价视频类型）；**默认不自动发布画布素材卡**（除非用户另行点发布）。
- **设置页**：将「平台链接下载（yt-dlp / DTK）」UI 从「创意会话」迁到「素材 / 媒体摄取」分区；文案说明下载在素材页、几何在白模；配置键 **可继续** `settings.creative.ingest` 以避免迁移（实现期可选别名展示）。
- **白模「几何」页（`VggtGeometryPanel`）**：**主路径**从 **`project.assets` 中仅视频** 列表选择 `videoRef` 提交 VGGT；平台链接输入与上传降为次要/高级（或移除主文案）；不再把几何页描述为唯一下载入口。
- **规范与验收**：更新 `shot-3d-reference-ingest` 入口要求；扩展 Playwright/Node 验收覆盖素材页摄取 + 几何选视频；`README` / 创意室提示与 `verify-creative-settings.mjs` DOM 断言随设置分区调整。

不在本变更：

- 不改创意室 `/api/creative/ingest` 已拒绝平台链接的行为。
- 不自动把下载结果写入 `sceneCode` / 镜头 `shot_3d_context` / 白模 `video` 字段（与现规一致）。
- 不新增除既有适配器外的下载后端。

## Capabilities

### New Capabilities

- `asset-platform-video-ingest`：素材页平台链接下载、视频素材登记、空项目/无配置错误态与用户可见结果。

### Modified Capabilities

- `shot-3d-reference-ingest`：主 UI 入口改素材页；几何页消费项目视频列表；设置段文案与摄取配置展示位置。

## Impact

- **前端**：`AssetBoard.tsx`、`SettingsPage.tsx`、`VggtGeometryPanel.tsx`、`SceneCodeWorkbench.tsx`（传参/刷新 assets）、`api.ts`、`README.md`。
- **后端**：`shot3d-ingest.mjs` 或 API 层在成功摄取后 **append** `project.assets` 视频条目（不破坏现有仅写盘行为）；复用 `ingest.mjs`、SSRF、200MB 上限。
- **验收**：`verify-shot-3d-reference-ingest.mjs`、`verify-creative-settings.mjs`、新建或扩展 `verify-asset-platform-ingest.mjs`（素材 UI + 几何选片）。
- **BREAKING（验收/文档）**：依赖「几何页为唯一摄取入口」的 E2E 或 README 需改指向素材页。
