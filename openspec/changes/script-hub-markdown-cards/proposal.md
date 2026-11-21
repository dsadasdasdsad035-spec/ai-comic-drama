# Proposal

## Why

项目曾移除独立剧本页后，分集大纲的列表、导入与阅读被挤进画布「分集目录」，与分镜混在同一卡片墙；详情用自定义时间线而非可对照的 Markdown，也与 `parseScriptMarkdown` / 分镜导出的文档形态脱节。用户需要以「剧本」为一等创作视图：卡片总览各集、详情以 MD 预览阅读，画布只保留分镜与深链。

## What Changes

- **BREAKING（导航）**：左栏恢复独立视图 `script`（剧本），与概览、创意、素材、画布并列；hash 路由支持 `#/p/<proj>/script` 与 `#/p/<proj>/script/E02`。
- 新增 **剧本中心**：分集卡片墙（搜索、状态徽标、镜数只读）、工具条「导入剧本大纲」；点卡片进入集详情。
- 集详情以 **Markdown 预览** 为主：「剧本」tab 展示 short-drama 格式 MD（由 `episodes` 渲染）；「分镜」tab 只读展示现有 `episodeMarkdown` 输出；底栏「进画布」深链。
- **P0 不改结构化表单**：剧本内容仍经 **导入 MD** 与 **创意 Agent `submit_episodes`** 写回；详情不提供场次表单或 MD 源码双向编辑。
- **画布集目录瘦身**：主入口「导入剧本大纲」「看剧本」详情迁出；卡片保留剧本状态 chip，点击跳转剧本中心对应集；工具条去掉剧本导入分组或改为深链说明。
- 新增纯函数 **`buildScriptEpisodeMarkdown`**，与 `parseScriptMarkdown` 互逆，供预览与复制。
- 更新 `README` 与验收脚本：剧本导航、深链、画布分工。

不做（本变更）：

- 恢复 `ScriptBoard` 场次手改表单或 `scriptDirty` 显式保存流。
- 剧本视图独立 `WorkbenchSurface` / 内置「生成分集」聊天（仍走创意专家）。
- 剧本 MD 批量 zip 导出（可后续 P1）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `script-workbench`：从「已删除的表单工作台」改为「剧本中心卡片墙 + 集详情 MD 预览 + 导入/Agent 写回」契约。
- `workbench-shell`：左栏导航与面包屑含剧本视图；剧本视图上下文带与画布集目录职责划分；集选择器在剧本详情阶段的 behavior。
- `canvas-shots-workbench`：集目录以分镜为主；剧本导入/详情主战场迁出；深链至剧本中心。
- `project-context`：上次视图记忆与路由白名单包含 `script`。

## Impact

- **前端**：`src/shell/nav.ts`、`App.tsx` 路由、`ScriptEpisodeHub`（新）、`ScriptEpisodeDetail`（新）、`buildScriptEpisodeMarkdown`（新）、重构/共享 `BoardEpisodeGrid` 卡片逻辑；画布 `BoardEpisodeGrid` / `EpisodeScriptDetailDialog` 收缩或删除主路径。
- **样式**：`theme.css` 剧本中心与 `script-md-preview` prose；复用 `board-ep-*` 时可抽共享 token。
- **测试**：`verify-script-markdown-import.mjs` 扩展 round-trip；新增 `verify-script-hub.mjs`（导航、深链、预览 DOM）。
- **文档**：`README.md` 制作流程中「剧本」一节与画布分工。
- **OpenSpec**：`script-workbench` 主 spec 与 `workbench-shell` 中仍假定顶栏形态的条款需在 archive 时合并。