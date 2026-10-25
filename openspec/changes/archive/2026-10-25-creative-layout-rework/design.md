# Design

## Context

动机与范围见 `proposal.md`，行为契约见 `specs/creative-layout/spec.md`。这里只记录影响实现方式的现状：

- 结构是 `creative-studio`（flex row）→ `CreativeSessionList`（208px，≤980px 变覆盖抽屉）+ `creative-main`（flex col）→ `CreativeHeader`（55px）→ `ChatThreadShell` → `CreativeCards`（作为 `ChatRoot` 的子节点，渲染在消息视口上方，`max-height: 42%`）+ `ChatThreadBody`（视口 + 输入）→ `CreativeComposerBar`（37px）。
- `CreativeCards` 只用 `Card` / `Badge` 等展示组件，不引用 assistant-ui 的 hooks；它的样式依赖 `.chat-ui` 作用域里定义的 `--card`、`--border` 等 token。
- `.chat-ui` 把 `--muted` 重定义为 `var(--bg-2)`（表面色），与 `theme.css` 全局的 `--muted`（文字色）同名不同义。`.creative-empty p` 用的是 `var(--muted)`，而空态渲染在 `.chat-ui` 内，于是文字色变成背景色：日间 1.09:1、夜间 1.06:1。`.creative-empty-tips` 用 `--text-2`，所以可见——同一块区域里只有两段正文消失。
- `App.tsx` 用 `view !== 'creative'` 条件渲染 `ProjectSelect` 与 `EpPicker`，两者在正常流里，移除后 `.viewtabs` 从 x=597 移到 x=221。
- 消息正文受 `ChatMessage` 的 `max-w-[94%]` 约束，主列多宽它就多宽；输入框是 `w-full`。
- `.creative-composer-bar` 不接收模式判断，策划模式下也整行渲染，切分/抽帧因为无源视频而禁用。
- `.creative-empty` 的静态 tips（`<li>`，不可点击）与输入框上方的 `[data-chat-suggestion]` 按钮承担同一职责；反推模式下两边都有「只重写第 2、5 镜」。
- 会话列表行宽 199px、标题可用 139px，`createdAt` / `updatedAt` 数据已有但未渲染；改名/删除是两个常驻单字按钮。
- 校验脚本的稳定钩子：`[data-creative-studio]`、`[data-creative-sessions]`、`[data-creative-session]`、`[data-creative-header]`、`[data-creative-modes]`、`[data-creative-empty]` 及其 `input[type=file]`、`[data-chat-suggestion]`、`[data-chat-input]`、`[data-creative-composer-bar]`、`[data-creative-action="*"]`。

## Goals / Non-Goals

**Goals:**

- 让「聊天是主界面」成为结构事实：产物不再压缩对话高度。
- 让正文在任何视口下都可读（≤ 640px、≤ 50 汉字/行）。
- 让创意视图内的文字在两套主题下都达标，并消除同类 token 撞名的复发条件。
- 让媒体控件只在有用的模式出现，示例与模式标签不重复。
- 进入/离开创意时全局导航不位移。

**Non-Goals:**

- 不改会话数据模型、创意 API、工具集、成本确认、晋升流程与模型路由。
- 不改 `ChatThreadBody` / `ChatMessage` / `ChatViewport` 的公共行为——另外七个工作台的聊天继续按原样渲染。
- 不重排全局带（导航仍排在项目与集之后）。
- 不引入可拖拽的产物栏宽度或分栏持久化布局。

## Decisions

### 1. 产物栏是对话右侧的第三列，折叠状态记本机

`creative-main` 内部改成 `creative-body`（flex row）：左侧 `creative-conversation`（flex col，含 ChatThreadShell 与 composer），右侧 `CreativeArtifacts`（320px，`flex: 0 0 auto`）。折叠时该列宽度为 0 并从可访问树移除；状态存 `localStorage['creative:artifacts:open']`，按会话不区分（产物栏是显示偏好，不是会话数据）。

