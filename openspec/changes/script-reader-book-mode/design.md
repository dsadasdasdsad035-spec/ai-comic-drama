# Design

## Context

见 `proposal.md` — Why。实现前必须知道的现状：

- **书页阅读器已存在但未接线**：`src/board/ScriptBookReader.tsx`（235 行）、`ReaderTypeMenu.tsx`（166 行）、`readerPrefs.ts`（74 行）零处 import；`theme.css` 里 `.script-reader` / `.reader-md` / `.reader-type` 零条规则。所属 change `script-bookshelf-reader` 的 tasks 全勾、`isComplete: true`，但未归档。
- **书架已经是拟物的**：`.script-book` / `.script-book-spine`（22px 书脊）/ `.script-book-leaf`（纸张叶片）/ `.script-book-ribbon`（缎带）/ hover `translateY(-4px)`，token 用 `--reader-paper` / `--reader-ink` / `--reader-rule` / `--book-spine` / `--reader-shadow-hover`。这些 token 已在日夜两套主题里各有一份值（`theme.css:114-119` 与 `9682-9686`）。
- **详情当前是文本预览**：`ScriptEpisodeDetail.tsx` 用 `<ChatText text={…} />` 装进 `.script-md-preview`（`theme.css:18637`，62 行：12px / 1.65 / `--panel` 底 / `max-width: 72ch`）。
- **Markdown 栈**：`react-markdown@10` + `remark-gfm` + `remark-breaks`，无 rehype 插件、无数学、无图表。渲染入口是 `ChatText.MarkdownBody`，被聊天消息 `.chat-md` 与剧本 `.reader-md` 共用（`ChatText.tsx:64` 的注释已说明这个设计意图）。
- **零打包字体**：`public/` 下无 woff/ttf，CSS 无 `@font-face`。`--font-sans` 是 SF Pro / PingFang 系统栈。
- **验收契约**：`verify-script-hub.mjs` 依赖 `[data-script-md-preview="script"]`（72 行）、`[data-script-md-preview="shots"]`（74 行）、`[data-script-phase="detail"]`（71 行）。`ScriptBookReader` 已有 `previewAttr?: 'script' | 'shots'` 参数，会把值写进 `data-script-md-preview`。
- Electron 45.3.2（Chromium 130+），支持 View Transitions API 与 `backdrop-filter`。

## Goals / Non-Goals

**Goals**

- 从书架点进分集，视觉上仍是「一本书」，不出现断裂感。
- 排版偏好与纸张主题立刻生效、跨会话记住、不污染项目数据。
- 图表能画、能看清、画不出来时能读懂为什么。
- 三平台都能用，不依赖任何字体/图片资产。

**Non-Goals**

- 不做 3D 书页卷曲、双页对开、竖排（长文本上性能与可读性都不划算）。
- 不打包字体，不做字体子集化。
- 不引入 mermaid 之外的图引擎（D2 需 wasm、PlantUML 需 Java 服务端）。
- 不改 Agent 写回剧本的契约，不改书架布局。

## Decisions

### D1. 书页取代预览框，但只对「剧本」tab

`ScriptEpisodeDetail` 的 script tab 改渲染 `<ScriptBookReader>`；shots tab 保持 `ChatText` + `.script-md-preview`，只把配色接到纸张 token 上。

**为什么分镜不套书页**：分镜是镜头表格（`renderShotTable` 输出 GFM 表格，列含镜号/时长/景别/运镜/画面/台词）。书页版心上限约 62ch，表格塞进去必须横向滚动，每一行都要滑——读表变成体力活。表格需要的是「宽」，书页要的是「窄」，两者物理冲突。

**代价**：两个 tab 观感不同源。用同一套纸张配色弥补（背景/前景色一致，只有版心与页脚不同）。

### D2. 纸张主题表达为 ReaderPrefs 的一个字段，不是 CSS 类切换

```ts
type ReaderTheme = 'paper' | 'parchment' | 'ink' | 'terminal'
type ReaderPrefs = { size; leading; family; align; indent; theme: ReaderTheme }
```

`readerCssVars()` 把 theme 映射成 CSS 变量（`--reader-paper` / `--reader-ink` / `--reader-rule` / `--reader-grain`），同时输出 `data-reader-theme` 供纹理与字体规则挂钩。

**为什么不用全局主题类**：应用已有 `html[data-theme='day'|'night']`。纸张主题是**阅读器局部**的，与全局日夜主题正交——用户可能白天用夜间墨，也可能开着暗色应用读羊皮纸。做成局部 data 属性 + CSS 变量覆盖，两者互不干扰。

**为什么不复用已有 `--reader-paper` token**：那套 token 属于**书架**（叶片、书脊），日夜各一份。书页的纸张色要按四套主题走，两套变量若同名会互相覆盖。方案：书页用 `--page-paper` / `--page-ink` / `--page-rule` 前缀，书架继续用 `--reader-*`。

### D3. 字体走系统栈，按主题给不同的 family 建议

```
serif 栈: 'Songti SC', 'SimSun', 'Noto Serif CJK SC', 'Source Han Serif SC', serif
sans  栈: 沿用 --font-sans（SF Pro / PingFang / Segoe UI / system-ui）
mono  栈: 沿用 --font-mono
```

主题与字族的默认搭配只是**建议**：羊皮纸默认衬线、终端默认等宽。用户显式选过字族后，主题切换不改他的选择——偏好是用户的，不是主题的。

**三平台风险**：Linux 上若无 CJK 衬线，会退到 `serif` 后由系统决定，可能落到非中文字体导致豆腐块。缓解：`font-family` 末尾必带 `serif`，并在主题里给 sans 作为兜底候选，不强制。

