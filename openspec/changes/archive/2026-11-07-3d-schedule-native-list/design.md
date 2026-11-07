# Design

## Context

动机见 `proposal.md`。`Schedule3DBoard` 当前表列为镜号/出场/场次/状态/操作（`src/Schedule3DBoard.tsx`），从 `PromptTable` 迁移时带入。

## Goals / Non-Goals

**Goals:**

- 表头五列：**状态 | 代码 | 运镜 | 预演 | 操作**。
- 代码列：`scene_code_meta.fingerprint?.codeHash` 或 `scene_code.code_hash` / 顶层 `scene_code` 内 `codeHash`——以 `shotToData` + `ProjectShot` 现有字段为准，取前 6–8 位或项目惯用短码；无代码显示「无代码」。
- 运镜列：`motion_note` 单行 `ellipsis`，空为 `—`。
- 预演列：有 `schedule_video` 时「查看」链接（新窗口）；无则 `—`。
- 操作列：仅「打开」；查看若已在预演列则操作列不重复（或预演列专责查看、操作列仅打开——**采用：预演=查看，操作=打开**）。
- `<tr data-shot-id={s.id} title={可选 s.no}>`。

**Non-Goals:**

- 不在列表内嵌 MP4 `<video>` 播放器（保持链接查看）。
- 不恢复镜号列；不增加描述/提示词列。
- 不改 `SceneCodeWorkbench` 布局。
- 移除 `onCanvas` 圆点展示；`onCanvas` prop 可保留供日后过滤，本变更可从表内删除圆点即可。

## Decisions

### 1. 代码摘要来源

优先 `s.scene_code_meta?.fingerprint?.codeHash`（若 snake_case `scene_code_meta`），否则 `scene_code.codeHash`，否则「无代码」。与 `resolveShotSchedule` 用的 `shotToData` 一致，避免列表与状态判定两套哈希。

### 2. 验收定位

`verify-3d-render-asset-flow.mjs`：`locator(\`tr[data-shot-id="${shot.id}"]\`)` 替代 `hasText: shot.no`。

`verify-schedule3d-workbench.mjs`：可增加断言表头无「镜号」「场次」；打开仍可用 `tbody tr.first()` 或 `data-shot-id`。

### 3. `castOf` 与 `parseDialogue` 导入

删除 `castOf` 后，若 `parseDialogue`/`dialogueToText` 仅服务于 `baseShotData`，保留；否则清理未用导入。

## Risks / Trade-offs

- **[Risk] 无镜号列时人工对镜困难** → 行 `title` 含镜号；工作台顶栏仍有镜号。
- **[Risk] 多镜无代码时列表相似** → 依赖状态与运镜/哈希区分；可接受。

## Migration Plan

纯 UI；无数据迁移。

## Open Questions

（无）
