# Tasks

## 1. 服务端摄取

- [x] 1.1 从 `ingest.mjs` 抽取 `ingestSourceToDir(input, { dir, sourceId }, config)`，创意 `/api/creative/ingest` 行为不变；单测或 `verify-creative-ingest.mjs` 回归通过
- [x] 1.2 新增 `server/shot3d-ingest.mjs`：校验 `projectName`，落盘 `projectMediaDir`，返回 `projectMediaUrl` + probe
- [x] 1.3 在 `vite.config.ts` 注册 `POST /api/shot-3d/ingest-reference`，读取 `settings.creative.ingest`；错误中文与创意一致

## 2. 前端 API 与工作台

- [x] 2.1 在 `src/api.ts` 增加 `ingestShot3dReference` 类型与调用
- [x] 2.3 实现「加入本镜参考」：更新 `Shot3DContext.videoUrls` 草稿、去重、视频上限、`setContextSafe`

## 3. 规范与文档

- [x] 3.2 在 `docs/creative-studio.md` 加一句「3D 调度可共用摄取配置」（链到 ingest 文档）

## 4. 验收

- [x] 4.1 新增 `verify-shot-3d-reference-ingest.mjs`：mock 上传 → `/project-assets/` → 草稿 API 不写字段；失败路径不碰 `sceneCode`
- [x] 4.3 运行 `openspec validate shot-3d-reference-ingest --strict` 并通过

## Workflow follow-up

- 创意会话「导入已有源视频到镜头」另开 change。
