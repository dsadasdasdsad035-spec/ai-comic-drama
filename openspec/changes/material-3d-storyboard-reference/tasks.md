# Tasks

## 1. 数据模型与同步

- [x] 1.1 扩展 `material3dTypes.ts`：`environment`、`label`/`locked`、`billboardSize` 与默认值；验证 `tsc --noEmit` 通过
- [x] 1.2 `syncSceneFromDoc.ts` 应用 `billboardSize` 与 `environment`（地面/背景/光）；验证现有 `tests/material3d-billboard.mjs` 仍通过
- [x] 1.3 `createEngine.ts` 支持从 scene doc 初始环境读取（或 workbench mount 后 apply）；验证打开带 environment 的场景色与默认场景区分

## 2. 变换与对象属性 UI

- [x] 2.1 新增变换面板组件（度↔弧度、position/rotation/scale）；与 Gizmo `onTransformEnd` 双向同步并 `patchProject`；验证数字改 X 后刷新一致
- [x] 2.2 层级 Tab：label 输入、锁定开关；锁定对象 pick 无 Gizmo；验证 Playwright 或手测
- [x] 2.3 立板选中时显示宽高字段；验证刷新后平面比例一致

## 3. 场景预览 Tab

- [x] 3.1 侧栏新增「场景」Tab + 环境表单（背景、地面、灯光滑块）；写入 `material3dScenes.environment`；验证重进工作台设置仍在
- [x] 3.2 检视器区添加「不保存到项目」说明文案；验证展开检视器可见

## 4. 机位导出

- [x] 4.1 实现 `exportStoryboardMarkdown` / 剪贴板按钮；验证剪贴板含机位标签与对象行
- [x] 4.2 实现 JSON 下载（`schemaVersion` + `purpose`）；验证文件 `cameras` 与 DB 一致
- [x] 4.3 扩展 `verify-material-3d-studio.mjs`：保存机位 → 导出 JSON 或改 transform → 刷新断言

## Workflow follow-up

- 实现完成后用 `openspec validate --change material-3d-storyboard-reference` 检查 artifacts。
- 用户确认后再 `openspec archive` 并同步主 spec（若 `material-3d-studio` 尚未归档则与其他 change 一并处理）。