### D4. mermaid 懒加载 + 白名单 + 双重安全开关

```ts
const ALLOWED = new Set(['flowchart','graph','sequenceDiagram','stateDiagram-v2',
                         'classDiagram','erDiagram','gantt','pie'])
// 首次遇到时：
const mermaid = (await import('mermaid')).default
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,          // ← 关键：只设 strict 不够
  theme: 'base',
  themeVariables: pageThemeVars(prefs.theme),
})
```

**为什么 `htmlLabels: false` 是必须的**：`securityLevel: 'strict'` 禁的是脚本执行，但 mermaid 默认 `htmlLabels: true` 会把节点标签当 HTML 渲染。剧本内容来自用户导入或 Agent 生成，一段 `<img onerror=…>` 就足以执行。关掉 HTML 标签后节点文本按纯文本渲染。

**为什么白名单**：mermaid 支持二十多种图。不认识的类型若直接交给它，失败信息是它自己的内部错误（对用户无意义）。白名单外提前拦下，降级成代码块 + 一句「该类型当前不支持」，内容不丢。

**为什么懒加载**：mermaid 11 压缩后约 2.9MB / gzip 约 900KB。本应用已经打包了 Babylon（10MB），这个量级不算突兀，但没必要让每个打开剧本的人都下载。`import()` 让 Vite 切成独立 chunk，只在首次遇到围栏时拉取。

**主题映射**：mermaid 不读 CSS 变量。`pageThemeVars()` 把纸张主题映射成 `themeVariables`（`primaryColor` / `lineColor` / `textColor` / `mainBkg` 等）。**每次主题切换都要重新 initialize**——这是最容易漏的一处，漏了就会出现「羊皮纸上画着深色图」。

### D5. 宽图在书页内滚动，不改变版心

图表容器 `overflow-x: auto`，`max-width: 100%`。图本身按自然宽度渲染，超出就滑。

**为什么不缩放适配**：缩小后的流程图文字会小到不可读。宁可滚动。

**点击放大**：点击图表打开全屏层（复用现有 `mp-backdrop` / `mp-dialog` 外壳），全屏内按容器宽度缩放或允许双向滚动。

### D6. 目录锚点用 slug 规则，替换手写 querySelectorAll

现有实现渲染后 `querySelectorAll('h2')` 按顺序赋 `id="script-scene-N"`。这在「h2 数量与 scenes 数量一致」时成立，但正文若含用户自定义 h2（剧本 beats 里写了 `## 小标题`），序号就错位。

改为：`h2` 渲染时取其文本，生成稳定 slug；目录项按`场次号`匹配标题前缀。回退策略：找不到匹配时按顺序索引（保留现有行为作为兜底）。

### D7. 拟物细节的边界

做：

| 细节 | 做法 |
|---|---|
| 书脊 | 书页左侧 6–10px 竖条，深色渐变 + 与叶片的分隔线 |
| 叠页 | 右/下边缘 2 层伪元素错位 1px + 更浅描边 |
| 页边暗角 | `radial-gradient` 叠在纸张底色上，内浅外深 |
| 纸张纹理 | `repeating-linear-gradient` 细斜纹，透明度由 `--reader-grain` 控制 |
| 书签 | 书页右上角 tag，显示当前场次号，点击展开目录 |
| 翻页过渡 | 切集时 `document.startViewTransition` + `translateX` + `fade`，不支持时降级为直接切换 |

不做：

| 不做 | 原因 |
|---|---|
| 3D 卷曲 | 需要 canvas 或 CSS 3D perspective，长文本每帧重排，掉帧 |
| 双页对开 | 版心宽度减半，中文长段落可读性下降 |
| 真实纸张纹理图 | 需要引入图片资产；CSS 渐变已足够表达 |
| 书页翻动音效 | 无音频资产，且默认静音是更好的默认 |

## Risks / Trade-offs

- **mermaid 主题漏映射** → 浅色纸张上出现深色图。缓解：`pageThemeVars()` 与主题定义同源，单测断言四套主题都有完整映射；主题切换时强制 `initialize` 一次。
- **mermaid 安全配置漏一项** → 剧本内容可执行脚本。缓解：`securityLevel: 'strict'` **且** `htmlLabels: false` 同时设置，并加一条渲染测试断言输出不含可执行节点。
- **Linux 缺 CJK 衬线** → 羊皮纸主题出现豆腐块。缓解：字体栈末位带通用 `serif`，主题不强制衬线；文档记录该限制。
- **两 tab 观感不同源** → 用户觉得「分镜页不像书」。缓解：分镜页沿用同一套纸张配色；在分镜页保留页眉集号集名，只是不套版心与页脚。
- **懒加载首次卡顿** → 打开含图分集时文本先出、图后到。这是预期行为；用骨架占位避免布局跳动。
- **验收契约** → 三处 `data-*` 选择器必须命中。`ScriptBookReader` 已支持 `previewAttr`，接线时把值写在同一元素上。
- **`.script-md-preview` 与新书页并存** → 两套样式共存，CSS 体积增加。可接受：分镜 tab 需要它。

## Migration Plan

1. 纯前端，无数据迁移。`ReaderPrefs` 新增 `theme` 字段，读取时缺省回 `'paper'`（`readReaderPrefs` 已有 clamp 模式）。
2. 回滚：`ScriptEpisodeDetail` 改回 `<ChatText>` 即可；新增的 CSS 与新组件不影响其他界面。
3. `mermaid` 是新增依赖，`npm install mermaid` 后需 `npm run build` 重新打包。
4. 无服务端改动，无宿主重启需求。

## Open Questions

无。
