## 1. UI

- [x] 1.1 新增 `ShotPicker.tsx`（对齐 `EpPicker` 交互）；选项含镜号、短状态、`data-shot-id`
- [x] 1.2 改写 `Schedule3DBoard`：镜下拉 + `s3d-card` 单镜摘要；移除 `.s3d-table` 与上下文 `ep-chip`；切镜 dirty confirm
- [x] 1.3 `App.tsx` 顶栏按钮文案「3D 调度」；切集时 reset 所选镜（经 `epNo` + board 内 effect）

## 2. 样式

- [x] 2.1 增加 `shotbar-*` / `s3d-card` 样式（可对照 `epbar-*`）

## 3. 验收

- [x] 3.1 更新 `verify-schedule3d-workbench.mjs`、`verify-schedule3d.mjs` 及依赖 `.s3d-table` 的脚本
- [x] 3.2 `npm run build`；`openspec validate 3d-schedule-shot-picker --strict` 退出码 0
