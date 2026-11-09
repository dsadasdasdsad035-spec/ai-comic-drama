# Proposal

## Why

转场「本次转场出片」在参考与预览上已对齐分镜，但交互仍割裂：主按钮嵌在中段、手改正文直接在 textarea 切换、缺少分镜式的「旧快照」badge。用户要在分镜 Inspector 与转场面板之间切换两套肌肉记忆，增加误操作与不信任感。

## What Changes

- 转场面板增加与 Inspector 视频 Tab 同构的 **底栏主操作区**：生成/取消、估价、blocking 时禁用文案与分镜一致。
- 最终发送正文改为分镜式 **编辑 → 保存手改 → 取消** 流程；只读态用 `pre` 展示，非编辑态不直接改 override 字段。
- 手改保存时记录 **拼装指纹**；参考/边界/分层字段变化后 badge 显示 **旧快照**，提供「重新拼装」清除手改（对齐 `shot-video-prompt`）。
- 出片子树 **字段顺序** 与分镜一致：summary → 锚点/参考 → issues → 分层输入 → 最终正文 →（底栏生成）。
- blocking 文案可增加 **跳转相邻镜** 的辅助操作（打开上/下镜 Inspector），不强制改画布路由架构。
- （非目标）不抽取跨分镜/转场的共享 React 组件大包；不改动效果转场 / 智能建议逻辑。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `shot-transition-video-prompt`：补充转场面板与分镜出片面板在底栏 CTA、手改编辑流、手改快照过期上的行为一致要求。

## Impact

- `TransitionPanel.tsx`、`theme.css`（`tr-panel` footer / `si-foot` 对齐）
- 可选：`TransitionGenerated.videoPromptOverride` 从 `string` 升级为与分镜同构的快照类型，或并行字段 + 迁移 normalize
- `transitionGen.ts` / `effectiveTransitionVideoPrompt`：指纹用于 override stale
- 测试：扩展 `verify-transitions.mjs` 或轻量 UI 回归说明
