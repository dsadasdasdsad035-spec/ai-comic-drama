# Design

## Context

动机见 `proposal.md`。这里只列决定方案的现状与约束。

**主题与圆角已经对齐，缺口只在尺度。** `StudioFrame` 的 `studioStyleText()`（`src/creative/StudioFrame.tsx:230-248`）已经把宿主圆角轴压到应用的 4/5/7/10 体系，并通过 `LIGHT_TOKENS` / `DARK_TOKENS` 映射了表面、文字与状态色。剩下的差异是字号、侧栏顶部带与导航行高。

**宿主字号是内联写的。** `ThemePresenter.apply()` 把字号写到 `document.body.style`（`packages/client/ui-layout/src/client/theme-presenter.ts:78`），而正文派生 tokens（`--dsh-content-font-delta` 等）声明在 `body` 上（`packages/client/ui-theme/src/styles/gradient-shadow-text.css` 的 `body` 段）。因此覆盖必须落在 `body`，且要能压过内联声明。

**部分字号是硬编码的。** 侧栏根节点写死 14px（`SidebarRoot.module.css:21`），会话列表标题、搜索标题与重命名输入也写死 14px（`ui-workspace/src/client/rows/Rows.module.css:73/186/192`），不跟根节点继承。

**类名是带哈希的局部名，且两种形态的哈希位置不同。** 开发态是 `_logoRow_1rdzk_1`（局部名在前），构建产物是 `_2ElO2G_logoRow`（哈希在前）。现有代码按 `[class*="_brandName"]` 这类子串匹配（品牌降噪），本设计沿用同一策略，但**子串不能带尾部下划线**：`[class*="_logoRow_"]` 只命中开发态，在构建产物里整条规则永不生效。`tests/studio-shell.mjs` 有一条用例专门守这个约束。

**列宽不可用样式覆盖。** 侧栏宽度由 `AppFrame` 以内联 `grid-template-columns` 计算（`ui-layout/src/client/columns.ts:14-22`，下限 264、默认 280），CSS 覆盖会连带破坏拖拽与折叠动画。应用的 240/64 与宿主的 280/56 因此不在本 change 范围内。

**侧栏是宿主启动的必需条目。** `ui-sidebar` 在 `requiredClientEntryNames` 里（`packages/client/web/src/boot-client.ts:25-32`），不能通过禁用换壳；本 change 不改结构。

## Goals / Non-Goals

**Goals:**

- 三处尺度（字号、侧栏顶部带、导航行）在应用与宿主之间对齐，全部通过现有注入表实现。
- 规则幂等、可单独回滚，不影响会话列表、消息流与输入区功能。
- 宿主类名漂移时只退回默认尺度，不报错、不阻断加载。

**Non-Goals:**

- 不改 iframe 挂载方式、不改宿主源码、不改 profile/bundle 组成。
- 不改侧栏列宽，不改主题与配色（已对齐）。
- 不做导航一体化（应用侧栏与宿主侧栏并存的结构保持不变）。

## Decisions

### D1：所有规则继续放在 `studioStyleText()`

复用 `installStudioStyle()`：它按 `STUDIO_STYLE_ID` 幂等复用，插在 `head` 末尾，同权重下后插入的规则获胜。新增文件或新注入点只会让"创意视图注入了哪几段样式"更难追。

**备选与否决**：在 `applyStudioTheme` 里逐条写内联变量——只能表达变量，表达不了行高与顶部带这类规则，还会和宿主的观察者互相触发。

### D2：字号覆盖需要 `!important`，并同时覆盖硬编码位置

宿主把 `--dsh-content-font-size` 内联写在 `body` 上，普通样式表声明赢不过内联；只有 `!important` 能覆盖。侧栏根节点与会话行标题是硬编码 px，不继承根字号，所以必须逐个点名：

```css
body { --dsh-content-font-size: 13px !important; }
[class*="_sidebarCol"] { font-size: 13px; }
[class*="_sidebarCol"] [class*="_title"],
[class*="_sidebarCol"] [class*="_searchResultTitle"],
[class*="_sidebarCol"] [class*="_renameInput"] { font-size: 13px; line-height: 18px; }
```

**为什么用 `!important`**：不是为了和宿主打架，而是内联声明在层叠里本来就更高；不用的结果是"设置页关掉也不生效"。

