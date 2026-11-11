# Proposal

## Why

3D 调度已支持从本镜 `Shot3DContext` 选站内参考视频并做 VGGT 几何摘要，但走位参考常来自 **抖音/B 站分享链**，用户必须先去创意室摄取或手拷文件，断开了「粘链接 → 反推机位 → Blender」路径。创意侧已有成熟的 `ingest.mjs`（yt-dlp / DTK、SSRF 防护、适配器失败不静默回退），应在 **3D 工作台内** 提供等价摄取，落盘为 **项目内 URL** 后进入 `videoUrls`，再衔接既有 VGGT 与 Agent，且不得绕过调度真相边界。

## What Changes

- 新增 **镜头参考视频摄取**：在 3D 代码工作台（参考内容区 / 几何实验面板旁）支持粘贴平台链接、可选本地上传；服务端复用 `ingest.mjs` 适配器链，读取设置页 **创意 → 下载与摄取** 的 yt-dlp / DTK 配置（不在 3D 重复配置）。
- 下载产物写入 **`projects/<项目>/assets/`**，返回站内 `/project-assets/<项目>/<文件>`；成功后 **仅更新工作台草稿** 的 `Shot3DContext.videoUrls`（去重、遵守视频数量上限），须用户点「保存」才落库。
- 新增 API（示意）：`POST /api/shot-3d/ingest-reference`（`projectName`、`url` 或 `data`/`name`、`adapter?`）；失败返回与创意摄取一致的中文原因；**不**创建创意 session。
- UI：展示下载进度/来源元数据（平台、标题可选）；提供「下载后加入本镜参考」；下载完成后 **可** 一键跳转/提示运行 VGGT（仍调用既有 `/api/vggt/analyze`，不自动写 `sceneCode`）。
- 摄取失败、取消或部分成功 **不得** 写入或覆盖 `sceneCode`、`schedule_video`、`scheduleMeta`。
- 本变更 **不包含**：创意会话「导入已有源」、晋升项目联动、自动把 VGGT 报告写入 `buildSceneCodeContext`、自动 `pose(t)` / `run_render`（留 `vggt-reference-camera-poc` Phase 2 或后续 change）。
- 本变更 **修订** `shot-3d-context` 中「任意外链不得直接进入上下文」：平台/直链须经摄取端点转为项目内 URL 后方可选中；**禁止**把未摄取的 http(s) 字符串直接写入 `videoUrls`。

## Capabilities

### New Capabilities

- `shot-3d-reference-ingest`：项目镜头参考视频的链接摄取与本地上传、落盘契约、API 错误语义、与 3D 上下文草稿的衔接规则。

### Modified Capabilities

- `shot-3d-context`：允许经摄取产生的项目内视频 URL 进入选择；明确外链必须先摄取；摄取加入参考时遵守视频数量与上限场景。
- `scene-blocking-3d`：参考摄取与 VGGT 串联时仍不构成调度真相；摄取失败不破坏有效代码与调度视频。

## Impact

- 代码：`server/ingest.mjs`（抽取可复用 `ingestSource` 调用）、新 `server/shot3d-ingest.mjs` 或扩展 `vite.config.ts` 路由；`SceneCodeWorkbench.tsx` / `VggtGeometryPanel.tsx` / `Shot3DContextPicker`；`src/api.ts` 类型。
- 数据：仅 `project assets` + 镜头 `shot_3d_context.videoUrls`（保存后）；无新 SQLite 表。
- 设置：只读 `settings.creative.ingest`；文档说明与创意室共用 DTK/yt-dlp。
- 测试：`verify-shot-3d-reference-ingest.mjs`（mock 上传 + 路径断言 + 上下文上限 + 摄取失败不改 `sceneCode`）；复用 `verify-creative-ingest` 中 SSRF/适配器负例思路。
- 依赖：与创意室相同的本机/容器服务（DTK、yt-dlp）；无新 npm 包。