- 替代方案：保留上方横带、把 `max-height` 从 42% 降到 25%。否决——高度仍是对话与产物的零和，视口矮时两边都不够用。
- 替代方案：产物做成浮层抽屉覆盖对话。否决——宽屏下用户需要「边看产物边对话」，覆盖会打断对照。
- 替代方案：可拖拽宽度 + 按会话记忆。否决——首版不需要，且引入持久化数据结构。

### 2. 产物栏保留 `.chat-ui` token 作用域

`CreativeArtifacts` 的根节点加 `chat-ui` class。卡片组件（`Card`/`Badge`）依赖 `--card`、`--foreground`、`--border` 等在 `.chat-ui` 内定义；离开该作用域这些类会解析成透明或默认值。给根节点加同一个 class 可以让 token 解析与聊天区一致，且不引入第二套卡片样式。

- 替代方案：把卡片改成 `theme.css` 的原生类。否决——两套视觉语言并存，后续产物卡改版要维护两份。
- 替代方案：把产物栏放进 `ChatRoot` 内（靠 flex 排到右侧）。否决——`ChatRoot` 是纵向 flex 容器，横排要改公共组件，影响另外七个工作台。

### 3. 阅读宽度用创意视图自己的容器约束，不改公共聊天组件

在 `.creative-conversation` 内给消息视口与 composer 的内容加 `max-width: 640px; margin-inline: auto`。实现上通过 `.creative-conversation .chat-ui` 下的 CSS 限定作用，或用组件传入的 `className` 扩展点。

- 替代方案：改 `ChatMessage` 的 `max-w-[94%]` 为固定 `max-w-[640px]`。否决——会同时改变七个工作台的聊天宽度，超出本次范围。
- 替代方案：用 `ch` 单位按字符数设宽。否决——`ch` 基于 `0` 的宽度，中英文混排结果不稳定；直接给 px 更可测。

### 4. 空态颜色改用不会被聊天作用域覆盖的 token

`.creative-empty` 的正文与提示改用 `--text-2`，标题保持继承的 `--text`。同时在 `theme.css` 的创意区块加注释约束：在 `.chat-ui` 子树内渲染的规则，文字色只用 `--text` / `--text-2` / `--muted-foreground`，不用 `--muted`（它在该作用域是表面色）。

- 替代方案：把 `.chat-ui` 的 `--muted` 改名。否决——它被 `chat.css` 的 Tailwind 主题映射和多个 `bg-muted` 用法依赖，改名波及面远超本次范围。
- 替代方案：给 `.creative-empty` 单独定义局部 `--muted` 覆盖。否决——能修好这一处，但下一个人写 `var(--muted)` 时仍会踩同一个坑。

### 5. 导航位移用占位几何解决，不重排全局带

`App.tsx` 在创意视图下仍然渲染 `ProjectSelect` 与 `EpPicker` 的包装容器，但整块 `visibility: hidden` + `aria-hidden`，并设 `inert` 使其不可聚焦。这样几何与实际项目视图完全一致（包括项目名长短造成的宽度变化），导航位置零位移，而屏幕上不显示、屏幕阅读器不播报、键盘不可达。

- 替代方案：把导航移到品牌之后（品牌 → 导航 → 项目 → 集）。更彻底，但会改动其余七个视图的顶栏顺序，并让刚归档的 `shell-two-tier-redesign` 证据截图失效；超出「优化创意布局」的范围。
- 替代方案：给包装容器一个固定宽度（如 372px）。否决——项目选择器宽度随项目名变化，固定宽度在长项目名下反而制造新的位移。

### 6. 媒体摄取条按模式整条不渲染

`CreativeComposerBar` 增加 `mode` 判断在调用侧生效：`plan` 模式不挂载该组件（不是仅禁用）。反推/复刻模式挂载；其中切分与抽帧仍按「有无源视频」禁用。空态里的上传入口保持不变，因为它是空态自身的起点，不属于摄取行。

- 替代方案：保留整行并全部禁用。否决——策划模式下四个灰控件是纯噪音，还占 37px。
- 替代方案：策划模式改成「附加素材」折叠入口。否决——策划不消费视频，多余的入口只会引导错误操作。

### 7. 示例只留可点击的一组

