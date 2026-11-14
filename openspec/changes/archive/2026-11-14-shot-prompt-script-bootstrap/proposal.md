# Proposal

## Why

出片面板上的「模板渲染与当前输入不一致」提示反映的是 **持久化九段 LLM 层**（`video_prompt_rendered`）与指纹机制，与产品意图不符：模板只应在 **运动/画面提示词为空** 时，用参考与镜表字段 **确定性拼装** 首版正文，而不是作为第二真相源长期占位、改连线便要「重新模板渲染」。此外画布 Inspector 缺少可点的「模板渲染」入口，文案与实现脱节。应将默认出片正文收束为 **手改 → 表字段 → 脚本拼装**，消除误导性 stale 提示。

## What Changes

- **BREAKING（行为语义）**：`buildShotVideoRequest` 不再因「新鲜」的 `video_prompt_rendered` 覆盖语义层；出片预览与请求的正文优先级为 `video_prompt_override` → `video_prompt` / `prompt` → **脚本拼装**（仅当两者皆空）。
- 新增 **`assembleShotPromptScript`**（及转场等价物）：复用 `buildShotPromptRenderBundle` 的结构化输入，输出固定段落的中文正文；同步、可单测、不调用文本模型。
- 移除或降级 UI **`renderStale` / `templateStale`** 及「点模板渲染更新」类文案；徽章区分「已手改 / 语义层 / 脚本拼装」，不再默认展示「模板渲染」为主路径。
- 存量 `video_prompt_rendered`：加载后 **不参与** 自动出片（可选只读或一次性「采纳到运动提示词」）；不触发 stale 警告。
- **Out of scope（首期）**：删除 `seedance-prompt-render` 技能与 Pi 改稿；删除字段 `video_prompt_rendered` 的存储（可留字段只读）；转场脚本拼装可与单镜分期。

## Capabilities

### New Capabilities

- `shot-prompt-script-assembly`：单镜在提示词为空时的确定性脚本拼装规则、段落结构、与 `buildShotVideoRequest` 的衔接及 `textSource` 标识。

### Modified Capabilities

- `shot-video-prompt`：正文来源优先级、预览=请求、手改快照语义；废弃以 `video_prompt_rendered` 为主路径的要求（若归档变更中仍有 ADDED，在本变更中 REMOVED/MODIFIED）。
- `shot-inspector-layout`：出片提示词面板警告与徽章文案，与无 LLM 模板层一致。
- `shot-transition-video-prompt`（可选同期）：转场空正文时的脚本拼装，与单镜同哲学（若首期仅单镜，在 design 中注明转场 follow-up）。

## Impact

- **前端**：`src/videoPrompt.ts`、`src/promptRender.ts`（抽出 script assembler）、`src/transitionGen.ts`（若含转场）、`OutgoingVideoPromptPanel.tsx`、`Inspector.tsx`；弱化 `effectiveVideoPrompt` 中 `renderStale`。
- **持久化**：`shotSync` / `types` 字段可保留兼容，读写行为变更。
- **测试**：`verify-prompt-render.mjs` 转向脚本输出断言；更新 `verify-shot-inspector` 对面板徽章/无 stale 文案的期望；README 出片提示词一节与九段 LLM 主路径描述对齐。
- **OpenSpec / README**：与 `seedance-llm-prompt-render`、`video-prompt-pi-refine-settings` 已归档能力叙述冲突处，以本变更为准（LLM 渲染降为可选后续，非默认）。
