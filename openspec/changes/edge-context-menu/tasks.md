# Tasks

## 1. 边菜单组件

- [x] 1.1 新建 `src/EdgeContextMenu.tsx`：复用 `.ctx-menu` / `.ctx-scrim` 结构与「贴边翻面」定位逻辑，行结构为 `● / ○ + 文案 + 右值`，props 含 `x/y`、`headTitle/headSub`、`options[{id,label,note}]`、`value`、`onPick`、`extraActions`、`onClose`；验证：`npx tsc --noEmit` 通过。
- [x] 1.2 在 `src/theme.css` 补无缩略图的单选行样式（选中打点、悬停高亮、`note` 右对齐弱化）；验证：dev 起画布目视对齐，选中行与未选中行区分明显。
- [x] 1.3 实现键盘与关闭语义：`Esc` 关闭、点遮罩关闭、点菜单项不关闭；验证：`verify-edge-menu.mjs` 断言「点关系后菜单不关闭」「Esc 关闭菜单」「菜单不出视口」。

## 2. 连线只读化与右键入口

- [x] 2.1 `src/ShotEdge.tsx`：`EdgeChip` 由 `<button>` 改为 `<span>`，移除 `cycleEdge` 调用与 `⋯` 按钮，保留摘要与状态点，`title` 改为「右击连线设置」；验证：`verify-edge-menu.mjs` 断言单击标签后关系仍是硬切。
- [x] 2.2 `BaseEdge` 与 `edge-chip-wrap` 同时挂 `onContextMenu`（`preventDefault` + `stopPropagation`），`ReactFlow` 另挂 `onEdgeContextMenu` 覆盖 React Flow 的 20px 宽交互条；验证：`verify-edge-menu.mjs` 分别断言「右击线身弹出菜单」「右击标签弹出菜单」。
- [x] 2.3 `src/ctx.ts` 新增 `openEdgeMenu(e, id)`、移除 `cycleEdge`，并删除 `src/App.tsx` 里的 `cycleEdge` 实现；验证：`npx tsc --noEmit` 通过，全仓无 `cycleEdge` 残留引用。
- [x] 2.4 `ShotEdge` 的高亮改由 `data.active` 派生，替代 `EdgeProps.selected`；验证：`verify-edge-menu.mjs` 断言面板打开时边宽 2.6px、关闭后回到 1.6px。
- [x] 2.5 更新 `README.md`「分镜转场（接缝）」首段：改为「右击连线弹出菜单，单选硬切/转场/闪回/分支；菜单里的「转场设置」打开面板」；验证：按文档描述手动走一遍，步骤与实现一致。
- [x] 2.6 迁移 `verify-transitions-ui.mjs` 里依赖 chip 点击的断言（原第 124/130/209 行附近）到右击 + 点菜单项，并新增「单击 chip 关系不变」断言；顺带把脚本里与现行实现脱节的断言对齐（全部预设折叠、出片设置/首尾帧抽取、剪片夹具改为按 3 秒现取、morph 首尾帧分流）；验证：`node verify-transitions-ui.mjs` 全绿（35 项）。

## 3. 应用接线：面板入口、删除与选中态

- [x] 3.1 `src/App.tsx` 的 `onEdgeClick` 删除分镜边分支，只保留 `ref-` / `ref-tr|` 的 `setSelRef`；验证：`verify-edge-menu.mjs` 断言单击分镜线不开面板。
- [x] 3.2 新增 `edgeCtx` 状态与 `onEdgeContextMenu`：只接非派生边（`ref-` / `ref-tr|` / `cast-`），打开前关闭节点菜单 `ctx`；`onNodeContextMenu` 反向关闭 `edgeCtx`，`onPaneClick` / `onPaneContextMenu` 两者都关；验证：`verify-edge-menu.mjs` 全程同一时刻只有一个菜单。
- [x] 3.3 菜单「转场设置…」：关系不是转场时先 `setEdgeRelation(id,'transition')` 再 `openTransition(id)`，否则直接 `openTransition`；验证：`verify-edge-menu.mjs` 断言硬切线进入面板后 chip 为「叠化 0.5s」。
- [x] 3.4 分镜边加 `selectable: false`，并确认节点删除、多选与 Delete 键行为不受影响；验证：`verify-edge-menu.mjs` 断言「键盘 Delete 不删边」与「节点仍可用 Delete 删除」。
- [x] 3.5 抽出 `needsEdgeDeleteConfirm(edge)` 与 `applyEdgeRemoval(edge)`（并让 `onEdgesDeleted` 复用后者），让 `onBeforeDelete` 与菜单「删除连线」共用同一份判定；验证：`verify-edge-menu.mjs` 断言删除后连线消失、`transition_out` 不再写回。
- [x] 3.6 新增 `verify-edge-menu.mjs`（替代无法运行的 `verify-ctxmenu.mjs`，后者依赖已不存在的老 UI 与 `recycle` 种子项目）：覆盖右击线身/标签弹菜单、四个关系单选可切换、转场设置入口、高亮、贴边翻面、删除硬切线不改镜头数据、旧项目水合显示当前关系；验证：`node verify-edge-menu.mjs` 全绿。

## 4. 集成验证

- [x] 4.1 跑 `node verify-edge-menu.mjs`、`node verify-transitions-ui.mjs`、`node verify-joins.mjs`：三者全绿。`verify-ctxmenu.mjs` 走的是已下线的 `+ 素材` 旧界面且依赖 `recycle` 种子项目，改动前即跑不通，其边菜单职责由 `verify-edge-menu.mjs` 承担（见 3.6）。
- [ ] 4.2 手动回归跨组路径：先开转场面板、再从角色/素材拖线追加转场参考、再右键卡片走 `transition-pick`；验证：参考数量与面板一致，无重复写入。
- [x] 4.3 载入一个已有转场的旧项目，确认连线显示为只读标签、右击菜单显示当前关系为「转场」；验证：`verify-edge-menu.mjs` 的「旧项目」段落断言 chip 为「叠化 0.5s」、菜单打点在转场、头部标明「已参与成片」、`transition_out` 未被改写。
