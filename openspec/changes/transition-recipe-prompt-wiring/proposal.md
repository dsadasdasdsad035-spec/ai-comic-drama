# Proposal

## Why

上一轮把 30 张转场食谱补齐了可迁移字段（`principle` / `seedanceHints` / `pitfalls` / `energy` / `variants`），但它们在出片时**完全不参与**：全仓只有 `transitionSuggest` 读食谱，且只取 `id` 写进 `recipeIds`。转场正文仍由 `autoTransitionVideoPrompt` 的四层模板拼装，Agent 与建议引擎选的卡对最终提示词没有任何影响。

同一段代码里还有一个现存正确性问题：`finalizeTransitionPromptText` 无条件追加「参考图：[图N]=…」的注记，而实际是否提交参考图由之后的 `submitStyle` 决定。首尾帧齐全时参考图被互斥省略，提示词却宣称有参考图——说了没送。

## What Changes

- **食谱参与自动拼装**：`autoTransitionVideoPrompt` 按 `generated.recipeIds` 取卡，把 `seedanceHints` 作为独立层追加到正文，`principle` 在无 hints 时兜底。
- **技法卡变体**：`TransitionGenerated` 新增可选 `variantId`；技法卡命中变体时用该变体的 `principle`，未指定时降级为卡级 hints 并记 warning。
- **pitfalls 转负向约束**：命中的卡（含变体）的 `pitfalls` 合并为一段「避免」约束追加到正文末尾。
- **修复参考注记**：参考图 / 参考视频的注记 MUST 只在本次真的提交时出现；被互斥省略时不写进正文。
- **契约与写入路径**：`joins-v1` 的 `generated` 增加可选 `variant_id`；`applyJoinsToShots` 透传。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`: 自动正文新增「食谱层」与「负向约束层」，并要求附件注记与实际提交集合一致。

## Impact

- **前端**：`src/transitionGen.ts`（拼装层、注记条件）、`src/types.ts`（`variantId`）、`src/transition.ts`（normalize 透传）、`src/shotJoins.ts`（透传）、`src/skills/contracts.ts`（契约字段）。
- **数据**：`transition_out.generated` 新增可选字段，向后兼容。
- **测试**：`verify-transitions.mjs`（食谱层、互斥注记、变体降级）。
- **不做**：不改 `joins-v1` 既有字段语义，不加选卡 UI（卡仍由 Agent/建议写入），不改 `effectiveTransitionVideoPrompt` 的手改短路。
