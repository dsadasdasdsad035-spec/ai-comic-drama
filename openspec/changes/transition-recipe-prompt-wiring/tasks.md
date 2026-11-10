# Tasks

## 1. 类型与契约

- [x] 1.1 `src/types.ts` 的 `TransitionGenerated` 增加 `variantId?: string`；`src/transition.ts` 的 `normalizeGenerated` 透传；验证：`npx tsc --noEmit` 无新增错误
- [x] 1.2 `src/skills/contracts.ts` 的 `joinItemV1.generated` 增加 `variant_id`；`src/shotJoins.ts` 写入 `g.variantId`；验证：`node verify-joins.mjs` 通过且新增断言能读到 variantId

## 2. 食谱层拼装

- [x] 2.1 新增 `transitionRecipePromptBlock(recipeIds, variantId)`：按 id 取卡、去重、变体优先、hints 优先于 principle、返回 `{ text, warnings }`；验证：`node verify-transitions.mjs` 断言命中卡与未知 id 两种情况
- [x] 2.2 `autoTransitionVideoPrompt` 在基础句与衔接块之间插入食谱层；验证：无 recipeIds 时输出与改动前逐字一致（快照断言）
- [x] 2.3 用户正文已含某条 hint 原文时跳过该条；验证：构造 prompt 含 hint 的用例，断言只出现一次
- [x] 2.4 技法卡未指定 variantId 时用卡级 hints 并给 warning；指定时只用该 variant 的 principle；验证：两种用例各自的正文与 warnings

## 3. 负向约束

- [x] 3.1 `pitfalls` 合并去重生成「避免：…」段，追加在正文末尾（附件注记之前）；验证：断言命中卡的 pitfall 出现在正文
- [x] 3.2 手改正文不含食谱层与负向约束；验证：override 用例逐字比对

## 4. 附件注记修复

- [x] 4.1 `finalizeTransitionPromptText` 增加 `submitRefs` 入参；为 false 时跳过参考图与参考视频注记；验证：首尾帧齐全 + 有素材参考时正文不含「参考图：」
- [x] 4.2 注记条数与 `refImages` 数量一致；验证：断言注记条数 === refImages.length

## 5. 验收

- [x] 5.1 扩展 `verify-transitions.mjs`：食谱层、去重、变体降级、未知 id、互斥注记、注记与提交数一致；验证：`node verify-transitions.mjs` 退出码 0
- [x] 5.2 `README.md` 转场章节补一句「食谱卡参与自动正文拼装」；验证：README 含该说明
- [x] 5.3 `openspec validate transition-recipe-prompt-wiring --strict` 通过；验证：命令退出码 0

## Workflow follow-up

- 完成后归档 `transition-recipe-prompt-wiring`。
- 选卡 UI（让用户/Agent 在面板里指定 variantId）另开变更。
