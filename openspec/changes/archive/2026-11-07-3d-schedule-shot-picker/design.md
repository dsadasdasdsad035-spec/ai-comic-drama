# Design

## 决策

### 1. ShotPicker 对齐 EpPicker

- Portal 弹出列表、`aria-haspopup="listbox"`、方向键/Home/End/Esc。
- 选项文案：`镜 {no}` + 景别/运镜短标签 + 状态标签（来自 `resolveShotSchedule`）。
- 每项 `data-shot-id={id}`；当前选中镜在卡片根 `data-shot-id`。

### 2. 状态

- `selectedShotId`：`visible` 按镜号排序后默认第一项；`epNo` 变化时若 id 不在集内则重置为首镜。
- `editorShotId` 与 `selectedShotId` 独立：下拉只改浏览镜；点「打开」设 `editorShotId`。Overlay 打开时下拉切镜若 dirty → confirm → 关 overlay 再切。

### 3. 预演

- 首期保留 **「查看」** 链到 `schedule_video`（新窗口），不在卡片内嵌 video。

### 4. DOM 标识

- 删除 `.s3d-table`；卡片区域 `className="s3d-card"`，`data-shot-id` 供自动化。

### 5. 样式

- 复用 `epbar-trigger` / `epbar-panel` 模式，前缀 `shotbar-` 避免与集选择器冲突。

## 非目标

- URL 深度链接 `?shot=`（后续可加）
- 全集进度迷你表（B2）
