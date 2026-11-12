# Tasks

## 1. 数据与新鲜度

- [x] 1.1 `shotSync` / `types` / `api` 停止读写 `shot_3d_context`；保存时剥离字段；验证 `npm run test` 或 `node verify-schedule3d.mjs` 仍通过核心路径
- [x] 1.2 `sceneCodeFreshness` 移除 `contextFingerprint`/`selectionFingerprint` 比较；验证 `node verify-code-freshness.mjs`

## 2. 工作台 UI 与 VGGT

- [x] 2.1 删除 `Shot3DContextPicker` 与侧栏 `ctxOpen`；`VggtGeometryPanel` 独立挂载，源仅为 `schedule_video` + 会话摄取 URL；移除 `onAddReference` 与素材选择器；验证 Playwright/`verify-schedule3d-workbench.mjs`
- [x] 2.2 摄取仍调 `ingest-reference`，仅更新会话下拉；验证 `node verify-shot-3d-reference-ingest.mjs` 改写后通过
- [x] 2.3 清理 `theme.css` 参考选择器样式（`.ctxp` 等未用规则）

## 3. 生成与 Agent

- [x] 3.1 收缩或删除 `shot3dContextCatalog.ts`、`shot3dContext.ts`、`contextManifest.ts`；`sceneCodePrompt`/`prepareSceneCodeContext` 不再依赖 catalog；验证 `node verify-code-api.mjs`
- [x] 3.2 `SceneAgentChat` 去 `shot_3d_context` 投影，附件会话级；验证 `node verify-agent-chat-ui.mjs` 更新后通过

## 4. 文档与验收清扫

- [x] 4.1 更新 `README.md`、`docs/scene-agent-engine.md`、设置页文案（去掉 3D 参考板）；验证文档无 `shot_3d_context` 用户路径描述
- [x] 4.2 退役或改写 `verify-3d-context.mjs`；跑 `verify-schedule3d-workbench.mjs`、`verify-agent-chat-failure.mjs` 等相关脚本

## Workflow follow-up

- 实现完成并评审后归档 change，合并 delta 至 `openspec/specs/` 并删除 `shot-3d-context`、`shot-3d-reference-ingest` 主 spec。
- 使用 `/opsx-apply` 按本 tasks 实施。
