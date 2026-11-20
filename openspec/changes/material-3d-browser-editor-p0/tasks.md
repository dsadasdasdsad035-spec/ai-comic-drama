# Tasks

## 1. 依赖与分包

- [x] 1.1 添加 `@babylonjs/inspector`，版本与 `@babylonjs/core` 对齐；`vite.config.ts` 增加 `inspector` manualChunk；验证：`npm run build` 主包不含 inspector 字符串路径（目视 dist 产物名）
- [x] 1.2 实现 `inspectorPane.ts`：`showEmbeddedInspector(scene, hostEl)` / `hideInspector()`，懒加载且防重复 mount；验证：二次进入工作台不抛错

## 2. Gizmo 与选择

- [x] 2.1 实现 `gizmoSelection.ts`：创建 `GizmoManager`、按 `material3dObjectId` pick、`attachToMesh`、`onDragEnd` 输出 `Material3dTransform`；验证：`node tests/material3d-gizmo-logic.mjs` 或内联纯函数测试
- [x] 2.2 在 `syncSceneFromDoc.ts` 完成后支持 `onAfterSync` 回调以重挂 Gizmo；验证：加立板后可选中

## 3. 工作台 UI

- [x] 3.1 `Material3dWorkbench`：视口 pick + 侧栏列表选中联动；Gizmo 拖拽调用 `onSceneChange(..., immediate)`；验证：手动改 position 后 `getProject` 中对象 transform 变化
- [x] 3.2 侧栏增加「检视器」折叠区与 `data-m3d-inspector-host`；打开时调 `showEmbeddedInspector`；验证：选中 mesh 后属性区有内容（Playwright 可断言 host 子节点非空）
- [x] 3.3 全文检索场景三维 UI，移除/避免「Babylon Editor」文案；验证：`rg 'Babylon Editor' src/material3d AssetBoard` 无匹配

## 4. 验收

- [x] 4.1 扩展 `verify-material-3d-studio.mjs` 或新增 `verify-material-3d-gizmo.mjs`：建场景 → 加立板（若有设定则跳过）→ 列表选中 → 保存后刷新断言 `objects[0].transform` 存在且有限；验证：脚本 exit 0
- [x] 4.2 `npm run build` 与既有 `verify-material-3d-studio.mjs` 仍绿

## Workflow follow-up

- 归档前 `openspec validate material-3d-browser-editor-p0 --strict`；可与 `material-3d-studio-babylon` 一并归档顺序由人工决定。
- Node Material Editor、Blender 桥接另起 change。