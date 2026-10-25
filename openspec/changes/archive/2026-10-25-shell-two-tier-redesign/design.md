# Design

## Context

动机与范围见 `proposal.md`。这里只记录影响实现方式的现状约束：

- 上沿由三处独立代码产生：`App.tsx` 的 `<header className="topbar">`（54px，含画布专属工具的条件分支）、`EpisodeBar.tsx` 的整条横带（约 40px）、各工作台自己的工具条（`.wb-bar` 48px；角色/素材另有 `.board-head` 与 `.board-models`）。
- 高度在 `theme.css` 里各写一份：`.topbar { height: 54px }`、`.epbar { padding: 7px 14px }`、`.wb-bar { padding: 9px 14px }`；`@media (max-width: 1280px)` 才把顶栏改成 `flex-wrap: wrap`，1440–1500 之间没有规则。
- `.wb-bar` 与 `.wb-foot` 是同一套样式（2622 行与 2844 行重复定义了两遍），`.wb-bar` 没有 `flex-wrap`，`.wb-field .label` 没有 `white-space: nowrap`，这是「项 / 目」逐字换行的直接原因。
- 主题用语义 token：暗色 `--panel-2 (#111c28)` 比 `--panel (#0e1620)` 更亮，日间 `--panel-2 (#f8f4ec)` 比 `--panel (#fffdf8)` 更暗。现有冷色映射在日间把上沿压得比卡片更暗，层级方向与暗色相反。
- 聊天抽屉打开时内容列变窄，但上沿只按视口断点响应，因此抽屉一开就挤；`.workbench-chat-aside` 在 1180 以下改成覆盖式抽屉。
- 校验脚本的稳定定位点：`.topbar-project select`（约 40 处）、`.epbar-tab`（2 处）、`.wb-foot`（3 处）、`.wb-field`（1 处）、`.wb-genbtn`（1 处）、`.board-hint`（1 处）；视图切换大量依赖按钮文字（镜头表 43、提示词 5、画布 53 等），文字不能变。

## Goals / Non-Goals

**Goals:**

- 把上沿固定为两条带，位置与成分不随视图漂移；垂直占用在镜头表/提示词从 142px 降到 96px，角色/素材从约 180px 降到 96px。
- 每个视图只有一个强调主操作；全局工具降为非强调。
- 上沿在 1180–1500、聊天抽屉打开、日间主题三种情况下都保持结构可读。

**Non-Goals:**

- 不重做内容区：画布卡片、时间线、Inspector 四页、表格列、聊天消息流保持现有结构与样式。
- 不改导航模型：仍是顶部 7 个视图，不引入左侧栏、命令面板或路由。
- 不改数据与 API：不涉及 `project.json`、SQLite、模型路由、聊天运行时或技能契约。
- 不做视觉重设计（渐变、插画、动效）；这次只调整分层、位置、密度与强调预算。

## Decisions

### 1. Row 1 由 App 一次渲染，不再包含任何视图专属控件

`App.tsx` 的 header 改为固定成分：品牌、项目选择、集选择、视图导航、密钥告警、任务中心、主题、导出。画布的标注/操作/+素材/连播移入画布内的浮动工具条（`.canvas-tools`，绝对定位在画布左上，`z-index` 高于 React Flow 控件但低于 `.ctx-menu`）。

- 替代方案：把这些控件留在 Row 1，只在非画布视图隐藏。否决——位置会随视图变化，正是要消除的问题。
- 替代方案：把它们放进画布的 Row 2。否决——画布没有 Row 2，加一条又回到三层高度。

### 2. 集栏改成 Row 1 内的弹出选择器，保留 `.epbar-tab` 类

新组件 `EpPicker` 取代 `EpisodeBar` 的横条形态：触发器显示 `E01 夜雨 · 6 镜`，点开是带镜数的胶囊列表，当前项高亮。列表项继续用 `epbar-tab` 类，触发器用 `epbar-trigger`。

- 替代方案：集少时直接平铺胶囊、多了才收起。否决——同一控件两套形态，宽度不可预测，且行高会随集数变化。
- 替代方案：集放进导航作为二级 tab。否决——集是数据维度而非视图，会在视觉上把 7 个视图变成 7×N。

