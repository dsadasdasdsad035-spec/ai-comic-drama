# Proposal

## Why

剧本视图的两半是断裂的：**书架已经是拟物的**（书脊 22px、缎带、纸张色 `--reader-paper`、hover 抬起 4px、分页与检索齐备），点进去却掉回一个 12px 的灰色 Markdown 预览框（`.script-md-preview`，62 行 CSS，无纸张、无目录、无排版菜单）。用户看到的不是「一本打开的书」，而是「从书架上抽出一本书，里面是一张打印稿」。

更具体地：一套完整的书页阅读器**已经写好但从未接线**——`ScriptBookReader.tsx`（235 行：书桌、纸页、页眉、页脚、场次目录、滚动进度）、`ReaderTypeMenu.tsx`（166 行：字号/行距/宋黑/对齐/缩进）、`readerPrefs.ts`（74 行：localStorage 持久化 + CSS 变量）。三份文件合计 475 行，**零处 import**；`theme.css` 里 `.script-reader` / `.reader-md` / `.reader-type` 规则**零条**。所属 change `script-bookshelf-reader` 的 tasks 全勾、`isComplete: true`，但未归档。这是「做完一半就停了」的遗留，不是未开工。

同时，Markdown 渲染能力可以一并补齐：现用 `react-markdown` + `remark-gfm` + `remark-breaks`，能渲染表格与围栏代码，但**没有图表**。剧本里天然有「人物关系」「场景流转」，纯文本表格表达不了。

## What Changes

- **接线**：`ScriptEpisodeDetail` 的「剧本」tab 改用 `ScriptBookReader` 渲染书页；「分镜」tab 是镜头表格，**不套书页**，仅换成纸张配色。
- **纸张主题**：`ReaderPrefs` 增加 `theme` 字段，提供四套（书页白 / 羊皮纸 / 夜间墨 / 终端）。每套只换背景、前景、纹理、字体四件事；**不做 3D 卷曲**（长文本掉帧），其余拟物细节都做（书脊、叠页、页边暗角、书签、翻页过渡）。
- **字体走系统栈**：不打包任何字体文件。衬线回退顺序 `Songti SC → SimSun → Noto Serif CJK → serif`，三平台观感不完全一致，换来零体积与零许可问题。
- **图表渲染**：新增 mermaid 围栏渲染，**懒加载**、**白名单**（flowchart / sequence / state / class / er / gantt / pie）、`securityLevel: 'strict'` + `htmlLabels: false`。白名单外的类型降级为代码块并给出说明，不静默吞掉。
- **Markdown 能力补齐**：图片点击放大、脚注、目录锚点用统一 slug 而非手写 `querySelectorAll('h2')`。
- **宽度策略**：图表比书页宽时**书页内横向滚动**，点击可全屏查看。不为了图表改变书页宽度——那会破坏「翻页时版心不动」的阅读节奏。

不在本次范围：竖排/双页对开（中文竖排在本应用的长段落上可读性差）；图片/字体资源打包；mermaid 之外的图引擎（D2 / graphviz / PlantUML——D2 要 wasm、PlantUML 要 Java 服务端，都不适合本地桌面应用）；Agent 写回剧本的契约（不变）。

## Capabilities

### New Capabilities

无。书页阅读是既有「剧本工作台」能力内的呈现方式，不另立能力。

### Modified Capabilities

- `script-workbench`: 新增「书页阅读模式」「阅读排版偏好持久化」「图表渲染与降级」三组需求；原有四条（主区域只展示分集结构、拆集入口仅在 Agent、空态指向 Agent、顶栏提供拆集参数）**不变**。

## Impact

- 组件：`src/board/ScriptEpisodeDetail.tsx`（接线）、`src/board/ScriptBookReader.tsx`（已有，补图表与主题）、`ReaderTypeMenu.tsx`（加主题行）、`readerPrefs.ts`（加 theme 字段与四套 token 映射）；新增 `src/chat-ui/MermaidBlock.tsx`。
- 样式：`src/theme.css` 新增 `.script-reader` / `.reader-md` / `.reader-type` 全量规则（约 400 行）与四套纸张主题的 token；`.script-md-preview` 保留给「分镜」tab。
- 依赖：新增 `mermaid`（首次遇到围栏时动态 import，约 900KB gzip 独立 chunk）。
- 渲染入口：`src/chat-ui/ChatText.tsx` 的 `MarkdownBody` 增加 `mermaid` 围栏分支；**聊天消息不受影响**（聊天里的 mermaid 同样渲染，属附带收益）。
- 验收：`verify-script-hub.mjs` 的三处选择器（`[data-script-md-preview="script"]`、`[data-script-md-preview="shots"]`、`[data-script-phase="detail"]`）必须保持命中——`ScriptBookReader` 已有 `previewAttr` 参数产出同名属性，接线时必须确认落点。
- 安全：mermaid 必须 `securityLevel: 'strict'` **且** `htmlLabels: false`。只设前者时它仍会渲染任意 HTML 标签，而剧本内容来自用户导入或 Agent 生成。
