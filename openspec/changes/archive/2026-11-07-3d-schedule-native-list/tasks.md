# Tasks

## 1. 列表 UI

- [x] 1.1 改写 `Schedule3DBoard` 表头与行：状态、代码、运镜、预演、操作；移除镜号/出场/场次/画布点；每行 `data-shot-id`；可选 `title` 镜号
- [x] 1.2 实现代码短码与运镜展示逻辑；删除 `castOf` 及无用导入；`npm run build` 通过

## 2. 验收与文档

- [x] 2.1 更新 `verify-schedule3d-workbench.mjs`（断言无镜号/场次列）；`verify-3d-render-asset-flow.mjs` 用 `data-shot-id` 定位行
- [x] 2.2 运行 `APP_URL=… node verify-schedule3d-workbench.mjs` 退出码 0；`openspec validate 3d-schedule-native-list --strict` 退出码 0
- [x] 2.3 README 3D 视图列表一句改为「调度域列」描述（若 README 仍写镜号列表）
