# Tasks

## 1. 导航与外壳

- [x] 1.1 在 `App.tsx` 增加 `schedule3d` 视图、顶栏「3D」按钮（提示词与画布之间），并渲染 `Schedule3DBoard`；验证切换视图后 URL/状态与集选择器仍正常
- [x] 1.2 拆分 `promptEditorDirty` 与 `schedule3dEditorDirty`，在 `changeView`/切项目时分别提示；验证 3D overlay 脏时切换视图会拦截

## 2. Schedule3DBoard

- [x] 2.1 新建 `src/Schedule3DBoard.tsx`，从 `PromptTable` 迁移镜头加载、集过滤、`resolveShotSchedule` 列表、`editorNodes` 合成与 `SceneCodeWorkbench` overlay
- [x] 2.2 接入 `WorkbenchBar`（重新加载等），无提示词生成按钮；验证未上画布镜头可打开并 `shot3DSavePatch` 只写 3D 字段

## 3. 提示词工作台瘦身

- [x] 3.1 从 `PromptTable` 删除 3D 列、`editorShotId`、overlay 与 `onEditorDirtyChange` 的 3D 用途；验证表头仅剩提示词相关列且生成提示词流程无回归

## 4. 文档与验收

- [x] 4.1 更新 `README.md` 中「3D 调度（提示词工作台）」为顶栏 3D 视图说明
- [x] 4.2 调整或新增 Playwright：`verify-schedule3d-workbench.mjs`（顶栏进入 + 打开保存）；更新引用提示词 3D 入口的脚本；验证 `node verify-schedule3d-workbench.mjs` 退出码 0
- [x] 4.3 运行 `openspec validate 3d-schedule-top-level-view --strict` 退出码 0

## Workflow follow-up

- 实现完成并经 review 后归档 change，合并主 spec。
