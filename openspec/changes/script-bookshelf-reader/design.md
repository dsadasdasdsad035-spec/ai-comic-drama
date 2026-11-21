# Design

## Context

- 列表与详情由 `src/board/ScriptEpisodeHub.tsx`、`src/board/ScriptEpisodeDetail.tsx` 承担；卡片直接复用画布集目录的 `.board-ep-card`（`src/theme.css:18298`），网格全宽，搜索条来自共用 `BoardListToolbar`（`max-width:1320px` 居中）——两套版心。
- 详情预览是 `script-md-preview > ChatText(.chat-md)`。`src/chat-ui/chat-markdown.css` 的正文规则全部挂在 `.chat-ui .chat-md` 下，而该页面没有 `.chat-ui` 祖先；实际只有 `theme.css:18024-18043` 四条补丁生效。实测正文 12px / 行高 1.65，`max-width:72ch`（中文约 49 字），左对齐，1440 视口下页宽 590px、右侧空 560px。
- 卡片 hover 用 `box-shadow: var(--shadow-sm)`（`theme.css:18313`）。`--shadow-sm` 未在 `theme.css` 定义，只在 Tailwind `theme.css` 里为 `0 1px 3px rgba(0,0,0,.1)`——暗底上不可见，所以悬浮只表现为边框变亮。同段 `.board-ep-toolbar` 还引用了未定义的 `--bg-1`。
- 数据侧已够用：`listBoardEpisodes`（`episodeCover.ts`）给集号/标题/时长/镜数/封面种类，`episodeScriptUi` 给 `hasScript / sceneCount / badge`，`ProjectEpisode` 已有 `hook` 与 `scenes[].place/time/space`。`useBoardListFilter` 提供 query/page，但匹配函数 `boardEpisodeMatch` 不含 hook/地点，且被画布共用。
- 验证脚本 `verify-script-hub.mjs` 依赖 `[data-script-hub][data-script-phase]`、`[data-script-ep-card]`、`[data-script-md-preview]`、`[data-md-pane-layout]`、`[data-md-layout="source"]`、`[data-md-renderer]`、`[data-script-preview-tab]`、`[data-script-apply-md]`，改造必须保留。
- 无新依赖可用：`react-markdown` + `remark-gfm` + `remark-breaks` 已是既有栈，没有 `rehype-slug`。

## Goals / Non-Goals

**Goals:**

- 书架与阅读框的视觉与交互落地为可验收的 DOM 契约与 data 属性。
- 阅读排版与聊天排版彻底分离，且不复制渲染实现。
- 双主题下悬浮阴影、纸面、墨色都达到 `STYLE-GUIDE.md` 的对比度基线。
- 版心单一来源：搜索/筛选/排序/网格共用一条测量列。

**Non-Goals:**

- 不改 `episodes` 结构、导入/导出格式与写回路径。
- 不改 `.board-ep-card`，不给画布做书封；不为 `BoardListToolbar` 加剧本专属 props。
- 不做虚拟滚动、清单视图、阅读位置跨会话持久化。
- 不引入 slug 插件、不进 Tailwind token 体系。

## Decisions

### 1. 新增书封组件，而不是给 `.board-ep-card` 加 `mode`

**决定**：新建 `ScriptBookCard.tsx`（书脊 / 封面 / 书封 / 书架标签 / 状态书签）与 `script-shelf-*` 类；画布集目录保持原样。

**备选**：给 `.board-ep-card` 加 `data-mode="script"` 分支。否决——画布集目录的卡片带 16:9 封面与双按钮页脚，剧本书封是 3:4 书形 + 书架标签，两者只在「卡片」这个抽象上重合；共用选择器会把 hover 阴影、圆角、内边距串到分镜工作台。

### 2. 封面：首帧「图带」+ 文字封面兜底

**决定**：封面区上 58% 用首帧（`object-fit: cover`，图带顶部圆角对齐书封），下半为纸面标题区。无首帧时渲染文字封面：大号集号（mono）+ 集名（衬线）+ 细网格纹理（CSS `repeating-linear-gradient`）。

**理由**：`resolveEpisodeCover` 已区分 keyframe/clip/none。直接裁 3:4 会把 16:9 首帧裁掉两侧主体；「图带 + 纸面」既保留画面又保住书形。文字封面避免一排空格子，也不需要新素材字段。

