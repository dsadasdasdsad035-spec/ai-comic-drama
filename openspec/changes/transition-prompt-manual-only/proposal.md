# Proposal: transition-prompt-manual-only

## Why

生成转场的出片正文会被运行时自动追加两段系统生成的文字：由两镜字段推导的「衔接约束」，以及首尾帧的「结构锚点」。结果是用户（或 Agent）写进去的正文永远不等于最终发出去的正文，出问题时要先分辨哪一段是系统加的。

转场正文应当完全由人/Agent 决定：用户写什么、Agent 写什么，就发什么。系统只负责校验「有没有写」，不负责补写。

## What Changes

- 生成转场的最终正文 **MUST** 逐字等于 `generated.prompt`（或手改正文 `videoPromptOverride.text`），运行时不再追加任何句子。
- 删除 `buildTransitionStructurePromptHint`（结构锚点段）与 `finalizeTransitionPromptText`（正文收尾拼装）两个函数及其调用点。
- `transitionContinuityBlock` 保留，但只作为面板上的**只读参考**展示（标注「不参与发送」），不再参与正文拼装。
- `keyframePrompt` 去掉 `defaultTransitionPrompt` 兜底与硬编码尾句「单幅过渡画面，不要分屏或左右拼接…」；正文为空时返回空串。
- 保留「用上下镜正文预填」按钮与 `defaultTransitionPrompt`：仅在用户主动点击时把两镜正文拼成一段可编辑文本写入 textarea，不参与出片拼装。
- 空正文的阻断（`transition-prompt-empty`）保持不变。
- **BREAKING**：已保存的生成转场，其正文会明显变短（少了衔接段与锚点段）。已出片的转场 `videoMeta.prompt` 是旧格式，与当前预览不一致，需重新出片才对齐。

## Capabilities

### New Capabilities

无。本变更不引入新的系统行为，只收窄已有行为的来源。

### Modified Capabilities

- `shot-transition-continuity`：删除「自动正文追加衔接约束」Requirement（衔接段不再进正文，降级为只读参考）。「手改正文优先」「效果转场不受影响」保留。
- `shot-transition-video-prompt`：修改「提示词分层与手改全文」Requirement —— 正文只由字段原文或手改决定，`Scenario: 自动拼装含衔接` 改为断言正文与字段原文逐字一致。

## Impact

- 代码：`src/transitionGen.ts`（删两个函数、改 `keyframePrompt`）、`src/TransitionPanel.tsx`（只读区文案）。
- 测试：`tests/prompt-text-integrity.ts` 中「自动路径正文并入衔接块」等断言需改为反向断言；`verify-transitions-ui.mjs` 增加「正文不含衔接段」检查项。
- 数据：无 schema 变化。已存 `generated.prompt` 不动；`videoMeta.prompt` 可能为旧格式。
- 不受影响：`promptRender.ts` 的转场 bundle（`creative.desc`、`transition.recipeHints`、`continuity.identityLocks`）是喂给九段渲染模型的输入材料，不是最终发送正文，本次不改。
