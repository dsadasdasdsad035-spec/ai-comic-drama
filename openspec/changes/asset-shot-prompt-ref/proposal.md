# Proposal

## Why

画布连线 today 只有 **角色/素材 → 分镜** 或 **→ 图片卡 refIds**；音频/字幕生成无法声明「文案来自哪条分镜」。用户需要 **分镜 → 音频卡 / 字幕卡** 的引用边，并在生成时合并所选字段，且不与图片参考 `refIds` 混用。

## What Changes

- 字幕卡与音频卡 MUST 可连线（或等效引用）一个或多个分镜，持久化 `sourceShotIds`（画布节点 id 或 `shotId`）。
- **音频卡**：生成 TTS 时 merge 顺序 — 用户 `prompt` +（可选）连线分镜的 `dialogue` / `video_prompt`；仍 **不** 读 `refIds` 媒体。产物仍为音频 url。
- **字幕卡**（见 `canvas-subtitle-card`）：生成/填充 cue 时从 `sourceShotIds` 读取字段；不写回镜头。
- 画布派生展示引用边；删除分镜或删卡时清理无效 id。
- **不包含**：分镜 → 图片卡 refIds 语义变更；shot-prev 自动引用。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `asset-card-generation`：音频卡可选用分镜文案；字幕卡依赖本分镜引用契约。
- `canvas-subtitle-card`：依赖本分镜引用（若主规格尚未归档，delta 重复声明连线场景）。

## Impact

- `App.tsx` `onConnect` / `refEdges` / `applyEdgeRemoval`。
- `assets.extra.sourceShotIds`、`promptSource`。
- `verify-asset-shot-prompt-ref.mjs`。