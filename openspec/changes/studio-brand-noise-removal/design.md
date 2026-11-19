# Design

## Context

见 `proposal.md`「Why」。影响实现取舍的现状：

- 创意视图是同源 iframe，指向 dsh 宿主前端；应用侧唯一的样式入口是 `src/creative/StudioFrame.tsx` 的 `studioStyleText()`，在 `attachBridge()` 与 `MutationObserver` 回调里反复安装。
- 现状已隐藏四类目标：`[class*="_buildVersion"]`、`[class*="_localBuildBrand"]`、`[class*="_brandName"]`、`[class*="_fish"]`。
- 宿主侧栏的品牌标记同时是「新会话」入口（macOS 桌面端退化为窗口拖拽区）；折叠轨道里同一图形是展开按钮的静止形态，悬停才换成面板图标（`SidebarRoot.tsx` 296-300、340-344）。
- 空白首页的像素鲸是 `canvas[data-home-whale]`，18% 不透明度灰度水印，`pointer-events: none`。
- 宿主 CSS Module 构建后类名为 `<hash>_<semanticName>`，哈希在前，`[class*="_semanticName"]` 可稳定命中；语义名属于宿主内部实现，升级后可能改名。

## Goals / Non-Goals

**Goals:**

- 三处仍可见的宿主品牌图形全部隐去，且隐藏后不留下不可见的交互热区。
- 侧栏行高、折叠按钮位置、消息区与输入区版式保持不变。

**Non-Goals:**

- 不改 dsh 子模块源码，不改宿主插槽注册（`sidebar.brand.mark` / `conversation.hero.frame`）。
- 不引入应用自己的品牌图形替代宿主图形。
- 不动运行状态里的鲸鱼尾巴动效：它是「深度潜水…」的进度指示，不是产品身份。

## Decisions

### 决策 1：继续用注入样式，不改宿主源码

沿用现有降噪通道，在 `studioStyleText()` 追加规则。备选是给 `dsh.profiles/web` 关掉 `ui-brand-official` 插件或改宿主源码：前者会连带失去 `conversation.hero.frame` 的插槽占用（首页装饰层），后者违反「不为创意视图 fork `packages/client/ui-*`」的既有决策，且每次上游升级都要手工合并。

代价是依赖宿主 CSS Module 语义名，属已知的静默退化风险。

### 决策 2：侧栏品牌按钮保留盒子，去掉交互

只做 `display: none` 会留下一个仍可点击、仍能触发新建会话的不可见区域，用户点到空白处会莫名开会话。因此对包住标记的按钮再加 `pointer-events: none`：盒子仍在（行高不变），但不再回应用户。功能不丢——`logoRow` 下方本来就有独立的新会话按钮。

备选是整行收掉，那会把 60px 行高让给列表，与「保持版式不变」相冲突，也会让右侧折叠按钮上移。

### 决策 3：折叠轨道让面板图标常驻

折叠态下标记是展开按钮唯一的静态可见内容。直接隐藏会让按钮变成不可见热区，触屏端尤其无法发现。故追加规则让 `_panelIcon` 恒显示，牺牲「静止是鲸鱼、悬停变箭头」的动效，换取控件始终可见。

### 决策 4：按语义类名匹配，不按结构位置

规则写成 `[class*="_brandMark"]`、`[class*="_railMark"]`、`[data-home-whale]`。`data-home-whale` 是宿主自己写在 DOM 上的稳定标记，优先使用；两条类名规则受构建哈希前缀影响，只能用包含匹配。不采用 `:nth-child` 之类的结构选择器：宿主版式一调整就会误伤。

`_brandMark` 只出现在侧栏，不会误伤设置页里同样叫 `.brand` 的元素（那是账户设置的 onboarding 标题）。

## Risks / Trade-offs

- [宿主升级后语义类名漂移，规则静默失效] → 升级检查时人工看一眼创意视图；规格里明确要求静默退化而不是报错，避免失效升级成加载失败。
- [折叠轨道面板图标常驻后，用户看不出这是品牌位] → 该按钮本来就有 tooltip 与 aria-label（展开/折叠侧栏），可见性不受影响。
- [`pointer-events: none` 使 macOS 拖拽区变窄] → 拖拽仍由 `logoRow` 的 `data-window-drag` 承担，行本身未变。

## Migration Plan

规则随应用前端一起发布，无数据迁移。回滚即回退 `StudioFrame.tsx`：注入样式由该模块唯一产出，宿主不受影响。

## Open Questions

（无）
