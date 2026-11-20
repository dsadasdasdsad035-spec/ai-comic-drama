# Proposal

## Why

「场景三维」工作台已能加立板/GLB 与机位书签，但无法在视口里**点选并拖拽**物体，也没有**现成属性面板**编辑 Transform；距离「纯浏览器场景编辑」（路线 C）差 Gizmo 与检视能力。用户明确不走桌面 Babylon Editor，也不在本阶段接 Blender，需在现有 Babylon 引擎壳上补齐 P0 交互与可选 Inspector 嵌入。

## What Changes

- 在工作台接入 **GizmoManager**：对场景内用户对象支持平移/旋转/缩放；拖拽结束将 `transform` 写回 `material3dScenes.objects[]` 并持久化。
- **点选与高亮**：视口点选与侧栏对象列表联动；单选为默认，记录 `selectedObjectId`（会话内，可不进 project JSON）。
- **嵌入属性面板（P0）**：按需懒加载 `@babylonjs/inspector`（与 `@babylonjs/core` 版本对齐），`embedMode` + `showExplorer: false` + `showInspector: true`，挂载于工作台侧栏宿主；选中对象后展示官方属性网格。
- UI 文案统一为「场景三维 / 检视器」，**禁止**出现「Babylon Editor」字样（避免与桌面 Editor 混淆）。
- 扩展 `verify-material-3d-studio.mjs`（或兄弟脚本）覆盖：进入工作台 → 选中/Gizmo 改 transform → 刷新后 transform 仍在。
- **不**引入 `@babylonjs/node-editor`、桌面 Editor 桥接、Blender 同步（留后续 change）。

## Capabilities

### New Capabilities

- （无）能力边界仍为 `material-3d-studio`，本变更在其上扩展行为。

### Modified Capabilities

- `material-3d-studio`：新增视口 Gizmo 编辑、对象选择、Transform 持久化、可选嵌入式 Inspector 属性面板的规范性要求。

## Impact

- **前端**：`src/material3d/Material3dWorkbench.tsx`、`syncSceneFromDoc.ts`、新增 `gizmoHost.ts` / `inspectorPane.ts`（命名以实现为准）。
- **依赖**：`@babylonjs/inspector`（dev 或 dependencies，须与 core 同主次版本）；Inspector 单独 vite manualChunks。
- **数据**：`Material3dObject.transform` 为 Gizmo 真相源；可选不落库 `selectedObjectId`。
- **验收**：`verify-material-3d-studio.mjs` 增补或 `verify-material-3d-gizmo.mjs`。
- **Non-Goals**：Node Material Editor、粒子/GUI Editor、Pi Agent 工具、Blender 出片。