# Tasks

## 1. 接线：让书页真的渲染

- [x] 1.1 `ScriptEpisodeDetail.tsx` 的 script tab 改用 `<ScriptBookReader epNo title scenes={readerScenesOf(episode)} markdown={scriptMd} previewAttr="script" />`，shots tab 保持 `<ChatText>`；确认 `verify-script-hub.mjs` 的三处选择器仍命中（`[data-script-md-preview="script"]`、`[data-script-md-preview="shots"]`、`[data-script-phase="detail"]`），跑 `node verify-script-hub.mjs` 退出码 0
- [x] 1.2 给 `ScriptBookReader` 补 `data-script-phase` 所需的外层容器，确保详情屏标记不丢；用浏览器确认点开分集后 DOM 里同时存在书页与标记
- [x] 1.3 把 `readerScenesOf()` 接进详情（`episode.scenes` → 目录项），确认目录项数与本集场次数一致；无场次时目录显示「本集尚未填写场次」且书页显示空场次说明而非空白

## 2. 书页样式（`src/theme.css` 新增）

- [x] 2.1 写 `.script-reader` 布局：书桌底 + 居中书页 + 右侧目录栏，桌面宽屏目录常驻、窄屏可折叠；确认 1600/1280/900/390 四个宽度下无横向滚动、版心不溢出
- [x] 2.2 写 `.script-reader-page` 拟物：纸张底色、页眉分隔线、页边留白、页脚；确认页眉含集号与集名、页脚含「第 N / M 场」与百分比
- [x] 2.3 写拟物细节：书脊（左侧竖条 + 渐变）、叠页（右侧 2 层伪元素错位）、页边暗角（`radial-gradient`）、纸张纹理（`repeating-linear-gradient`，透明度受 `--reader-grain` 控制）；截图确认四个细节都能看见且不过度
- [x] 2.4 写 `.reader-md` 正文排版：`--reader-fs` / `--reader-lh` / `--reader-indent` 生效、h1/h2/h3 层级、引用块、列表、行内代码、围栏代码、表格（宽表横向滚动）；确认正文与纸张对比度 ≥4.5:1（日夜两套应用主题各测一次）
- [x] 2.5 写 `.reader-type` 排版菜单样式（右下角浮动按钮 + 面板 + 分段控件），并把菜单接到 `ScriptBookReader` 的 `.script-reader-tools`；确认菜单位置不遮挡正文、Esc 可关

## 3. 纸张主题

- [x] 3.1 `readerPrefs.ts` 增 `ReaderTheme = 'paper' | 'parchment' | 'ink' | 'terminal'` 与 `theme` 字段（缺省 `'paper'`），`readReaderPrefs` 对非法值回落默认；单测确认脏数据不抛错
- [x] 3.2 `readerCssVars()` 输出 `--page-paper` / `--page-ink` / `--page-rule` / `--reader-grain`，并按 theme 输出 `data-reader-theme`；确认四套主题各有一组完整变量（单测断言无缺键）
- [x] 3.3 `theme.css` 写四套纸张主题的变量值与纹理强度；确认每套主题在日夜两套应用主题下正文对比度 ≥4.5:1
- [x] 3.4 `ReaderTypeMenu` 增「纸张」一行（四个选项），与字号/行距/字族/对齐/缩进并列；确认切换主题后版心宽度与段落结构不变，且已选字族不被主题覆盖

## 4. 图表渲染

- [x] 4.1 `npm install mermaid`，确认版本与 lock 文件更新；`npm run build` 通过且 mermaid 被切成独立 chunk（构建输出里能看到单独产物）
- [x] 4.2 新增 `src/chat-ui/MermaidBlock.tsx`：懒加载 `import('mermaid')`、白名单校验、`securityLevel: 'strict'` + `htmlLabels: false`、失败时降级为代码块并给出可读原因；确认白名单外的类型（如 `mindmap`）显示代码块 + 「该类型当前不支持」
- [x] 4.3 `ChatText.MarkdownBody` 的 `pre` 分支识别 `language-mermaid` 围栏交给 `MermaidBlock`；确认非 mermaid 围栏仍走 `ChatCodeBlock`（聊天消息里的围栏不受影响）
- [x] 4.4 `pageThemeVars(theme)` 把纸张主题映射成 mermaid `themeVariables`；主题切换时重新 `initialize`，确认羊皮纸主题下图表不再是深色
- [x] 4.5 图表容器 `overflow-x: auto` + `max-width: 100%`；确认宽图在书页内横向滚动、书页版心宽度不变；点击图表打开全屏层（复用 `mp-backdrop` 外壳），确认关闭后回到原阅读位置
- [x] 4.6 安全验收：写入一段含 `<img src=x onerror=alert(1)>` 的 mermaid 围栏，确认渲染结果不执行脚本、不产生活动元素

## 5. 富文本能力补齐

- [x] 5.1 正文图片点击放大：`.reader-md img` 可点击，打开放大层；确认图片不撑破版心、关闭后回到原位置
- [x] 5.2 目录锚点改 slug 匹配（标题文本 → 稳定 id，目录按场次号匹配标题前缀），保留「按顺序索引」作为兜底；用一个 beats 里含 `## 小标题` 的分集确认目录不错位
- [x] 5.3 确认 GFM 能力完整：任务列表、删除线、脚注（如无脚注能力则记录为已知缺口，不在本次引入插件）

## 6. 拟物动效

- [x] 6.1 切集时用 View Transitions（`document.startViewTransition`）做 `translateX` + `fade`；不支持时降级为直接切换；确认 `prefers-reduced-motion: reduce` 下无动画
- [x] 6.2 书签：书页右上角显示当前场次号的 tag，点击展开/收起目录；确认书签不遮挡正文、状态与目录当前项同步

## 7. 分镜页配色对齐

- [x] 7.1 `.script-md-preview`（分镜 tab）改用书籍纸张配色而非 `--panel`，与书页背景一致；确认两 tab 切换时背景无跳变
- [x] 7.2 分镜页保留页眉集号与集名（不套版心与页脚）；确认 `verify-script-hub.mjs` 的 shots 断言仍通过

## 8. 集成验收与文档

- [x] 8.1 `node verify-script-hub.mjs` 与 `node verify-script-markdown-import.mjs` 全绿
- [x] 8.2 `npm run build` 通过（含 `tsc --noEmit`）
- [x] 8.3 新增 `verify-script-reader.mjs`：断言书页渲染、目录项数=场次数、字号改动生效、偏好持久化、四套主题可切、mermaid 渲染成功与白名单降级、宽图横向滚动、`prefers-reduced-motion` 下无动画
- [x] 8.4 日夜两套应用主题 × 四套纸张主题各截一张图，逐张核对对比度与拟物细节（页边、叠页、书脊可见；无「阴影不可见」与版心错位）
- [x] 8.5 更新 `README.md` 剧本视图一节：书页模式、场次目录、排版菜单、纸张主题、图表支持与白名单；确认文档描述与页面实际控件一致

## Workflow follow-up

- 归档本变更：`openspec archive script-reader-book-mode --yes`
- 同时处理遗留：`script-bookshelf-reader`（tasks 全勾、`isComplete: true`、未归档）应一并归档，把书架那部分能力并入 `script-workbench` 主规格
