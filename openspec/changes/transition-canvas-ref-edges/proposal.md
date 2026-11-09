# Proposal

## Why

转场「生成」出片参考应与分镜一致：**在画布上选角色/素材并连线** 即生效。当前产品已部分实现（`generated.refIds` + 派生边），但主 spec 仍以「面板增补候选」为主叙述，缺少转场专属画布参考的一等公民要求；需固化持久化、交互与「不污染镜头 refIds」的边界，并补齐测试与验收。

## What Changes

- **转场专属参考边**：在 `relation=transition` 且 `mode=generated` 时，允许用户将画布角色/素材连到该转场的上/下镜端点（需先选中转场边），写入 `transitionOut.generated.refIds`，并绘制派生边（标签「转场参考」），与分镜 `ref-{source}-{shot}` 并列、可点选删除。
- **右键菜单**：选中转场边时，在角色/素材右键菜单中提供与分镜同构的参考勾选（切换 `refIds` token）。
- **隔离**：转场画布参考 MUST NOT 写入目标镜头的 `shot.refIds`；单镜 `buildShotVideoRequest` 不受转场专属 token 影响。
- **拼装**：`mergedTransitionShotReferences` 继续将 `generated.refIds` 作为 supplemental 合并；预览与请求一致。
- **体验**：未选转场边时拖线到镜头仍走分镜参考；未设为「生成」时连转场参考须提示并拒绝写入。
- （文档/测试）更新 `verify-transitions.mjs` 或 UI 契约测试，记录在 `ACCEPTANCE.md`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`：增补「画布转场参考连线」需求；更新「风格参考可继承、排除与增补」中增补场景，明确画布与面板等价。

## Impact

- **前端**：`App.tsx`（`onConnect`、`refEdges`、`ctxData`、`toggleTransitionRef`）、`TransitionPanel.tsx` 提示文案。
- **持久化**：已有 `transition_out.generated.refIds`（`shotSync`），无 schema 迁移。
- **Spec**：`openspec/specs/shot-transition-video-prompt/spec.md`。
