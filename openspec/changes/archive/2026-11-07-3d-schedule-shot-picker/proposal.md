# Proposal

## Why

3D 调度页已改为调度域列、且故意不在表头展示镜号，整表扫镜成本高。用户期望 **镜号下拉 + 当前镜卡片** 的单镜工作台，顶栏导航与页内标题统一为「3D 调度」。

## What Changes

- 移除 `Schedule3DBoard` 的 `.s3d-table` 多行列表，改为 **镜号下拉（ShotPicker）+ 当前镜调度卡片**（状态、代码短码、运镜、预演查看、打开）。
- 顶栏 viewtabs：文案 **「3D」→「3D 调度」**（`title` 保留预演说明）。
- 上下文带去掉重复的 `ep-chip`（集号仅全局 EpPicker）；镜选择器放在 `WorkbenchBar` 范围段。
- 切镜/切集时：若 3D 工作台有未保存修改，沿用现有 `confirm` 后关闭 overlay。
- 新增 `ShotPicker`（行为对齐 `EpPicker`：portal、键盘、Esc）。
- 更新 `verify-schedule3d*.mjs` 等：不再依赖 `.s3d-table`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-blocking-3d`：「列表」改为「镜选择器 + 当前镜摘要」。
- `workbench-shell`：顶栏 3D 导航文案；3D 切集/切镜场景。

## Impact

- `src/Schedule3DBoard.tsx`、`src/ShotPicker.tsx`（新）、`src/App.tsx`
- CSS：`.s3d-card`、`.shotbar-*`（或复用 `epbar-*` 类）
- 多个 `verify-*.mjs` 使用 `.s3d-table` 的脚本
