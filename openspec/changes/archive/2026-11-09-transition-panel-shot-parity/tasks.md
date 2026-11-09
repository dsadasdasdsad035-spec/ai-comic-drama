# Tasks

## 1. 数据与指纹

- [x] 1.1 `TransitionGenerated.videoPromptOverride` 支持 `VideoPromptOverride`；`normalizeGenerated` / 持久化兼容旧 string；`effectiveTransitionVideoPrompt` 读 `text` 字段
- [x] 1.2 实现 `transitionVideoPromptFingerprint`；单元断言：改 boundary 变指纹、改 override 不变；`verify-transitions.mjs` 覆盖

## 2. 手改 UI（对齐 VideoPromptPanel）

- [x] 2.1 最终正文：只读 `pre` + 编辑/保存/取消；保存写入 override 含 fingerprint；badge 支持 `auto` / `manual` / `warn`（旧快照）
- [x] 2.2 「恢复自动拼装」「重新拼装」「用当前字段重填」行为与分镜一致；手改时衔接折叠仍隐藏或标注不适用

## 3. 布局与底栏

- [x] 3.1 重排出片子树字段顺序；`aside` 增加 `si-foot`：生成/取消、估价、blocking footnote；移除 field 内原 primary 按钮行
- [x] 3.2 `theme.css`：转场面板 body 可滚动 + foot 粘底；与 Inspector 视觉一致

## 4. blocking 引导与验收

- [x] 4.1 `onFocusShot` 从 App 接入；缺边界 blocking 旁「打开上镜/下镜」按钮
- [x] 4.2 按 spec 场景人工验收；`openspec validate transition-panel-shot-parity` 通过

## Workflow follow-up

- 完成后 `/opsx-archive` 合并 delta 到 `shot-transition-video-prompt`。
