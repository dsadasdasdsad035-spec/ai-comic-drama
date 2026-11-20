# Tasks

## 1. 依赖与类型

- [x] 1.1 在 `package.json` 添加 `@babylonjs/core`、`@babylonjs/loaders`；验证：`npm install` 成功且 `npm run build` 通过
- [x] 1.2 新增 `src/material3d/material3dTypes.ts` 并在 `ProjectData`（`src/api.ts`）增加可选 `material3dScenes`；验证：`tsc --noEmit` 通过，旧项目 JSON 无字段时不抛错

## 2. 引擎封装

- [x] 2.1 新增 `src/material3d/createEngine.ts`：创建/销毁 `Engine`、`Scene`、默认 Arc 相机与地面网格；验证：单元或临时脚本 mount 后不泄漏（二次 mount 不报错）
- [x] 2.2 新增 `src/material3d/syncSceneFromDoc.ts`：从 `Material3dScene` 同步立板与 glTF 节点；验证：传入含 billboard + gltf 的样例 JSON 后场景节点数与类型符合预期
- [x] 2.3 新增 `src/material3d/billboardFromDesign.ts`：由 `DesignSheet` 与 `missing` 集创建立板或拒绝；验证：单测或内联断言无图/缺失时抛明确错误

## 3. 素材页集成

- [x] 3.1 扩展 `AssetBoard`：`MaterialTab` 含 `studio3d`，lazy 加载 `Material3dStudio`，未选项目禁用；验证：未进该 Tab 时 Network 无 babylon chunk（DevTools 目视或构建产物名）
- [x] 3.2 实现 `Material3dStudio` 列表（新建/重命名/删除场景）与 `patchProject` 保存；验证：刷新后列表仍在
- [x] 3.3 实现 `Material3dWorkbench`：轨道相机、侧栏添加设定卡立板与 GLB 资产、机位书签 CRUD；验证：保存后 `getProject` 中 `cameras` 与 `objects` 一致
- [x] 3.4 更新 `asset-tabs-hint`：区分场景三维编排 vs Blender 成片；验证：文案与 spec「与 Blender 分工」一致

## 4. 截图导出

- [x] 4.1 新增 `src/material3d/captureViewport.ts` 与上传登记 `project.assets`（不自动画布卡）；验证：导出后资产列表含新 PNG，`onAddAssetCard` 未被自动调用

## 5. 验收

- [x] 5.1 新增 `verify-material-3d-studio.mjs`：选项目 → 场景三维 Tab → 建场景 → 加书签 → 保存 → 刷新断言持久化；验证：`node verify-material-3d-studio.mjs` 全绿
- [x] 5.2 在 `README.md` 素材章节增加「场景三维」一句（若已有素材说明）；验证：描述与 Tab 行为一致

## Workflow follow-up

- 归档前运行 `openspec validate material-3d-studio-babylon --strict`。
- 实现完成后用 `/opsx-apply` 按本清单落地；Pi 工具与 VGGT 机位写回另起 change。