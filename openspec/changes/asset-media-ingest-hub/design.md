# Design

## Context

- 摄取引擎：`server/ingest.mjs` + `ingestShot3dReference` 已写 `projects/<名>/assets/` 文件，返回 `/project-assets/...`；**当前未必**写入 SQLite `assets` 表。
- UI：`VggtGeometryPanel` 含链接输入 + 会话 `sources`；`SettingsPage` 在「创意会话」下展示 yt-dlp/DTK；`AssetBoard` 无顶层链接下载。
- 创意室：`verify-creative-ingest.mjs` 已拒绝 URL 摄取；几何页文案仍指向白模摄取。
- 用户确认：下载后在素材库为**视频素材**；几何列表**仅视频**；**不**默认自动发布画布卡。

动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 素材页一级「链接下载」+ 成功后刷新 `project.assets` 视频列表。
- 设置 UI 迁入「素材/媒体摄取」，文档与验收同步。
- 几何页主选源：`project.assets` 过滤 `video` + 既有「已渲染白模」来源。
- 后端：摄取成功时 **upsert** 一条 `assets` 行（标题来自 probe 文件名、平台 meta 或默认「链接下载」）。

**Non-Goals:**

- 迁移 `creative.ingest` JSON 路径（首期只挪 UI 与文案）。
- 几何页完全移除上传/直链（可收起到「高级」折叠）。
- 创意室重新开放平台链摄取。

## Decisions

### 1. API 表面不变，登记行为增强

**选择**：继续 `POST /api/shot-3d/ingest-reference`；在 `ingestShot3dReference` 返回前调用 `patchProject`/`saveProject` 逻辑追加 `assets` 条目（`kind: 'video'`，`url: videoUrl`，`title` 可截断）。

**备选**：新路由 `/api/assets/ingest-video` — 仅别名，增加维护面，不采用。

### 2. AssetBoard 面板位置

**选择**：在 `AssetBoard` 工具栏下或独立 `details-section` 增加 `AssetLinkIngestPanel`（与拆解/上传并列），复用 `ingestShot3dReference` from `api.ts`；成功后 `onProjectRefresh` 或父级 `patchProject` 合并 assets。

**备选**：放进镜头语言 tab 内 — 用户要求顶层素材页，不采用。

### 3. 几何页来源构造

**选择**：`SceneCodeWorkbench` 向 `VggtGeometryPanel` 传入 `projectAssetsVideo: { title, url }[]`（从 `project.assets` 过滤 + 站内 URL 规范化）；默认 `pick` 优先列表第一项；链接输入移入 `<details>`「高级：粘贴链接或上传」。

**备选**：仅会话内 `onIngested` 列表 — 无法看到素材页早先下载的视频，不采用。

### 4. 设置分区

**选择**：`SettingsPage` 新增「素材与媒体」小节，剪切现有 yt-dlp/DTK 表单项；`creative.ingest` 读写不变。页内互链：「下载请至素材页」。

### 5. 去重

**选择**：若 `assets` 已存在相同 `url`（标准化无 query），摄取成功时更新 `title`/时间戳而非重复插入。

## Risks / Trade-offs

- **[Risk] 双入口摄取**（素材页 + 几何高级）→ 文档标明主路径；验收以素材页为准。
- **[Risk] `verify-creative-settings` DOM 选择器** → 更新 `data-testid` 或稳定标题文案。
- **[Risk] 大文件列表刷新** → 摄取后只 patch assets，不全量重载项目。
- **[Trade-off] 未自动发画布卡** → 用户需用既有「发布素材卡」流；符合用户确认。

## Migration Plan

1. 先后端登记 `assets`，再素材 UI，再几何选源，再设置搬家。
2. 更新 `README.md`、`VggtGeometryPanel` / `CreativeComposerBar` 提示。
3. 扩展验收脚本后 `npm run build`。

回滚：UI 可特性开关隐藏素材面板；backend 登记为附加行为，不影响已有文件。

## Open Questions

（无 — 用户已确认视频类型与几何仅视频列表。）
