# Proposal

## Why

`script-hub-markdown-cards` 已把剧本立为独立视图，但列表复用了画布的分集卡：没有封面、没有选中态、hover 只有一条边框（`box-shadow: var(--shadow-sm)` 在近黑底上几乎不可见）；搜索条 1320px 居中、网格全宽，两套版心导致版面散掉。详情页把 `预览 / 源码 / 分栏 + Markdown / HTML` 四个开发态控件放在第一屏，正文 12px/1.65、`72ch` 左对齐、右侧空出约 560px，读起来像 IDE 而不是剧本。用户要的是「书」：书封卡片、悬浮阴影选中态、有版心的搜索与列表、以及带对齐的看书框架。

## What Changes

- **列表改为书架**：分集卡变成书封卡（书脊竖排集号、首帧或文字封面、标题 + hook 两行、状态书签），四种状态（rest / hover 抬升 + 阴影 / active 回弹 / selected 常驻阴影 + `aria-current`）；返回书架后标记「上次读到」。
- **版面与检索重排**：页头放标题与主动作；搜索、状态筛选（全部/有剧本/缺剧本）、排序（集号/场数/镜数/目标时长）与书架网格共用同一条居中版心；`共 N 条` 并入筛选 chip；分页移到网格底部；搜索范围扩到 hook、场次地点与角色名；`/` 聚焦搜索、Esc 清空。
- **详情改为「目录栏 + 单页」阅读框**：左侧 sticky 场次目录（点击滚动、滚动高亮、窄屏折叠），右侧居中纸页（页眉 running head、页脚场次进度与阅读百分比、书页厚度与脊线阴影）。
- **排版菜单取代开发态工具条**：默认只有阅读态；`Aa` 提供字号/行距/字体（宋·黑）/对齐（两端·左）/首行缩进，偏好按用户记忆；源码、分栏、渲染引擎、复制、导入、删除收进 `⋯`。
- **建立独立阅读排版域**：新增 `.reader-md` 一套 prose 样式，不再依赖 `.chat-ui .chat-md`（当前预览外没有 `.chat-ui`，正文排版实际大面积失效）；`ChatText` 抽出可传 `components` 的 `MarkdownBody`，聊天渲染行为不变。
- **新增双主题阅读 token**：`--reader-desk / --reader-paper / --reader-ink / --reader-rule / --reader-shadow-hover / --book-spine`，日夜各一套；不使用 Tailwind 的浅色阴影。
- 修正画布集目录工具条引用未定义 token `--bg-1`（顺手，不影响剧本主路径）。

不做（本变更）：

- 不改动 `episodes` 数据结构、导入格式（`parseScriptMarkdown` / `buildScriptEpisodeMarkdown`）、写回路径与合并规则。
- 不引入新依赖（不换渲染栈、不加 slug 插件）；目录锚点在渲染后用 DOM 顺序赋值。
- 不改 `.board-ep-card` 本身（画布集目录共用），不为画布做书封化。
- 不新增「选中但不开」的两段式点击；书封点击仍直接进详情。
- 不做清单/表格视图、不做阅读位置跨会话持久化（列为 P2）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `script-workbench`：列表呈现从「分集卡片墙」升级为**书架 + 检索条 + 选中态**契约；集详情从「Markdown 预览 + 工具条」升级为**目录栏 + 书页阅读框架 + 排版偏好**契约；新增「预览必须使用独立阅读排版域而非聊天样式」的约束。

## Impact

- **前端**：`src/board/ScriptEpisodeHub.tsx`（页头/筛选/书架/快捷键）、`src/board/ScriptEpisodeDetail.tsx`（阅读框壳）、`src/board/MarkdownDocumentPane.tsx`（收缩为源码/分栏）、`src/chat-ui/ChatText.tsx`（抽出 `MarkdownBody`）；新增 `src/board/ScriptBookCard.tsx`、`src/board/ScriptBookReader.tsx`、`src/board/readerPrefs.ts`。
- **数据派生**：`src/board/episodeCover.ts` 的 `BoardEpisodeRow` 补 `hook / hasScript / sceneCount`；`src/boardListFilter.ts` 新增 `scriptEpisodeMatch`（不动共用 `boardEpisodeMatch`）。
- **样式**：`src/theme.css` 新增 `/* 剧本 · 书架与书页 */` 段与双主题 token；修正 `--bg-1` 引用。
- **测试**：`verify-script-hub.mjs` 保留既有 `data-*` 选择器并新增书架/选中/目录/排版断言；`verify-style.mjs` 复验纸面墨色对比度。
- **文档**：`README.md` 剧本视图一节补书架与阅读框架说明。
- **OpenSpec**：`script-workbench` 主 spec 在 archive 时合并；本变更不触碰 `workbench-shell` / `project-context` 行为。
