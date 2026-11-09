# Tasks

## 1. 行为与持久化

- [x] 1.1 确认 `toggleTransitionRef` / `removeTransitionRef` 仅写 `generated.refIds`，`shot.refIds` 不变；`shotSync` 落库含 `refIds` 字段，手测或单测断言
- [x] 1.2 确认 `onConnect` 在 `selEdgeId`+transition+generated 时走转场分支，否则走分镜；效果模式 toast 拒绝

## 2. 画布派生边与删除

- [x] 2.1 `refEdges` 为每条 generated 转场输出 `ref-tr|*` 边，标签「转场参考」，与 `ref-*` 分镜边可区分点击
- [x] 2.2 `onEdgesDeleted` 与 Delete 键解析 `ref-tr|*` 并调用 `removeTransitionRef`

## 3. 右键与面板

- [x] 3.1 `selEdgeId` 时 char/asset 右键 `transition-pick` 菜单切换 token
- [x] 3.2 `TransitionPanel` 高级区说明画布流程；面板「补充参考」与 `generated.refIds` 去重（`dedicatedRefTokens`）

## 4. 拼装与验证

- [x] 4.1 扩展 `verify-transitions.mjs`：`refIds` supplemental 进入 `buildTransitionVideoPreview.refs`（mock nodes + generated）
- [x] 4.2 编写 `ACCEPTANCE.md`：拖线 / 右键 / 删除 / 分镜不误写 检查清单

## Workflow follow-up

- 完成后 `/opsx-archive transition-canvas-ref-edges` 合并主 spec。
- 与 `transition-video-shot-parity` 若仍 active 可一并归档。
