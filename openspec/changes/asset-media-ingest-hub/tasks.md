# Tasks

## 1. 摄取 API 登记视频素材

- [x] 1.1 `shot3d-ingest.mjs` 成功写盘后向项目 `assets` 追加/更新 `kind: video` 条目（URL 去重）；`node verify-shot-3d-reference-ingest.mjs` 断言 `readProject` 含视频 asset
- [x] 1.2 `vite.config.ts` 路由层确认仍透传 `creative.ingest`；摄取失败路径不写 `assets`

## 2. 素材页链接下载 UI

- [x] 2.1 新增 `AssetLinkIngestPanel`（或内联块）挂于 `AssetBoard` 主区：URL 输入、状态、错误；调用 `ingestShot3dReference` 后刷新 project
- [x] 2.2 无项目时空态/禁用；成功 toast 与视频素材列表可见；`theme.css` 样式与 `npm run build` 通过
- [x] 2.3 新建 `verify-asset-platform-ingest.mjs`：Playwright 或 API+DOM 测素材页摄取 mock/上传 fixture

## 3. 设置页摄取分区

- [x] 3.1 `SettingsPage` 将 yt-dlp/DTK 迁至「素材/媒体摄取」；创意会话区去掉重复入口并链到新材料区
- [x] 3.2 更新 `verify-creative-settings.mjs` 选择器与摄取用例；`README.md` 下载入口描述改为素材页

## 4. 几何页选项目视频

- [x] 4.1 `App.tsx`/`SceneCodeWorkbench` 传 `project.assets` 视频列表至 `VggtGeometryPanel`；过滤非视频
- [x] 4.2 几何 UI：主下拉为项目视频 + 已渲染条目；链接/上传收入「高级」；默认不强调粘贴平台链
- [x] 4.3 扩展 `verify-shot-3d-reference-ingest.mjs` 或 `verify-vggt-poc.mjs`：几何选已登记视频提交 analyze（mock worker 即可）

## 5. 文案与回归

- [x] 5.1 更新 `CreativeComposerBar`、`VggtGeometryPanel` 提示指向素材页下载
- [x] 5.2 `node verify-all.mjs` 子集（creative-settings、shot3d-ingest、asset-platform）+ `openspec validate asset-media-ingest-hub --strict`

## Workflow follow-up

- 实现完成后运行 `/opsx-apply`；验收通过后 `openspec archive asset-media-ingest-hub` 并 sync 主 spec。
