# Design

## Context

动机见 `proposal.md`。现状约束：

- 顶栏 `view` 联合类型不含 3D；`PromptTable` 承载 3D 列、`editorShotId`、`LazySceneCodeWorkbench` overlay，以及 `projectShotNode` / `persist3D` / `shot3DSavePatch` 写回（`src/PromptTable.tsx`）。
- `App` 用 `promptEditorDirty` 在切换视图时阻止丢失 3D 编辑（`src/App.tsx` `changeView`）。
- `scene-blocking-3d` 与 README 仍写「入口在提示词」；验收脚本 `verify-prompt-3d-workbench.mjs` 从提示词进入。
- `SceneCodeWorkbench`、`sceneAgentGraph`、Blender 渲染、`resolveShotSchedule` 状态机可复用，不需改 ABI。

## Goals / Non-Goals

**Goals:**

- 顶栏「3D」视图：集内镜头表 + 状态 + 打开/查看，逻辑从 `PromptTable` 平移或抽取。
- `PromptTable` 去掉 3D 列与 overlay；表只保留提示词相关列。
- `App` 注册 `view === 'schedule3d'`，集切换与 `WorkbenchBar` 模式与其它表格式工作台一致。
- 离开保护：`schedule3dEditorDirty`（或重命名通用 `sceneEditorDirty`）在切视图/切项目时生效。
- 更新 README 与 Playwright 验收路径。

**Non-Goals:**

- 不新增 `workbench-chat-schedule3d`（agent 仍在 `SceneCodeWorkbench` 内）。
- 不恢复画布/Inspector 3D 入口；不恢复 `useScheduleVideoRef` 专用开关。
- 不把 3D 列表做成默认内嵌三栏（仍 overlay 打开，与现 UX 一致）。
- 不抽共享 npm 包；首期允许 `Schedule3DBoard` 与 `PromptTable` 少量重复加载逻辑，后续再收敛。

## Decisions

### 1. 新组件 `Schedule3DBoard` 承载列表 + overlay

从 `PromptTable` 剪切：`open3D`/`close3D`、`persist3D`、`editorNodes` 合成、`resolveShotSchedule` 列渲染、`onEditorDirtyChange`。

`Props` 对齐 `PromptTable` 中 3D 所需子集：`projectName`、`epNo`、`canvasNodes`、`assets`、`sceneLayouts`、`projectAspect`、`settings`、`onEditorDirtyChange`、`toast`；**不需要**提示词草稿、`mergePromptDraft`、生成提示词按钮。

被否方案：继续由 `PromptTable` 渲染隐藏 3D 列仅当路由为 3D——双重路由难维护。

### 2. 视图键 `schedule3d`，顶栏文案「3D」

插在「提示词」与「画布」之间，与 README 制作流水线顺序接近（写词 → 预演 → 画布）。

被否方案：`scene3d`——与 `sceneCode` stage 混淆；过长文案「3D 调度」挤顶栏。

### 3. 共享工具函数（可选小步）

若 `projectShotNode` / `baseShotData` 仅在两处使用，可挪到 `src/shot3dNode.ts`；否则首期复制到 `Schedule3DBoard` 以减少 diff 面（实现阶段二选一，以单文件 <400 行增额为界）。

### 4. 离开保护与脏状态

- `App`：`promptEditorDirty` 仅提示词表草稿；新增 `schedule3dEditorDirty` 由 `Schedule3DBoard` 上报。
- `changeView`：任一为 true 时 confirm，文案区分「3D 未保存」与「提示词未保存」。
- 卸载 `Schedule3DBoard` 时关闭 overlay，与现 `PromptTable` 行为一致。

### 5. 验收脚本

- 重命名或新增 `verify-schedule3d-workbench.mjs`：顶栏点「3D」→ 打开 → 保存/渲染冒烟。
- 原 `verify-prompt-3d-workbench.mjs` 改为断言提示词表**无** 3D 列，或删除并合并进新脚本。

## Risks / Trade-offs

- **[Risk] 顶栏再多一个 tab，窄屏更挤** → 沿用 `viewtabs` 现有省略/折行规则；标签用两字「3D」。
- **[Risk] 用户肌肉记忆「提示词里开 3D」** → README 与一次空态引导「预演请用顶栏 3D」；breaking 已在 proposal 标明。
- **[Risk] 抽取时漏掉画布节点合并** → 复用同一 `editorNodes` useMemo 逻辑；验收覆盖未上画布镜头 + 已连线镜头。

## Migration Plan

- 纯前端导航变更；`project.json` 字段不变。
- 部署后用户从顶栏进入；无数据迁移。
- 回滚：恢复 `PromptTable` 3D 列并移除顶栏按钮即可。

## Open Questions

（无——提示词表是否保留 3D 列已在 proposal 定为移除。）
