# Proposal

## Why

3D 调度今天嵌在「提示词」表格的一列里，专职做预演/blocking 的用户要先进入写提示词的上下文，才能看到全集调度进度并打开 Blender 工作台。顶栏已有镜头表、提示词、画布等多张制作台，3D 作为独立工种值得有自己的视图，同时继续禁止画布/Inspector 分散入口。

## What Changes

- 顶栏新增项目视图 **「3D」**（位于「提示词」与「画布」之间），提供按集的镜头列表：镜号、场次/出场摘要、调度状态（未渲染 / 生效 / 仅审阅 / 已过期）、预览/查看与「打开」进入现有 `SceneCodeWorkbench`。
- 从 `PromptTable` **移除**「3D」列及 overlay 承载逻辑；3D 保存、合成画布节点、`shot3dPatch` 写回迁至新视图组件。
- **BREAKING（导航习惯）**：不再从提示词工作台打开 3D；文档与验收脚本中的路径改为顶栏「3D」。
- 保持：画布右击与 Inspector 仍无 3D 入口；渲染 MP4 仍进 `public/videos`、仍可作为普通视频素材连线出片；Blender/agent/三栏工作台行为不变。
- 本变更 **不** 新增工作台外层 SkillChat、不恢复 3D 专用出片参考开关、不改变提示词生成技能。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-blocking-3d`：主入口从提示词工作台改为顶栏 3D 视图；状态/预览展示位置随之迁移；「从提示词打开且不误覆盖提示词草稿」改为「从 3D 视图保存只写 3D 字段」的表述与场景。
- `workbench-shell`：集切换与项目视图列表纳入「3D」。

## Impact

- `src/App.tsx`：`view` 联合类型、顶栏按钮、路由分支、离开保护（`editorDirty` 从提示词侧迁移或拆分）。
- 新建 `src/Schedule3DBoard.tsx`（或同等命名）：自 `PromptTable` 抽取 3D 列表、节点合成、`SceneCodeWorkbench` overlay。
- `src/PromptTable.tsx`：删 3D 列与相关 state/callbacks；宽度与表头简化。
- `README.md`、`verify-prompt-3d-workbench.mjs` 及引用「提示词 → 3D」的 agent 验收脚本。
- OpenSpec 主 spec 归档时合并 `scene-blocking-3d`、`workbench-shell` delta。
