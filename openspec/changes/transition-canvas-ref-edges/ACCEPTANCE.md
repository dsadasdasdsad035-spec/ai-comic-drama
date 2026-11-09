# Acceptance：转场画布参考边

## 数据边界

- [ ] `toggleTransitionRef` / `removeTransitionRef` 只改 `transitionOut.generated.refIds`，目标镜头 `shot.refIds` 不变
- [ ] `shotSync.bizSignature` / 写回 `project.json` 含 `transition_out.generated.refIds`（改 ref 会触发脏检测）

## 画布交互

- [ ] **拖线**：先点选 `relation=transition` 的接缝边，再从角色/素材拖到该转场的上镜或下镜节点 → toast + 出现虚线「转场参考」边
- [ ] **未选转场边**：素材连到分镜 → 只写该镜 `refIds`
- [ ] **效果模式**：拖线连参考 → toast「请先将转场设为「生成」…」，不写 refIds
- [ ] **右键**：选中转场边 + 右键角色/素材 → `transition-pick` 菜单勾选与 `generated.refIds` 同步
- [ ] **删除**：选中「转场参考」边后 Delete/Backspace，或 React Flow 删边 → token 从 `generated.refIds` 移除

## 面板

- [ ] 高级区文案说明画布流程（先点接缝、拖线/右键）
- [ ] 「补充参考」列表已出现在 `g.refIds` 的项不再重复（`dedicatedRefTokens`）

## 自动化

```bash
node verify-transitions.mjs
```

覆盖：`ref-tr` 边 id 解析、`generated.refIds` supplemental 进 `buildTransitionVideoPreview`、`bizSignature` 对 refIds 敏感。
