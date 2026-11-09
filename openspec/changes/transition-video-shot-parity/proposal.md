# Proposal

## Why

转场「生成」模式的出片面板与分镜视频 Tab 在参考图、参考视频与交互结构上仍不一致；拼装层对风格参考写死不提交，且未纳入相邻镜、表情等与分镜相同的参考来源，用户无法在接缝处获得与单镜出片同等的可预期性与预览=请求保证。近期已对齐手改与底栏，现在需要把参考规则与 UI 工作台一次性拉到与 `buildShotVideoRequest` 同一套真相。

## What Changes

- 引入 **双镜合并版** 视频出片拼装：在转场边上合并上/下镜与分镜相同的参考解析（表情、角色、相邻镜、素材、手工 URL、参考视频），边界首尾帧占结构槽位，预览类型与分镜 `ShotVideoRequest` 对齐。
- **转场面板壳**仅保留接缝 `硬切 | 效果 | 生成` 及效果/智能建议；「生成」内嵌抽取后的 **出片工作台**（模型、分辨率、参考区块、提示词面板、底栏），交互与分镜视频 Tab 同构。
- **按策略真提交** `refImages` / 参考视频：非 morph+尾帧互斥时与面板「将提交」一致；互斥时与分镜相同地列出并标 omitted 原因。
- **服务端** `/api/seedance` 转场分支：在非互斥条件下处理与分镜相同的 reference_image / reference_video，不再一律 `refSources = []`。
- **原生音频（策略 A）**：不合并两镜 `audioMode: native`；展示与分镜相同的 `NativeAudioPanel` 但固定禁用，环境/对白仅经转场「声音描述」写入提示词，不送 `audioRef`。
- 转场级 **excludeRefIds** 保留为在合并结果上排除 token；逐步弃用单独的「风格参考 / inherit」分区心智，改由统一参考列表表达。
- **BREAKING（行为）**：此前归档设计中「转场不送参考图/视频」的首期行为作废；在 API 允许时将实际提交参考附件。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`：参考来源、列表形态、提交策略、UI 分区、原生音频展示、与分镜一致的上限/省略/blocking；更新「风格参考可继承」等需求以反映双镜 `buildShotVideoRequest` 合并语义。

## Impact

- **前端**：`transitionGen.ts`、`TransitionPanel.tsx`、`App.tsx`（`generateTransitionVideo`）、抽取/共享出片工作台组件（由 `Inspector.tsx` / `VideoPromptPanel` 演化）、`transitionFingerprint`、样式。
- **服务端**：`vite.config.ts` APIMart 转场分流（`refSources`、`effVideoRefMode`）。
- **测试**：`verify-transitions.mjs`，对照分镜视频拼装用例。
- **Spec**：`openspec/specs/shot-transition-video-prompt/spec.md`（归档合并后更新）。
