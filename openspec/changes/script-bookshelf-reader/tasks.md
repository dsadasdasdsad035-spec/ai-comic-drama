# Tasks

## 1. 阅读排版域与渲染抽取

- [x] 1.1 在 `src/theme.css` 新增 `--reader-desk / --reader-paper / --reader-ink / --reader-rule / --book-spine / --reader-shadow-hover`，night 与 `html[data-theme='day']` 各写字面值；验证：`verify-style.mjs` 报告的 token 全部解析且无 `(INVALID)`，日夜切换下纸面与墨色对比度 ≥ 5.7:1。
- [x] 1.2 从 `src/chat-ui/ChatText.tsx` 抽出 `MarkdownBody({ text, components })`，`ChatText` 保持现有插件与 `pre/code/a/table` 覆盖不变；验证：`verify-chat-markdown.mjs` 与 `verify-chat-markdown-sessions.mjs` 全绿，聊天消息 DOM 与改动前一致。
- [x] 1.3 新增 `.reader-md` 样式域（h1~h4、p、blockquote、列表、`hr`、表格）与 `data-reader-family` / `data-reader-align` 变体，字号/行距/缩进走 `--reader-fs` / `--reader-lh` / `--reader-indent`；验证：在无 `.chat-ui` 祖先的页面中渲染样例 Markdown，标题层级、段距、引用与列表均非浏览器默认样式。
- [x] 1.4 修正 `theme.css` 中 `--shadow-sm` 与 `--bg-1` 两处未定义 token 引用（卡片 hover 改用 `--shadow-node`，`.board-ep-toolbar` 改用 `--panel-2`）；验证：DevTools 计算样式里两处不再为空，画布集目录工具条背景可见。

## 2. 书架数据与书封组件

- [x] 2.1 扩展 `BoardEpisodeRow`（`src/board/episodeCover.ts`）增加 `hook`、`hasScript`、`sceneCount`、`places`、`castNames`；验证：`node -e` 或既有 `tests/` 断言样例项目返回这些字段，画布集目录调用方不受影响。
- [x] 2.2 在 `src/boardListFilter.ts` 新增 `scriptEpisodeMatch`，覆盖集号、集名、hook、场次地点、角色名、场数、镜数；验证：对样例行分别用地点词、钩子词、角色名检索均命中，且 `boardEpisodeMatch` 行为与改动前一致。
- [x] 2.3 新增 `src/board/ScriptBookCard.tsx`：书脊竖排集号、首帧图带或文字封面、衬线标题 + 两行 hook、状态书签、书架标签；验证：有首帧集与无首帧集在同一书架渲染时，后者出现文字封面且不含「缺首帧」文案。
- [x] 2.4 实现卡片四态样式与 `aria-current`/焦点环，阴影走伪元素 `opacity`，`prefers-reduced-motion` 下只保留阴影；验证：Playwright 断言 hover 后 `transform` 含负 Y 位移且伪元素 `opacity` 变化，选中卡 `aria-current="true"`，减少动效媒体查询下位移为 `none`。
- [x] 2.5 新增 `src/board/ScriptShelfBar.tsx`：搜索框、状态筛选（全部/有剧本/缺剧本，带计数）、排序（集号/场数/镜数/时长）、`/` 聚焦与 `Esc` 清空；验证：输入关键词后书架条数变化且计数同步，排序切换后首卡集号改变，`/` 与 `Esc` 键盘行为通过 Playwright 断言。
- [x] 2.6 重写 `ScriptEpisodeHub.tsx` 的页头、检索条、书架网格与底部分页，统一 `--shelf-max: 1240px` 版心，保留 `data-script-hub`、`data-script-phase`、`data-script-ep-card`；验证：1440 视口下搜索条、网格、分页左边界一致（实测 `getBoundingClientRect().x` 相同），`verify-script-hub.mjs` 列表段仍通过。
- [x] 2.7 书架窄屏（<520px）切换为横向书封布局；验证：375px 视口下卡片不横向溢出，标题与 hook 仍可见。

## 3. 阅读框与偏好

- [x] 3.1 新增 `src/board/ScriptBookReader.tsx`：书桌、纸页、页眉（集号 + 集名）、页脚（场次进度 + 阅读百分比）、书页厚度与脊线；验证：详情页出现 `.script-reader` 与 `.script-reader-page`，页眉文本含集号与集名，页脚含 `N / M 场` 与百分比。
- [x] 3.2 渲染目录栏：按 `episode.scenes` 输出场号/地点/时间，点击平滑滚动，IntersectionObserver 高亮当前项，`scroll-margin-top` 对齐页眉；验证：目录项数等于场次数，点击第 2 项后该书页标题进入视口且对应目录项带当前标记。
- [x] 3.3 窄视口把目录栏折叠为可展开浮层，正文行宽不被压缩；验证：1024px 与 1440px 下正文容器宽度一致，窄屏点开目录后浮层可关闭。
- [x] 3.4 新增 `src/board/readerPrefs.ts`（localStorage 单键、try/catch 兜底）与 `Aa` 排版菜单（字号、行距、宋/黑、两端/左、首行缩进）；验证：切换字体与对齐后正文计算样式变化，刷新后字号保持，隐私模式模拟下按默认值渲染不抛错。
- [x] 3.5 正文行宽改 `36em`，两端对齐配 `text-justify: inter-ideograph` / `line-break: strict` / `overflow-wrap: break-word`；验证：含超长英文串的场次不出现横向滚动，改字号后行宽仍协调。
- [x] 3.6 `ScriptEpisodeDetail.tsx` 换壳为「目录栏 + 书页」，默认只显示阅读态；`源码 / 分栏 / 渲染引擎 / 复制 / 导入 / 删除` 收进 `⋯` 次级菜单，保留 `data-md-pane-layout`、`data-md-layout`、`data-md-renderer`、`data-script-preview-tab`、`data-script-apply-md`；验证：首屏不可见源码控件，打开菜单后源码 CodeMirror 可挂载，`verify-script-hub.mjs` 相应步骤更新后通过。
- [x] 3.7 `MarkdownDocumentPane.tsx` 收缩为源码/分栏专用，阅读预览交给 Reader；验证：预览态不再渲染 `.md-pane`，源码态仍挂载 CodeMirror 且编辑可写回草稿。

## 4. 集成验收与文档

- [x] 4.1 更新 `verify-script-hub.mjs`：保留既有断言并新增书架条数、hover 阴影、选中态、目录项数、排版偏好持久化、无匹配空态；验证：`node verify-script-hub.mjs` 退出码 0。
- [x] 4.2 更新 `README.md` 剧本视图一节：书架、检索与排序、目录栏 + 书页、`Aa` 排版偏好、开发态控件收纳位置；验证：README 描述与页面实际控件一致。
- [x] 4.3 跑回归：`verify-script-markdown-import.mjs`、`verify-project-scope.mjs`、`verify-style.mjs`、`verify-board-episode-picker.mjs`；验证：全部退出码 0，`verify-style.mjs` 无对比度回退。
- [x] 4.4 日夜双主题人工验收：各截一张书架与详情图，确认悬浮阴影可见、纸面与书桌有层级、目录当前项可辨；验证：截图比对无「阴影不可见」与「版心错位」。

## Workflow follow-up

- 审查通过后执行 `openspec archive script-bookshelf-reader`，合并 `script-workbench` 主 spec。
- 手测创意 Agent `submit_episodes` 写回后书架与阅读页即时更新，且选中态不指向已删除的集。
