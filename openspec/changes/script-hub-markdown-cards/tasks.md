# Tasks

## 1. 路由与导航

- [x] 1.1 在 `src/shell/nav.ts` 增加 `script` 视图（图标、分组、面包屑），更新 `VIEW_IDS`；验证：`isViewId('script')` 为真且 `NAV_ITEMS` 含剧本项。
- [x] 1.2 扩展 `App.tsx` / `route.ts` 渲染 `view === 'script'`，`writeLastView` / `readLastView` 支持 `script`；验证：刷新 `#/p/<proj>/script` 仍停留在剧本视图。
- [x] 1.3 更新 `AppShell` 面包屑与标题；剧本列表阶段隐藏 `EpPicker`，详情阶段显示当前集；验证：剧本列表无集下拉，详情有。

## 2. 剧本 Markdown 纯函数

- [x] 2.1 实现 `buildScriptEpisodeMarkdown`（新文件，见 design）；验证：扩 `tests/script-markdown-import.ts` 或 `verify-script-markdown-import.mjs` 断言 render→parse→`script-v1` 通过。
- [x] 2.2 为样例集增加 hook、多场次、缺标题边界用例；验证：上述脚本全绿。

## 3. 剧本中心 UI

- [x] 3.1 新增 `ScriptEpisodeHub.tsx`：卡片墙、搜索、`episodeScriptUi` 徽标、空态；复用 `listBoardEpisodes` / 共享卡片样式；验证：有项目时渲染与画布集数一致。
- [x] 3.2 新增 `ScriptEpisodeDetail.tsx`：剧本/分镜双 tab、`ChatText` 预览、复制 MD、进画布、删除剧本（沿用 `planDeleteEpisodeScript`）；验证：手测切换 tab 与复制内容。
- [x] 3.3 在 `theme.css` 增加 `script-hub-*` 与 `script-md-preview` 阅读样式；验证：长 beats 不换行溢出、标题层级可读。
- [x] 3.4 将 `EpisodeScriptImportDialog` 主入口接到剧本 Hub 工具条；验证：导入后卡片状态更新且 `patchProject` 含新 `scenes`。

## 4. 画布整合

- [x] 4.1 瘦身 `BoardEpisodeGrid`：移除工具条「导入大纲」主按钮；「看剧本」改为跳转 `script` + 集号；验证：集目录 DOM 无 `data-board-import-script` 主路径。
- [x] 4.2 单集画布 `ep-chip-script` 点击跳转剧本详情；移除或停用画布层 `EpisodeScriptDetailDialog` 主挂载；验证：画布不再弹出全屏剧本时间线。
- [x] 4.3 概览/卡片「去剧本」深链（若存在剧本 chip）；验证：从画布点进剧本后 `epNo` 与详情集一致。

## 5. 文档与验收

- [x] 5.1 更新 `README.md` 制作流程：剧本视图、导入分工、画布不再主承载剧本；验证：文案与 spec 一致。
- [x] 5.2 新增 `verify-script-hub.mjs`（导航、深链、预览 data 属性）；验证：`node verify-script-hub.mjs` 退出码 0。
- [x] 5.3 回归 `verify-script-markdown-import.mjs`、`verify-project-scope.mjs`；验证：全绿或按需更新选择器。

## Workflow follow-up

- 审查通过后执行 `openspec archive script-hub-markdown-cards` 合并主 spec。
- 手测创意 Agent `submit_episodes` 写回后剧本预览即时更新。