**备选**：整卡 `aspect-ratio: 3/4` 硬裁首帧。否决——构图损失大；且 `none` 时仍要额外设计兜底。

### 3. 四态用伪元素做阴影，不直接动画 box-shadow

**决定**：卡片 `transform: translateY(...)` 过渡；阴影画在 `::after`（或 `::before`）上，只过渡 `opacity` 与 `transform`。新增 `--reader-shadow-hover`，日夜各一套。`prefers-reduced-motion` 下置 `transform: none`，仅保留阴影/描边。

**理由**：`box-shadow` 逐帧重绘代价高，书架可同时出现 12 张卡；`opacity` 走合成层。暗色下必须给足不透明度（`rgba(0,0,0,.75)`）才有「浮起」感。

### 4. 选中态语义：点击即进入，返回标记「上次读到」

**决定**：书封唯一点击含义 = 打开详情。选中态从路由状态派生（`scriptDetailEpNo` / 最近打开的集），返回书架时该卡 `aria-current="true"` + 常驻阴影 + 显示「上次读到 第 N 场」。阅读位置取该集目录的当前项（P1），P0 先用「第 1 场」或最近场次号。

**备选**：两段式（先选中再点「打开」）。否决——书架出现两种点击语义，且与画布集目录不一致。

### 5. 检索条与网格共用一条版心

**决定**：书架容器 `--shelf-max: 1240px; margin-inline: auto`；页头、检索条、网格、分页都在同一容器内。不复用 `BoardListToolbar`（它的 1320px 与分页在上方是为资产网格设计的），新建 `ScriptShelfBar`，并把计数并进筛选 chip。

**理由**：现状是 1320 居中的搜索条 + 全宽网格，在 1440 视口下右侧空 600px 且卡片随窗宽伸缩。单一版心让书架稳定成「一面墙」。

### 6. 匹配函数独立，不扩共用 `boardEpisodeMatch`

**决定**：`boardListFilter.ts` 新增 `scriptEpisodeMatch(row, q)`，入参扩展为 `BoardEpisodeRow & { hook, places, castNames }`，覆盖集号/集名/钩子/地点/角色/场数/镜数；`boardEpisodeMatch` 保持不变。

**理由**：画布集目录与剧本书架的信息架构不同，共用匹配会把地点/角色泄漏到画布搜索；`useBoardListFilter` 只依赖 `match` 入参，可直接复用。

### 7. 阅读框：目录栏 + 书页，锚点用 DOM 顺序不用 slug 插件

**决定**：`ScriptBookReader.tsx` 渲染 `.script-reader`（书桌）> `.script-reader-page`（纸页）> 页眉 / `.reader-md` 正文 / 页脚；左侧 `.script-reader-toc` 由 `episode.scenes` 渲染（场号、地点、时间在结构里已有）。预览挂载后 `querySelectorAll('.reader-md h2')` 按顺序赋 `id="scene-<i>"`，目录点击 `scrollIntoView({ block: 'start', behavior: 'smooth' })`；`IntersectionObserver` 更新当前项。

**理由**：不引 `rehype-slug` 就不需要解析标题文本；场次数据比标题文本更可靠（标题可能被手改）。目录项与 `scenes` 一一对应，天然满足「目录数 = 场次数」。

**备选**：给 `ChatText` 传 `components.h2` 直接加 id。可行，但仍需按 `scenes` 顺序对齐，且 `components` 覆盖会把阅读排版耦合进渲染层；改为渲染后赋值更薄。

**备选**：CSS `scroll-margin-top` + 原生锚点。仍需要稳定的 `id`，没有省掉第 7 条的工作。

### 8. 抽 `MarkdownBody`，阅读域独立

**决定**：`ChatText.tsx` 内部抽 `MarkdownBody({ text, components })`，`ChatText` 变成 `MarkdownBody` + 聊天包裹层（保留 `remark-gfm`、`remark-breaks`、`pre/code/a/table` 覆盖）。阅读页用 `MarkdownBody` 并传入标题/引用/列表的阅读态覆盖，外层 `.reader-md` 提供全部排版（字号、行高、两端对齐、缩进、页边）。

**理由**：满足 spec「阅读排版不依赖聊天作用域」；一处渲染栈，两套 CSS。若把 `.chat-md` 规则改成全局，会污染三个工作台会话。

**备选**：给 `.chat-md` 规则去掉 `.chat-ui` 前缀。否决——聊天 reset 与工作台样式存在同名冲突（见 `STYLE-GUIDE` 历史事故），风险大于收益。

