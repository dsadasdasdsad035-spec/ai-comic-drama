# Proposal

## Why

`canvas-image-only-card` 已把单镜出片移出分镜卡，但画布仍把三种生产能力捆在同一层：多选浮动条「出图 / 出片 / 配音」并排，画布「操作」菜单里「批量画面 / 批量出片 / 批量配音」同区展示。用户希望画布只承担**静帧生产**批量能力，视频与台词配音的单镜路径留在 Inspector，且**不再在画布上批量出片或批量配音**，避免「生成图片和生成视频/声音放在一起」的心智。

## What Changes

- 多选浮动条（`selbar`）：**保留**「出图」与「删除」；**移除**「出片」「配音」及对应批量执行路径。
- 画布「操作」菜单（`BoardMenu`）：**保留**「批量生成画面」及视图/清理/转场类项；**移除**「批量出片」「批量配音」菜单项与触发器上的配音/出片进度文案（仅保留画面批量进度或与实现一致的最小展示）。
- **不变**：分镜卡卡头「生成」出图；卡面静帧/视频预览切换（不做「卡面只静帧」）；Inspector「视频」Tab 单镜出片；Inspector「声音」Tab 单镜「生成配音」；Seedance 原生音频仍在视频 Tab。
- **不做**：镜头表或时间线新增批量出片/配音；删除 TTS API 或连播音轨逻辑；`runOnSelected` / `generateVideoOne` / `generateVoiceOne` 实现可保留供 Inspector 调用。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `storyboard-shot-card`：收紧画布批量生成边界——浮动条与画布操作菜单 **MUST** 仅提供画面（出图）类批量入口，**MUST NOT** 再提供批量出片或批量台词配音入口（与 `canvas-image-only-card` 中「批量出片 MAY 保留」对齐修正）。

## Impact

- 前端：`src/App.tsx`（`selbar`、`runOnSelected` 暴露面）、`src/BoardMenu.tsx`（菜单项与 props）、`src/App.tsx` 传参可收窄 `onGenVideoAll` / `onVoiceAll`（若画布外无引用）。
- 文档：`README.md` 画布与批量操作描述；与 `canvas-image-only-card` README 中「多选条批量出片保留」冲突处一并改掉。
- 验收：检索 `runOnSelected('video'|'voice')`、BoardMenu「批量出片/配音」的 Playwright 脚本并更新；`openspec validate` 与归档时合并主 spec `storyboard-shot-card`。
- 依赖：建议在 `canvas-image-only-card` 实现/归档后再 apply 本变更，避免同一文件并行改冲突。

## 范围对照（用户 1+2，非 3）

| 项 | 画布 | Inspector |
|----|------|-----------|
| 出图 | 卡头 + 多选 + 批量画面 | 画面 Tab |
| 出片 | **无**（无单镜卡脚、无多选、无批量菜单） | 视频 Tab |
| 台词配音 | **无**（无多选、无批量菜单） | 声音 Tab「生成配音」 |
| 卡上视频预览 | **保留** | — |
