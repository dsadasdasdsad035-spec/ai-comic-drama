# Tasks

## 1. 设置页创意环节默认

- [x] 1.1 在 `SettingsPage.tsx` 的 `STAGE_META` 增加 `creative` 行（标签、hint、空选项跟随文本默认），保存后 `stageModels.creative` 写入设置库；验证：设置页存在 `[data-stage-row="creative"]`，选模型保存后 reload 仍选中

## 2. App 接线

- [x] 2.1 `App.tsx` 向 `CreativeStudio` 传入 `onPickStage={pickStageModel}`；验证：`tsc --noEmit` 通过且 props 类型匹配
- [x] 2.2 `PublishBoard` → `PublishChatPanel` 传入 `onPickStage`（中间层透传）；验证：TypeScript 编译通过

## 3. 创意头部模型下拉

- [x] 3.1 `CreativeStudio` / `CreativeHeader` 嵌入 `StageModelSelect`（`stage="creative"`, `compact`），替换只读「模型 xxx」；验证：创意视图存在 `[data-stage-model-select="creative"]`，切换选项后 localStorage `storyboard-stage-model-pick` 含 `creative` 键且下一轮 `stageModelKey` 变化

## 4. 发布助手模型下拉

- [x] 4.1 `WorkbenchHeader` 增加可选 `modelSelect` prop，有则渲染于上下文条；验证：`SkillChat` 不传 prop 时 DOM 与改前一致（快照或手动对比五工作台之一）
- [x] 4.2 `PublishChatPanel` 传入 `StageModelSelect`（`stage="publish"`, `compact`）作为 `modelSelect`；验证：打开发布助手 dock 存在 `[data-stage-model-select="publish"]`，手选后下一轮请求 body 的 modelKey 对应所选键（Network 或 mock）

## 5. 回归与类型检查

- [x] 5.1 运行 `npm run build`（或 `tsc --noEmit`）与现有创意/发布相关脚本（若有 `verify-creative-ui.mjs` 则跑通）；验证：无编译错误，创意发送仍要求 `modelKey` 非空

## Workflow follow-up

- 规格归档：`openspec archive --change creative-publish-stage-model-select --yes`（按项目惯例在 review 后进行）