### 9. 排版偏好：localStorage 单键，不跟项目

**决定**：`readerPrefs.ts` 读写 `storyboard-script-reader`，形状 `{ size: 17, leading: 2.0, family: 'serif', align: 'justify', indent: true }`；写为 CSS 变量（`--reader-fs` / `--reader-lh` / `--reader-indent`）与两个布尔 data 属性（`data-reader-family` / `data-reader-align`）。`Aa` 菜单只读当前值。

**理由**：阅读偏好是人的习惯，不是项目属性；写项目会污染 `project.json` 且跨设备同步语义不清。localStorage 与既有 `storyboard-model-pick` / `theme` 一致。

### 10. 双主题文案与验收口径

**决定**：新增 token 段（night/day 各写一次字面值，禁止自引用）：

| token | night | day |
|---|---|---|
| `--reader-desk` | `#05080d` | `#e7e1d5` |
| `--reader-paper` | `#121a24` | `#fffdf8` |
| `--reader-ink` | `#e6edf5` | `#1d2733` |
| `--reader-rule` | `#223141` | `#d8d0c3` |
| `--book-spine` | `#0b1119` | `#efe9df` |
| `--reader-shadow-hover` | `0 24px 40px -20px rgba(0,0,0,.75)` | `0 20px 34px -18px rgba(60,48,32,.28)` |

同时删除 `theme.css:18313` 对 `--shadow-sm` 的引用（改用 `--shadow-node`），并把 `.board-ep-toolbar` 的 `--bg-1` 改为 `--panel-2`。

### 11. 阅读行宽用 em 不用 ch

**决定**：`.reader-md` 正文容器 `max-width: 36em`（随字号缩放），两端对齐 `text-justify: inter-ideograph`，`line-break: strict`，`overflow-wrap: break-word`，`scroll-margin-top` 对齐页眉高度。

**理由**：`ch` 是数字宽度，中文实际字数约为 ch 的 2/3；`72ch` 排到 49 字，超出一本书的舒适行宽。`em` 在中文语境下按字宽缩放，改字号后行宽仍协调。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 书封 3:4 造型在窄屏（<520px）变一列时显得过高 | 窄屏切为横向「书脊 + 图带 + 信息」布局，不是简单缩放 |
| 首帧缺省时 12 张文字封面同质化 | 集号字号随集名长度变化；网格纹理按集号奇偶偏移；选中态加书签色 |
| 两端对齐在含长英文串时出现大字距 | `overflow-wrap: break-word` + `text-justify: inter-ideograph` 只作用于 CJK；长串独占行时不强制 justify |
| 目录 IntersectionObserver 在长场次下抖动 | 取视口上 1/3 为判定带；节流一帧；只有一个 current |
| `MarkdownDocumentPane` 收缩后 `verify-script-hub` 的 `[data-md-layout="source"]` 找不到 | 源码入口保留原 data 属性，只是移进 `⋯` 菜单，点击后再出现 `[data-md-pane-layout]`；验收脚本改为先开菜单 |
| 阅读偏好存 localStorage，隐私模式下抛错 | 读写包 try/catch，失败按默认值渲染 |
| 新 token 自引用导致全站字体退化（历史事故） | token 全部写字面值；改完跑 `verify-style.mjs` |

## Migration Plan

1. 先落 `MarkdownBody` 抽取 + `.reader-md` 样式域 + token（无 UI 变化可独立验证聊天未回归）。
2. 落 `ScriptBookCard` 与 `ScriptShelfBar`，切换 `ScriptEpisodeHub`；保留全部 `data-*`。
3. 落 `ScriptBookReader` 与 `ScriptEpisodeDetail` 换壳，`MarkdownDocumentPane` 退入 `⋯`。
4. 更新 `verify-script-hub.mjs` 与 `README.md`，跑 `verify-style.mjs`。
5. 回滚：`ScriptEpisodeHub` / `Detail` 各自单文件 revert 即回到旧界面；样式段与 token 为纯新增，可保留。

## Open Questions

- 阅读进度百分比按「滚动比例」还是「已读场次数」计算：前者连续、后者与目录同源。P0 可先用滚动比例，P1 并入目录状态（不改变本变更的 DOM 契约）。
- 「上次读到」是否需要在第 1 场之前就写入 localStorage 跨会话：当前只在会话内派生，跨会话记忆列为 P2。
