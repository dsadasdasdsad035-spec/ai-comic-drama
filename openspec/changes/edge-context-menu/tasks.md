# Tasks

## 1. 边菜单组件（沿用上一轮成果）

- [x] 1.1 `src/EdgeContextMenu.tsx`：复用 `.ctx-menu` / `.ctx-scrim` 结构与「贴边翻面」定位逻辑，行结构为 `● / ○ + 文案 + 右值`，props 含 `x/y`、`headTitle/headSub`、`options[{id,label,note}]`、`value`、`onPick`、`extraActions`、`onClose`；验证：`npx tsc --noEmit` 通过。
- [x] 1.2 `src/theme.css` 补无缩略图的单选行样式（选中打点、悬停高亮、`note` 右对齐弱化）；验证：dev 起画布目视对齐，选中行与未选中行区分明显。
- [x] 1.3 键盘与关闭语义：`Esc` 关闭、点遮罩关闭、点菜单项不关闭；验证：`verify-edge-menu.mjs` 断言「点关系后菜单不关闭」「Esc 关闭菜单」「菜单不出视口」。

## 2. 连线只呈现线条

- [x] 2.1 `src/ShotEdge.tsx`：删除 `EdgeChip` 子组件、`EdgeLabelRenderer` 与 `useStore(transform[2])` 缩放订阅，`ShotEdge` 只渲染 `BaseEdge`；验证：`verify-edge-menu.mjs` 断言画布上 `.edge-chip` 数量为 0。
- [x] 2.2 `src/ShotEdge.tsx`：状态改由线条承担——`inactive` 降不透明度、`stale` 描边改警示色（`theme.tsx` 新增 `edgeStale`），`pending` 不再单独标记；验证：`verify-transitions-ui.mjs` 断言失效态边类名为 `edge-state-stale`、未参与态为 `edge-state-inactive`。
- [x] 2.3 `src/theme.css`：删除 `.edge-chip` / `.edge-chip-wrap` / `.edge-dot` 全部规则，补分镜边 `cursor: pointer` 与悬停提亮；验证：全仓无 `edge-chip` 样式与引用（只剩回归脚本里的反向断言）。
- [x] 2.4 `src/App.tsx` 的 `shownEdges`：给分镜边加 `className: edge-rel-<relation> edge-state-<state>`，并把已无人消费的 `data.transition.summary` 从 `data.ts` 与边数据里去掉；验证：`verify-edge-menu.mjs` 按 `.edge-rel-cut` / `.edge-state-stale` 命中。

## 3. 单击触发

- [x] 3.1 连线菜单不再经 `CanvasCtx` 暴露：`src/ctx.ts` 移除 `openEdgeMenu` / `setEdgeRelation` / `openTransition` 三个已无人消费的入口，入口统一在 `App.tsx` 的 `onEdgeClick`；验证：`npx tsc --noEmit` 通过，全仓无 `CanvasCtx` 的边菜单消费点。
- [x] 3.2 `src/App.tsx`：`onEdgeClick` 里分镜边分支改为 `openEdgeMenu(e, e.id)`（`ref-` / `ref-tr|` 仍走 `setSelRef`），打开前清 `selId`、清 `selRef`、关节点菜单，但保留 `selEdgeId`；验证：`verify-transitions-ui.mjs` 断言单击连线弹菜单、关系不变、面板不打开。
- [x] 3.3 `src/App.tsx`：`onEdgeContextMenu` 对非派生边只做 `preventDefault()`，不打开自定义菜单；验证：`verify-edge-menu.mjs` 断言右击连线后菜单数量为 0。
- [x] 3.4 `src/ShotEdge.tsx` 里 `BaseEdge` 与标签浮层的 `onContextMenu` 随 2.1 一并移除；验证：全仓无 `openEdgeMenu` 的 contextmenu 调用点。
- [x] 3.5 菜单「转场设置…」：关系不是转场时先 `setEdgeRelation(id,'transition')` 再 `openTransition(id)`，否则直接 `openTransition`；验证：`verify-edge-menu.mjs` 断言单击硬切线后进入面板，头部为「叠化 0.5s」。
- [x] 3.6 分镜边 `selectable: false`，高亮由 `data.active` 派生；验证：`verify-edge-menu.mjs` 断言边宽在 2.6px / 1.6px 间切换。
- [x] 3.7 `needsEdgeDeleteConfirm(edge)` 与 `applyEdgeRemoval(edge)` 统一删除判定，`onBeforeDelete` 与菜单共用；验证：`verify-edge-menu.mjs` 断言删除后连线消失、`transition_out` 不再写回。

## 4. 文档与回归脚本

- [x] 4.1 更新 `README.md`「分镜转场（接缝）」首段与操作路径：改为「单击连线弹出菜单，单选硬切/转场/闪回/分支；连线本身不显示任何标签」；验证：按文档描述手动走一遍，步骤与实现一致。
- [x] 4.2 `verify-edge-menu.mjs` 改为单击路径：单击线身弹菜单、右击不弹菜单、断言改为 `.edge-rel-*` / `.edge-state-*`，并新增「画布上不存在 `.edge-chip`」；顺带把 `verify-transition-folds.mjs` 与 `verify-export.mjs` 的连线入口从 chip 改为单击，并补大厅导航（两者原先直接 goto 根路径，在项目大厅上线后已跑不通）；验证：`node verify-edge-menu.mjs`、`node verify-transition-folds.mjs` 全绿。
- [x] 4.3 `verify-transitions-ui.mjs`：把读 `.edge-chip` 文本的断言迁移到单击菜单头部与边类名，并把「右击」操作改为单击；验证：`node verify-transitions-ui.mjs` 全绿（45 项）。
- [x] 4.4 跑 `node verify-edge-menu.mjs`、`node verify-transitions-ui.mjs`、`node verify-joins.mjs`：三者全绿。`verify-ctxmenu.mjs` 走的是已下线的 `+ 素材` 旧界面且依赖 `recycle` 种子项目，改动前即跑不通，其边菜单职责由 `verify-edge-menu.mjs` 承担。
- [ ] 4.5 手动回归跨组路径：先开转场面板、再从角色/素材拖线追加转场参考、再单击卡片走 `transition-pick`；验证：参考数量与面板一致，无重复写入。
