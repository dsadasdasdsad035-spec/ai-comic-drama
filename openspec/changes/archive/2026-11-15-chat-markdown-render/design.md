# Design

## Context

见 `proposal.md` - Why。技术现状与硬约束：

- 唯一渲染入口是 `src/chat-ui/ChatText.tsx`，对外签名 `{ text: string }`，被 `CreativeStudio`、`SceneAgentChat` 通过 `MessagePrimitive.Parts components={{ Text: ChatText }}` 使用。原第三个调用点 `SkillChat` 已无引用，随死代码清理移除（同批删除未被挂载的 `PromptRefineModal`），渲染层不需为它保留分支。
- 现状只做围栏代码切分：正则 `/```([^\n`]*)\n([\s\S]*?)```/g` 成对匹配，命中段交给 `ChatCodeBlock`（带 `data-chat-code`、`data-open`、语言与行数、默认收起），其余文本落进 `div.whitespace-pre-wrap`。
- `ChatCodeBlock` 是既有契约，被验证脚本与样式依赖，本次不动它。
- `src/chat-ui/chat.css` 在 `.chat-ui` 作用域内有一条全局 reset：`h1~h4 / p { margin: 0; font-size: inherit; font-weight: inherit }`、`a { color: inherit; text-decoration: none }`。不改它，Markdown 的层级与链接在视觉上等于不存在。
- 主题侧已有 `--code-bg` / `--code-fg`（`src/theme.css`，明暗两套），`ChatCodeBlock` 已在用。
- 项目无任何 Markdown 库，也无 `@tailwindcss/typography`；组件风格是手写小组件 + `verify-*.mjs` 逐项验证。
- 会话侧栏实际宽度约 360-420px，表格是最容易溢出的语法。

## Goals / Non-Goals

**Goals:**

- 所有挂载了 `ChatText` 的会话共用一套 Markdown 渲染契约，改一处全部生效。
- 围栏代码块的折叠行为、DOM 标记与现状字节级一致，不制造回归面。
- 在窄栏里表格可用（横向滚动，不撑破容器）。
- 排版层级由作用域样式提供，与 `chat.css` 的 reset 共存不冲突。

**Non-Goals:**

- 不做语法高亮（`ChatCodeBlock` 仍为纯文本 `<code>`）。
- 不做 Markdown 编辑器 / 所见即所得输入。
- 不引入 `@tailwindcss/typography` 或改造现有 `chat.css` 全局 reset。
- 不处理移动端更窄宽度下的表格转卡片形态。
- 不改服务端：不做 MD → HTML 预渲染，全部在客户端渲染。

## Decisions

### D1：用 `react-markdown` 而不是 `marked` + `DOMPurify`，也不自写解析器

`react-markdown` 直接产出 React 树，不经过 `dangerouslySetInnerHTML`，默认不渲染原始 HTML（不装 `rehype-raw` 即无 XSS 面），且 URL 默认经过 `urlTransform` 过滤 `javascript:` 协议。`marked` 方案需要 `innerHTML` + 自行接 sanitizer，多一层安全责任；自写解析器要覆盖嵌套列表、表格对齐、转义，成本与出错率都高于引依赖。

代价是 unified/micromark 生态体积（gzip 约 100KB 量级）。桌面 Electron 端可忽略，Web 端如需优化可后续按需动态 `import()`，不在本期。

### D2：插件集固定为 `remark-gfm` + `remark-breaks`

- `remark-gfm` 提供表格、删除线、任务列表、自动链接。
- `remark-breaks` 把软换行转成 `<br>`。**没有它，模型说明的多行会被合并成一段**——这是本改动最容易漏掉的一步，因为 CommonMark 语义里单换行本来就不换行。

### D3：代码块由 `components.pre` 接管，而不是 `components.code`

`react-markdown` v9+ 已移除 `code` 组件的 `inline` 参数，靠 `inline` 区分行内/块级不可行。改为在 `components.pre` 里从子节点提取 `language-xxx`（来自 `code` 的 `className`）与纯文本，整体渲染 `ChatCodeBlock`；行内代码则交给 `components.code` 的默认样式类。

这样做的收益：块级判定不依赖子节点结构猜测，`data-chat-code` 折叠契约天然保留，`ChatCodeBlock` 无需任何修改。

### D4：排版样式新建 `chat-markdown.css`，用 `.chat-ui .chat-md` 双类优先级覆盖 reset

- 不动 `chat.css` 里的 reset：那条 `a { text-decoration: none }` 与 `h1~h4 { font-size: inherit }` 被其它聊天 UI 元素（卡片标题、状态行）依赖，改成 `:not(.chat-md)` 会牵动不可预期的地方。
- 新增文件用 `.chat-ui .chat-md h2` 这类双类选择器，特异性高于 `.chat-ui h2`，无需 `!important`。
- 在 `chat.css` 顶部 `@import './chat-markdown.css';`。理由是 `chat.css` 已被 `App.tsx` 与 `SceneAgentChat.tsx` 两处引入，用 `@import` 可让新样式自动生效，调用点与两个引入点都不需要改。

样式范围：`h1~h4` 层级字号、`p` 段落间距与末段去 margin、`strong`/`em`、`ul`/`ol` 缩进与标记、`blockquote` 左边框 + muted、`a` accent 色 + 下划线、行内 `code` 底色与圆角、`hr`、表格容器。

### D5：表格通过 `components.table` 包一层横向滚动容器

给 `table` 外面套 `div.overflow-x-auto` + `table{min-width:max-content}`。备选方案是纯 CSS `table{display:block;overflow:auto}`，但那会让 `thead`/`tbody` 布局退化、表头与内容对不齐，弃用。

### D6：用户消息与助手消息统一渲染，不加开关

`ChatText` 保持单一行为，不引入 `plain` prop。用户粘贴的 prompt 里 `-`/`1.` 被渲染成列表是加分项；`*`、`#` 误判为语法的概率低且视觉无害。若日后出现真实误渲染再补开关，属于可增量加的接口。

### D7：删除 `splitFencedCode`，流式未闭合围栏行为随之变化

现路径会把未闭合 fence 当普通文本，收尾后才变折叠块——流式过程中会出现一次视觉跳变。改由 micromark 解析后，未闭合 fence 会被当作代码块解析到文本末尾，视觉上更平滑。

`splitFencedCode` 目前只被 `ChatText` 自己引用（已确认无测试或其它模块 import），直接删除，不留死代码。

### D8：链接统一加 `rel="noreferrer"` 与 `target="_blank"`

通过 `components.a` 注入，配合 `react-markdown` 默认的 `urlTransform` 协议过滤，避免在 Electron 内嵌 webview 里被恶意链接接管当前窗口。

### D9：流式期间不做渲染降级

`react-markdown` 每个 token 会重解析整段文本（当前代码每帧也在重跑正则），几 KB 量级在 360px 面板内实测可控。先按最简实现上线，若流式出现明显掉帧，再按消息 `status === 'running'` 降级为纯文本——这条不改变渲染契约，留作后续优化。

## Risks / Trade-offs

- [reset 覆盖不彻底，Markdown 渲染成"没有层级的粗黑字"] → 双类选择器 + `verify` 断言 computed 字号/字重，而不只断言 DOM 节点存在。
- [表格在窄栏撑破布局] → `overflow-x-auto` 容器 + `min-width:max-content`，验证里放一张 5 列表格。
- [会话的前缀分支回归：`第 N 轮 …`、`已取消`、`失败：`] → 这些判断都在文本进渲染器之前执行，逐个补 verify 用例覆盖。`【图片处置】` 随 `SkillChat` 删除一并消失。
- [用户消息里 `*` 被当作列表/强调] → 已知取舍，概率低、视觉无害，记为可增量修的接口。
- [Web 端首屏体积增加约 100KB gzip] → 桌面端可接受；Web 端作为已知代价，后续可按需动态引入。
- [围栏代码在流式中途的渲染由"裸文本"变为"代码块"] → 与现状不同但更平滑，验证脚本改为接受该行为，避免把旧行为写成断言。
- [依赖升级带来的 React 版本约束] → 选用兼容 React 18.3 的 `react-markdown` 主线版本；安装后跑 `tsc --noEmit` 确认类型无冲突。

## Migration Plan

1. 安装 `react-markdown`、`remark-gfm`、`remark-breaks`。
2. 新增 `src/chat-ui/chat-markdown.css`，并在 `chat.css` 顶部 `@import`。
3. 重写 `ChatText`，删除 `splitFencedCode`。
4. 新增 `verify-chat-markdown.mjs`，覆盖标题/粗体/列表/表格/行内代码/折叠代码块/前缀分支。
5. 逐个跑创意会话与 3D 调度会话的验证脚本。

回滚：`ChatText.tsx` 单文件回退到 `splitFencedCode` 版本，删除新增 CSS 与三个依赖，无数据迁移、无服务端改动。

## Open Questions

- 流式长文本的渲染开销是否需要按 `status` 降级，等实测数据决定；不影响需求与任务拆分。
