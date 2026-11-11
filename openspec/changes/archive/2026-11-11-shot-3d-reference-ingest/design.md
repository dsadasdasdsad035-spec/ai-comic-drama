# Design

## Context

见 `proposal.md`。创意摄取实现在 `server/ingest.mjs`，路由绑定 `creatives/<sessionId>/sources/`（`vite.config.ts` `/api/creative/ingest`）。VGGT POC（`server/vggt.mjs`）已支持 `/project-assets/` 与 `VggtGeometryPanel`。`shot-3d-context` 原规范禁止任意外链直接进入 `videoUrls`，本变更改为 **摄取后站内 URL**。

## Goals / Non-Goals

**Goals:**

- 3D 工作台一条龙：粘抖音/B 站链接 → 项目 assets → 加入 `videoUrls` 草稿 → 用户保存 → 可选 VGGT。
- 零重复适配器逻辑；配置单点（`settings.creative.ingest`）。
- 摄取失败不影响调度真相。

**Non-Goals:**

- 创意会话列表导入（后续 change）。
- 自动 VGGT / 自动 `pose(t)` / 自动渲染。
- 新平台适配器（仅复用现有四种）。
- 把参考视频复制到 `public/videos/`（除非未来出片需要，本项目 assets 即可）。

## Decisions

### D1：落盘位置 = 项目 assets

**选择**：`saveProjectImage` 同级逻辑写视频到 `projects/<name>/assets/`，URL `/project-assets/...`。

**备选**：`public/videos/ref-*` —— 与项目生命周期不一致，gitignore 行为不同。

**命名**：`ref-<platform>-<timestamp>-<rand>.mp4`；probe 失败则整单失败并删文件。

### D2：摄取 API 形态

```http
POST /api/shot-3d/ingest-reference
{ "projectName", "shotId?", "url?" | "data?"/"name?", "adapter?" }
→ { ok, videoUrl, probe, meta? }
```

实现：`ingestSource(input, { sourcesDir: projectMediaDir, sourceId: ref-... }, settings.creative)` —— 将 `ingest.mjs` 的 `sourcesDir` 从 creative-only 泛化为任意目录（小 refactor）。

### D3：配置来源

读取 `getSettings().creative.ingest`（与创意室相同）。UI 在摄取失败时链到设置页「创意 → 下载与摄取」。

### D4：UI 位置

**选择**：`VggtGeometryPanel` 顶部或 `Shot3DContextPicker` 下方「下载参考视频」折叠区：URL 输入、上传、进度、成功后「加入本镜参考」+「分析几何」。

**不**改创意工作室布局（`creative-layout` 不变）。

### D5：上下文更新

前端：`setContextSafe` 追加 `videoUrls`（去重、校验 `SCENE_CODE_LIMITS.videos`）。标记 dirty，与现有指纹/过期逻辑一致。

### D6：与既有规范的衔接

MODIFIED `shot-3d-context` 的「外部地址」场景：拒绝 **未摄取** 外链，不拒绝 `/project-assets/`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 抖音仍 403/风控 | 文档与创意一致；失败文案指向 DTK/本地上传 |
| 大文件占项目盘 | 200MB 上限；可选未来清理未引用 assets |
| 摄取成功但未保存即关工作台 | 文件仍在 assets，上下文丢失；toast 提醒保存 |
| ingest refactor 影响创意 | 抽取 `runIngestToDir` 单测；创意路由不改行为 |

## Migration Plan

- 无数据迁移。旧镜头无新字段。
- 功能开关：无 Worker 时仅摄取仍可用；VGGT 仍依 `VGGT_WORKER_URL`。

## Open Questions

- 是否在摄取成功后默认勾选「加入参考」（默认 **否**，用户点确认，避免无意占视频槽）。
- Phase 2：从创意会话挑选已有 `source.file`（不写在本 change tasks 末尾 follow-up）。