### 3. Row 2 是一个带三个命名槽位的组件，各工作台只填内容

新增 `WorkbenchBar`（范围 / 设置 / 动作三个 slot）。七个视图按 `proposal.md` 的表填槽；没有内容的视图不渲染该组件。样式落在 `.wb-bar` 上并保留类名，`.wb-field`、`.wb-foot`、`.wb-genbtn`、`.board-hint` 维持现状，避免校验脚本连锁改动。

- 替代方案：每个工作台自由布局自己的第二行。否决——三段位不固定，切换视图时眼动路径变化，且无法用一条容器查询统一响应窄宽度。
- 替代方案：用 CSS Grid 把现有 DOM 直接排成三段。否决——现有 DOM 顺序是「操作在前、统计在后」，Grid 只能靠 `order` 假装，键盘 Tab 顺序会与视觉顺序不一致。

### 4. 强调预算按视图计算，角色/素材随状态切换

每个视图显式声明一个 `primary` 动作：剧本=生成分集，镜头表=生成到画布（留在页脚），提示词=生成提示词（留在页脚），素材=全部加入画布（有图时）/从本集拆（空板），角色=全部注入（有未注入设定时）/从本集拆（空板）。导出 JSON、主题切换、任务中心、重新加载一律使用 `.btn` 或 `.btn-ghost`。

- 替代方案：保留导出 JSON 为全站主按钮。否决——它在每个视图都可点，但几乎从不是当前意图。
- 替代方案：角色/素材固定一个主按钮。否决——空板时的「全部加入画布」永远不可用，主按钮长期处于禁用态。

### 5. 角色/素材的头部合并进 Row 2，说明文字只在空板出现

`.board-head` 的标题进范围槽（`角色 · E01 · 5 个 · 当前镜头 S03`），`.board-models` 进设置槽，`.board-acts` 进动作槽。说明段落改为空板时的一行提示，用组件内 `useState` 控制关闭，不写 localStorage——下次打开重新提示一次，符合「会话内不再出现」。

- 替代方案：说明文字进 `title`/tooltip。否决——新用户看不到，等于删掉。
- 替代方案：说明常驻但收成一行。否决——仍然占用上沿，且每个视图都有一行解释会稀释操作密度。

### 6. 聊天头部不再重复项目与集号

`WorkbenchHeader` 的范围 chip 改为范围词（`全剧` / `本集` / `当前镜头`），不再拼「第 N 集」；`scope()` 的返回改为语义范围而不是集号。项目名与集号只保留在 Row 1。

- 替代方案：保留「第 1 集」，理由是聊天是独立区域。否决——脚本页的集号在 Row 1 与聊天头部各出现一次，正是要消除的重复；范围词反而更准确表达「这批改动影响哪里」。

### 7. 新增上沿专用表面 token，修正日间层级方向

在 `:root` 与 `html[data-theme='day']` 各加三个字面值 token：`--chrome-1`（Row 1 表面）、`--chrome-2`（Row 2 表面）、`--chrome-line`（上沿分隔线）。暗色取 `--panel-2` / `--panel` 附近的值，日间取比内容更亮的暖白（例如 `#fffefb` / `#fbf8f1`），确保两套主题下上沿都在内容之上而不是陷进去。同步更新 `STYLE-GUIDE.md` 的 token 表。

- 替代方案：直接复用 `--panel-2` / `--panel`。否决——日间这组值的方向与暗色相反，会让上沿显得凹陷。
- 替代方案：用 `filter`/`color-mix` 派生。否决——STYLE-GUIDE 明确要求 token 写字面值，且 `color-mix` 在日间套色时容易漂。

### 8. 断点用视口，带内挤压用自身宽度测量

