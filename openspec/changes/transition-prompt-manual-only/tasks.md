# Tasks: transition-prompt-manual-only

## 1. 正文拼装收口

- [x] 1.1 在 `src/transitionGen.ts` 的 `buildTransitionVideoPreview` 中，把 `const prompt = finalizeTransitionPromptText(...)` 改为 `const prompt = effectivePrompt.text`，并删除对 `continuityPreview` 作为参数的传递。验证：`rg -n "finalizeTransitionPromptText" src/` 无结果。
- [x] 1.2 删除 `finalizeTransitionPromptText` 与 `buildTransitionStructurePromptHint` 两个函数（含 `void submitRefs/refs/video` 等占位语句）。验证：`rg -n "buildTransitionStructurePromptHint|finalizeTransitionPromptText" src/` 无结果。
- [x] 1.3 保留 `transitionContinuityBlock` 与 `preview.continuityPreview` 字段，确认它们只被面板只读区消费。验证：`rg -n "continuityPreview" src/` 仅剩预览类型、赋值与 `TransitionPanel` 渲染三处。

## 2. 关键帧提示词

- [x] 2.1 把 `keyframePrompt` 改为 `return normalizeGenerated(generated).prompt.trim()`，去掉 `defaultTransitionPrompt` 兜底与「单幅过渡画面，不要分屏或左右拼接…」尾句，并加中文注释说明当前无调用方。验证：`rg -n "单幅过渡画面" src/` 无结果。
- [x] 2.2 确认 `defaultTransitionPrompt` 仅剩 `prefillPrompt` 一个调用方，并同步其 docstring（改为说明只服务预填按钮）。验证：`rg -n "defaultTransitionPrompt" src/` 只剩定义与 `TransitionPanel` 引用。

## 3. 面板文案

- [x] 3.1 把 `src/TransitionPanel.tsx` 只读折叠区标题由「自动衔接约束（只读，已写入自动正文）」改为「自动衔接约束（只读，不参与发送）」。验证：`rg -n "不参与发送" src/TransitionPanel.tsx` 命中，且 `rg -n "已写入自动正文" src/` 无结果。
- [x] 3.2 确认 textarea placeholder 与「用上下镜正文预填」按钮行为未变，手改态下只读折叠区仍不渲染。验证：打开一条生成转场，手改前后分别检查折叠区是否出现。

## 4. 测试改造

- [x] 4.1 改写 `tests/prompt-text-integrity.ts` 中「自动路径正文并入衔接块，手改正文逐字发送」：断言 `preview.prompt === generated.prompt`，且 `preview.prompt` 不含 `衔接：` 与 `结构锚点`，并断言 `continuityPreview` 仍作为只读参考提供；手改分支断言保持不变。验证：`npx tsx tests/prompt-text-integrity.ts` 全绿。
- [x] 4.2 保留「衔接块引用两镜完整正文，不含省略号」这条，它验证的是 `transitionContinuityBlock` 自身，与本次改造正交。验证：同一命令下该检查仍通过。
- [x] 4.3 在 `verify-transitions-ui.mjs` 的预填步骤后新增断言：预填正文不得包含 `衔接：` 或 `结构锚点`；存在 `tr-continuity-toggle` 时其文案必须含「不参与发送」。验证：`node verify-transitions-ui.mjs` 全部通过。

## 5. 回归验证

- [x] 5.1 跑类型检查确认无未使用导入残留与签名断裂。验证：`npx tsc --noEmit` 无错误。
- [x] 5.2 跑转场 UI 端到端脚本，覆盖空正文阻断、预填、抽帧、生成请求与导出。验证：`node verify-transitions-ui.mjs` 输出「全部通过」。
- [x] 5.3 确认空正文仍被 `transition-prompt-empty` 阻断，未被本次改动放宽。验证：脚本中「空正文：出片按钮被阻断」「正文为空时出片预览给出 blocking 而非静默拼装」均通过。

## Workflow follow-up

- 同步 `shot-transition-agent` 技能文档：明确「正文必须由 Agent 自己组织两镜的景别、运镜与动作衔接，系统不再自动追加衔接段」。
- 归档本 change：`openspec archive transition-prompt-manual-only --yes`。
- 可选独立清理：`keyframePrompt` 已无调用方，可在后续独立提交中删除导出。

## 已知规格妥协

- `shot-transition-video-prompt` 的 MODIFIED 块保留了历史 scenario 名「自动拼装含衔接」，但断言已反转为「正文不含衔接段」。改名不在 delta 操作能力内，归档后该名字会留在主 spec 中，需在后续变更中通过 `RENAMED` 或重写处理。