删除 `CreativeEmpty` 里的 `creative-empty-tips` 列表；保留输入框上方的 `[data-chat-suggestion]` 按钮（点击只填输入框）。空态本身仍保留标题、说明与（反推/复刻模式的）上传入口。`verify-creative-ui.mjs` 里 `[data-chat-suggestion] >= 3` 的断言因此继续成立。

- 替代方案：保留 tips 并把 chips 改成不可点击。否决——chips 能一键填好输入，是更好的交互；tips 只是文字。
- 替代方案：空态显示 chips、有消息后隐藏 chips。否决——`ComposerSuggestions` 在两种状态下都有用，多一条状态分支不值得。

### 8. 会话行两行结构 + 悬停操作入口

每行改为：第一行标题（`truncate`，可用宽度 ≥150px），第二行 `模式 · 相对时间`（如「反推 · 3 分钟前」）。改名/删除收进行尾的 `⋯` 按钮，默认 `opacity: 0`（仍占位，避免布局跳动），在 `:hover` 或 `:focus-within` 时可见；按钮本身可聚焦，菜单项可键盘选择。相对时间用 `updatedAt` 与当前时间差，超过 7 天显示日期。

- 替代方案：操作按钮常驻但改成图标。否决——单字按钮已经是妥协，图标在没有图标的列表里更不协调。
- 替代方案：操作收进右键菜单。否决——不可发现，也与列表的键盘语义不一致。

### 9. 头部次要信息单行省略

`data-creative-context` 那行改为 `flex-wrap: nowrap` + `overflow: hidden`，每一项 `white-space: nowrap`，末尾的超长项（模型短名、技能 id）`text-overflow: ellipsis` 并用 `title` 提供完整值。模型显示优先用 `m.model`（如 `MiniMax-M3`），找不到时退回 `key`。能力托盘按钮保留在这一行末尾。

- 替代方案：把该行拆成两行。否决——头部高度增加 15px，收益只是少一次悬停。
- 替代方案：把技能 id 移进能力托盘。否决——技能是判断「这轮走哪个技能」的关键信息，不该藏在二级面板里。

## Risks / Trade-offs

- **[移动 `CreativeCards` 出 `ChatRoot` 可能丢失 assistant-ui 上下文]** → 已确认该组件不使用 assistant-ui hooks；任务里要求移动后跑 `verify-creative-reverse.mjs` 与 `verify-creative-export.mjs`，断言产物卡的动作仍可触发。
- **[640px 阅读宽度对提示词包卡片偏窄]** → 产物卡搬进产物栏（320px）后，消息里只剩工具卡；对可能出现的长提示词文本，要求卡片内部 `overflow-wrap: anywhere`，不得撑破列宽。
- **[产物栏 320px 在 1280px 视口下挤压对话列]** → `<1280` 时产物栏改为覆盖式抽屉（与 980px 的会话列表同一模式），对话列始终保留 ≥560px；两条断点都要有断言。
- **[占位隐藏可能残留可聚焦元素]** → 必须同时 `aria-hidden` 与 `inert`；任务里用只按 Tab 的脚本路径验证焦点不会停在隐藏的选择器上。
- **[删除空态静态示例后，原先靠它传达的「点示例只填入」提示丢失]** → 保留 `creative-empty-hint` 这一行说明，它不重复示例内容。
- **[两个 `.chat-ui` 根节点使 token 作用域重复]** → 两者都从同一份 `chat.css` 取值，不新增覆盖；代价是 CSS 变量计算多做一次，可接受。

## Migration Plan

无数据迁移、无服务端改动，回滚即 revert。上线顺序：

1. 修颜色（最小、独立可验证）→ 空态与提示在日夜都清晰。
2. 三列骨架 + 产物栏（含折叠与窄屏抽屉）→ 对话高度不再被压缩。
3. 阅读宽度 + 头部单行 + 媒体条模式化 + 示例去重 → 密度收口。
4. 会话行两行与更多菜单 + 导航占位 → 交互与外壳稳定。
5. 更新四个 `verify-creative-*.mjs` 并重拍创意视图证据截图（1500 / 1280 / 900 三个宽度 × 日夜）。

## Open Questions

无。产物放右栏、导航用占位而非重排、示例保留可点击 chips，这三项已在探索阶段确定。