**为什么带上会话行**：只改根节点会得到"导航 13px、会话列表 14px"的混排，比不改更难看。

**代价**：宿主设置里的正文字号偏好不再生效。这与现状一致——外观行已被 `hideHostAppearanceRow` 隐藏，应用本来就是明暗与尺度的唯一决定者。

**备选与否决**：只覆盖根节点——会话列表仍大一号；用 `zoom` 缩放整页——会同时缩放留白与控件，失控。

### D3：侧栏顶部带压到 44px

`logoRow` 固定 60px（`SidebarRoot.module.css:236`），而品牌标记与名称已经被降噪规则隐藏，这一行实际只剩右侧 28px 的折叠按钮。压到 44px（8 + 28 + 8）能让按钮中心落在 y=22，与对话标题行中心（10px inset + 30px 行，约 y=25）相差 3px，满足规格里"不超过 4px"。

**为什么不整行隐藏**：折叠按钮是窄屏断点后唯一的恢复入口（宿主在 1024px 以下会自动折叠），藏掉会让用户回不到展开态。

**为什么不是 52px**：应用 topbar 是 52px，但它在 iframe 外面；里面再放一条同高带子会变成第二层顶栏，反而更割裂。

### D4：导航行按应用导航的密度压

应用导航按钮是 padding 7×9、12px 字、实际约 28–30px；宿主 `panelRow` 是 `min-height: 32px` + `line-height: 22px`（`SidebarRoot.module.css:708-724`）。

做法是优先改宿主自己的变量：`--dsh-sidebar-row-padding: 9px`（对齐应用的 9px 左右留白），再补 `min-height: 30px` 与 `line-height: 18px`。这样行内 padding 由宿主公式 `calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset))` 自动跟随，不需要硬改 padding。

**备选与否决**：直接覆盖 `padding`——会把宿主的 3px paint inset 一起抹掉，悬停底色比行框宽，出现错位。

### D5：选择器按"作用域 + 局部名子串"，失配即退化

用 `[class*="_sidebarCol"]` 限定在侧栏子树内，避免 `[class*="_title"]` 这类泛化局部名误伤对话区。命中失败时规则不生效，视觉退回宿主默认，功能不受影响——这与品牌降噪的约定一致。

子串一律**不带尾部下划线**：开发态 `_logoRow_1rdzk_1` 与构建产物 `_2ElO2G_logoRow` 只有去掉尾部 `_` 才同时命中。这条约束由测试断言（扫描注入文本里的每个 `[class*="…"]`），命中失败时用例先红。

为了让漂移可见而不是无声回归，测试断言注入文本包含这三组规则；宿主改名时用例先红，而不是等用户发现"又变回去了"。

### D6：不覆盖列宽

侧栏宽度是内联 grid 的计算结果，还带拖拽句柄与折叠动画。样式覆盖只能改视觉、改不了计算，拖拽一开始就会被写回原值，表现为"拖一下跳一下"。

**要真对齐列宽**只有两条路：改应用 `--rail-w`（240 → 264，牺牲应用自己的密度），或改宿主列宽下限（子模块改动）。都不在本 change 内。

## Risks / Trade-offs

- **上游类名漂移** → 规则按子串匹配且失配即退化；测试断言注入文本，漂移先由用例暴露。
- **覆盖宿主字号偏好** → 外观行已隐藏，用户没有入口改；文档写明"应用是尺度的唯一决定者"。
- **`_title` 仍可能误伤** → 加 `_sidebarCol` 作用域后只影响侧栏；出现误伤时收敛到更具体的局部名。
- **窄屏断点** → 宿主在 1024px 以下自动折叠侧栏，顶部带与行高要在窄屏下再验一次，人工清单覆盖 1000px 宽。
- **会话行新增硬编码字号** → 当前覆盖了已知三处；上游新增同类位置时靠人工验收发现，必要时把字号收敛成"侧栏子树内的统一覆盖"。

## Migration Plan

纯前端注入，无数据迁移、无服务端与磁盘状态变化。

分两次提交，便于独立回滚：

1. 顶部带 + 导航行：只改 `studioStyleText()` 与注入文本断言。
2. 字号：在 1 之上追加三条选择器；回滚即删除这三条。

回滚都等于恢复宿主默认尺度，不影响会话数据与宿主进程。
