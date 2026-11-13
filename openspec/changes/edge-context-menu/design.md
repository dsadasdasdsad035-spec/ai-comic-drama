# Design

## Context

一条分镜连线原本是「线 + 中点胶囊」两层：

```text
                        [chip]  <- EdgeLabelRenderer 浮层（关系名 or 接缝摘要）
   镜01 ●━━━━━━━━━━━━━━━━━━━● 镜02
            ^
            |  BaseEdge：颜色 + 虚实表达关系
            |
   单击线身 -> 无响应
   单击胶囊 -> cycleEdge: cut -> transition -> flashback -> branch
   右击线身/胶囊 -> EdgeContextMenu
```

胶囊有两个问题：内容在「关系名」与「接缝摘要」之间切换，读者无法预期它是什么；视觉上它压在线的中点上，把一条连续的线切成两段。触发方式上，右击是全画布唯一的右击手势，与「单击出详情」的其它交互不一致。

`selEdgeId` 仍由菜单的「转场设置」写入，被 3 处消费（`TransitionPanel` 渲染、`ctxData` 的 `transition-pick`、`onConnect` 拖线追加转场参考），本次不动。

## Goals / Non-Goals

- Goals：连线只呈现线条；改关系=单击连线后一次点选；画布上手势统一为单击。
- Non-Goals：不改 `relation` 语义与持久化；不改接缝数据模型与成片合成；不给触屏补长按。

## Decisions

### 1. 单击入口复用 React Flow 的 `onEdgeClick`

分镜边保持 `selectable: false`。已确认 `@xyflow/react@12.12.0` 的 `EdgeWrapper` 在 `isSelectable` 为假时**仍会调用** `onClick` 回调，只跳过内部的选中逻辑——所以 `elementsSelectable` 与边选中态都不需要动，`onEdgeClick` 就是干净的单击入口。

`onEdgeClick` 的好处是命中区域是 React Flow 自带的 20px 宽不可见交互条（`interactionWidth`），比原来那个小胶囊大得多，细线也能点中。替代方案是在 `BaseEdge` 的 `<path>` 上挂 `onClick`，否决：只能命中 1.6px 的可见描边，点击成功率差。

### 2. 右击只拦原生菜单

`onEdgeContextMenu` 保留，但对非派生边只做 `preventDefault()`，不打开任何自定义菜单。否则右击连线会掉出浏览器原生菜单，比什么都不发生更突兀。

### 3. 移除 `EdgeChip`，连带删掉缩放订阅

`EdgeChip` 之所以单独拆组件，是因为它要 `useStore(st => st.transform[2])` 反向补偿缩放，订阅放在 `ShotEdge` 里会让几十条边每帧重渲染。标签删掉后这层订阅整块消失，`ShotEdge` 变成纯静态渲染，只在 `data` 变化时重渲染。

### 4. 状态信息迁移到线条

原胶囊承担三种状态表达，迁移方案：

| 状态 | 原表现（胶囊） | 新表现（线条） |
|---|---|---|
| `inactive` 未参与成片 | 半透明 + 删除线 | `opacity: .45`，关系虚线保留 |
| `stale` 需重生成 | 警示底色 + 圆点 | 描边改警示色 `--warn` |
| `pending` 未出片 | 虚线边框 | 关系本身已是虚线（转场 `7 5`），不再额外标记 |

`pending` 不再单独区分：转场线的虚线已经表达了「还没定稿」，再叠一层会回到「线上一堆标记」的老问题。状态文字统一在菜单头部（`叠化 0.5s · 未参与成片`）。

### 5. 边挂 `className` 作为样式与断言钩子

`shownEdges` 给每条分镜边加 `className: `edge-rel-${relation} edge-state-${state}``。两个用途：CSS 按状态着色（避免把配色写进组件）、回归脚本按类名断言关系与状态。原来的脚本全靠读胶囊文本，胶囊删掉后必须有个不依赖视觉文案的稳定钩子。

### 6. 菜单互斥与关闭语义不变

沿用 `edgeCtx` 单一菜单状态：打开边菜单前关 `ctx`，打开节点菜单前关 `edgeCtx`，`onPaneClick` / `onPaneContextMenu` 两者都关。区别只在打开来源由 `onEdgeContextMenu` 换成 `onEdgeClick`。

打开菜单时清 `selId`、不清 `selEdgeId`：转场面板打开着的时候用户点另一条线，面板不应该被菜单顺带关掉，因为「转场设置」随时可能再把面板切走。

### 7. 删除路径统一

保持 `needsEdgeDeleteConfirm(edge)` 与 `applyEdgeRemoval(edge)`（`onEdgesDeleted` 复用后者），让 `onBeforeDelete` 与菜单「删除连线」共用同一份判定与副作用。

## 迭代记录

本变更最初（2026-11-11）落地的是「chip 退化为只读标签 + 右击弹菜单」。实测后推翻：

- 只读 chip 仍然挡在线中点上，`叠化 0.5s` 这类摘要依然影响观感，用户要的是线上什么都没有。
- 右击在当时是画布上唯一需要记的隐式手势，和其余单击交互不一致。

因此 2026-11-13 调整为「删除 chip + 单击触发」。已完成的 `EdgeContextMenu` 组件、单选样式、关闭语义、删除确认、`data.active` 高亮全部保留；被替换的是入口（右击→单击）与中点渲染（有标签→无标签）。原「右击」相关断言与文案在本轮一并改掉。

## Risks / Trade-offs

- [单击线身可能误触] → 只打开菜单，不写任何数据；菜单点空白或 `Esc` 即关。误触成本是一次多余的弹窗，而非改掉连线关系。
- [右击失效的肌肉记忆] → 右击不弹菜单，但也不弹原生菜单，用户下一次自然会试单击（线身有 `cursor: pointer` 与悬停提亮）。
- [状态不再一眼可见] → `stale` / `inactive` 只能从线条样式与时间线的警告条看出，菜单头部的文字需要点开才见。取舍理由见决策 4。
- [回归脚本大面积依赖 `.edge-chip`] → 用 `edge-rel-*` / `edge-state-*` 类名替代，并新增「画布上不存在 `.edge-chip`」的反向断言，防止以后又被加回来。
- [边菜单打开时无法拖线] → 菜单带全屏遮罩。拖线追加转场参考的路径要求先关菜单（`Esc` 或点空白），这是原本右击方案就有的约束，未变化。

## Migration Plan

纯前端一次性替换，无数据迁移：存档里的 `relation` 与 `transition_out` 结构不变。回滚即回退该提交。

## Open Questions

（无）