- Row 1：`>=1400` 全量；`1280–1400` 隐藏 `.brand-sub`、集 chip 只留集号；`<1180` 有意图地折成「身份 + 导航」两行（导航 `flex: 1 0 100%`，`spacer` 在窄屏隐藏）。
- Row 2：`WorkbenchBar` 用 `ResizeObserver` 量自身宽度，写 `data-density`（`wide` / `narrow` / `tight`）。`narrow` 收起范围细节与可选说明；`tight` 再收起设置槽。动作槽永不换行。
- 集选择器的弹层 portal 到 `body` 并用 `position: fixed` 定位——Row 1 在窄屏折行时没有稳定的相对定位参考。

- 替代方案：全用视口断点。否决——聊天抽屉造成的列宽变化与视口无关，无法覆盖。
- 替代方案：Row 2 用 `container-type: inline-size` + `@container`。否决——`.board` 里有 `position: fixed` 的语音抽屉与模态遮罩，加 `container-type` 会把它们改成相对板定位。`ResizeObserver` 只读尺寸，没有这个副作用。
- 替代方案：给每个工作台传 `chatVisible` 类来控制密度。否决——把布局状态耦合进每个业务组件，且与容器真实宽度仍可能不一致。

### 9. 无障碍语义

导航按钮加 `aria-current="page"`，导航容器加 `aria-label="工作台视图"`；集选择器触发器用 `aria-haspopup="listbox"` + `aria-expanded`，列表用 `role="listbox"`，项用 `role="option"` + `aria-selected`，支持 `ArrowUp/Down`、`Home/End`、`Enter`、`Esc`，关闭后焦点回到触发器。主题开关保持现有 `aria-pressed` 与可见文字。

- 替代方案：用原生 `<select>`。否决——集需要显示镜数与标题，原生 select 无法做两行结构，也无法在触发器上同时显示当前集标题。

## Risks / Trade-offs

- **[`.epbar-tab` 只在弹出后才存在]** → `verify-3d-render-asset-flow.mjs` 与 `verify-workbench-chats.mjs` 的切换集操作会失败。缓解：两个脚本改为先点 `.epbar-trigger` 再点 `.epbar-tab`，并在任务清单里单列一项；其余 40 处 `.topbar-project select` 与按文字定位的导航不受影响。
- **[容器查询会给 `.board` 建立包含块]** → 实测发现板上还有 `position: fixed` 的语音抽屉与模态遮罩，加 `container-type` 会把它们改成相对板定位。改用 `WorkbenchBar` 内部 `ResizeObserver` 量自身宽度并写 `data-density`，只读尺寸、不建立包含块，行为等价。
- **[上沿压缩后画布工具被迷你地图或提示条遮挡]** → 浮动工具条固定在左上，`canvas-hint` 平移居中、MiniMap 右上；在 900px 宽下把工具条折成图标按钮。
- **[角色/素材首屏上移 80px 后，空板提示位置显得突兀]** → 空板提示放进内容区顶部而不是上沿，与卡片网格同宽。
- **[一次性改动面大，回归难以定位]** → 分三步提交：先结构与 token、再逐视图填 Row 2、最后补密度响应与无障碍；每步跑 `verify-workbench-chat-ui.mjs`、`verify-shot-inspector.mjs`、`verify-project.mjs`、`verify-chars.mjs` 四条冒烟。
- **[日间新 token 与现有 Paper Studio 观感不一致]** → 只加三个表面 token，不动强调色与文字色；改完跑 `node verify-style.mjs` 确认对比度与 token 解析。

## Migration Plan

无数据迁移，无服务端改动，回滚即 revert 提交。上线顺序：

1. 结构与 token：新增 `--chrome-1/2/line`、`WorkbenchBar`、`EpPicker`，把 Row 1 固定下来，画布工具移入画布。
2. 逐视图接 Row 2：镜头表 → 提示词 → 剧本 → 角色 → 素材；每接一个就删掉对应旧工具条/头部。
3. 响应式与无障碍：容器查询、显式断点、`aria-current`、listbox 键盘行为。
4. 校验脚本与证据：更新 2 个集切换脚本，重拍 5 组上沿截图（画布、镜头表、提示词、角色、素材，日夜各一）。

## Open Questions

无。范围、导航模型与三处细节（角色/素材主按钮随状态、说明只在空板、集始终用选择器）已在探索阶段拍板。
