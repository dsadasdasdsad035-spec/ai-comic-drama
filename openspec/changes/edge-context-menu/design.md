# Design

## Context

现状（见 proposal.md - Why）：一条分镜连线上叠了 6 个交互，全部挂在命中面积很小的边中点，且共享一个隐式的「选中」状态。

```text
                      [chip] [⋯]
   镜01 ●━━━━━━━━━━━━━━━━━━━━━━● 镜02
        - 单击线身 -> setSelEdgeId -> 右侧换 TransitionPanel
        - 单击 chip -> cycleEdge: cut -> transition -> flashback -> branch
        - 单击 ⋯   -> openTransition
        - 选中后 Delete / 右键卡片选参考 / 从卡片拖线 -> 依赖 selEdgeId
```

`selEdgeId` 被 4 处消费，是本变更的主要耦合面：

| 消费点 | 位置 | 迁移后的来源 |
|---|---|---|
| `TransitionPanel` 渲染 | `src/App.tsx` | 菜单「转场设置」 |
| `ctxData` 的 `transition-pick` 分支 | `src/App.tsx` | 不变（面板打开后 `selEdgeId` 仍有效） |
| `onConnect` 拖线追加转场参考 | `src/App.tsx` | 不变（先开面板再拖） |
| `cycleEdge` | `src/App.tsx` / `src/ShotEdge.tsx` | 删除 |

## Goals / Non-Goals

- Goals：让「改连线关系」成为一次显式动作，且单击不产生任何副作用；转场设置与删除有唯一稳定入口。
- Non-Goals：不改 `relation` 语义与持久化；不改接缝数据模型与成片合成；不为触屏做长按适配。

## Decisions

### 1. 边选中态降级为「正在编辑的转场边」

`selEdgeId` 只由菜单的「转场设置」写入，`onEdgeClick` 删除分镜边分支（保留 `ref-` / `ref-tr|` 的 `setSelRef`）。同时给分镜边加 `selectable: false`（边级属性，不用 `elementsSelectable`，否则节点也失去选中），避免 React Flow 自己维护一份选中态又被重渲染覆盖。

替代方案：保留单击选中、只加右键菜单。否决——两套入口并存会让「单击到底改不改数据」长期说不清，也保留了误触风险。

### 2. 边高亮改由数据派生

`selectable: false` 后 `EdgeProps.selected` 恒为假，`ShotEdge` 的加粗与发光改读 `data.active`（`data.active === selEdgeId`）。这样面板打开时仍能看出是哪条边在编辑，且不依赖框架内部状态。

替代方案：用 `data.editing` 但保留 `selected` 分支兜底。不必要，只有一处渲染。

### 3. 新建 `EdgeContextMenu`，只复用视觉与定位

`NodeContextMenu` 的 props 已被参考源列表（缩略图、`onFirstFrame`、追加动作）撑得很重，硬塞单选行会让两条路径都难读。新建 `src/EdgeContextMenu.tsx`，复用 `.ctx-menu` / `.ctx-scrim` 样式与「贴边翻面」的 `useEffect` 逻辑，行结构改为 `● / ○ + 文案 + 右值`。

菜单与节点菜单共用一个互斥位：`onEdgeContextMenu` 先关 `ctx`，`onNodeContextMenu` 先关 `edgeCtx`，`onPaneContextMenu` / `onPaneClick` 两个都关。

### 4. chip 只读，右键入口双挂

- `EdgeChip` 由 `<button>` 改为 `<span>`，保留摘要、状态点与 `title`（改「右击连线设置」）。
- 右键同时挂 `BaseEdge`（线身，默认 `interactionWidth = 20`）与 `edge-chip-wrap`（标签浮层 `pointer-events: all`，否则用户瞄准标签会打空）。
- 菜单里点关系不关闭菜单，只更新打点，方便连续比较；`Esc` / 点空白关闭。

### 5. 删除路径统一

抽出 `removeEdgeWithEffects(edge)`：`setEdges` 过滤 + 复用现有 `onEdgesDeleted` 的副作用（清 `transitionOut`、移 `refIds`、`removeTransitionRef`）。「已生成关键帧/视频要二次确认」的判定从 `onBeforeDelete` 抽成 `needsEdgeDeleteConfirm(edge)`，菜单与 Delete 键共用，避免两套提示文案走偏。

## Risks / Trade-offs

- [右键发现性差] → chip 的 `title` 与悬停高亮明确提示「右击连线设置」；线身与标签都可触发，降低打空概率。
- [触屏/无右键] → 桌面端可接受；长按 `contextmenu` 行为未验证，后续如要支持平板需在 chip 上补显式按钮。
- [回归脚本断言失效] → `verify-transitions-ui.mjs` 中「点 chip 循环」「点 ⋯ 开面板」改为 `dispatchEvent('contextmenu')` 后点菜单项，并新增「单击不改关系」断言。
- [`selectable: false` 让 Delete 键不再删边] → 删除统一走菜单，行为更可控；但需确认没有其他代码依赖键盘删边。
- [菜单单选反复触发 `setEdgeRelation`] → 该函数内部 `patch` 幂等，落到转场只在首次写入默认叠化，反复切换无副作用。

## Migration Plan

纯前端一次性替换，无数据迁移：存档里的 `relation` 与 `transition_out` 结构不变，旧项目的连线读出来照常显示为只读标签。回滚即回退该提交。

## Open Questions

- 是否需要给 chip 增加一个显式「⋯」入口作为触屏/新用户兜底（与「只读标签」目标有冲突，留待有触屏需求时再定）。
