# Proposal

## Why

画布上的图片/音频素材卡已能按提示词生成，但 Inspector 里没有与出片镜一致的模型下拉；音频卡在未手选模型时容易直接失败。`asset-card-image-audio` 规格已要求用户在音频卡上选择已接入模型，实现尚未补齐。素材页的设定图生成虽有顶栏「设定图模型」，与画布手选仍不互通，用户不易发现当前实际用的是哪条模型。

## What Changes

- 在画布素材卡 Inspector（`AssetPanel`）为**图片卡**增加图像能力模型下拉，为**音频卡**增加音频能力模型下拉；行为与现有 `CapModelSelect`、出片镜模型行一致（不选手选则用设置页该能力默认）。
- 手选结果继续写入本机 `modelPick`（`image` / `audio`），与素材页设定图、批量出图、批量逻辑共用同一份选择，**不按单卡持久化 modelKey**。
- 音频生成前：未手选时 MUST 解析 `defaults.audio` 并与「未接入模型」规则一致，不得仅因未打开过下拉就报「请先选择音频模型」。
- 图片生成请求 MUST 使用解析后的 `modelKey`（手选或默认）；未接入/不可用模型 MUST 拦截并给出可读说明。
- 素材页：在规格层明确「场景/道具设定图生成」处 MUST 保留（或补齐）图像模型选择入口，并与画布手选共用 `modelPick.image`。
- 不包含：每张设定卡或每张素材卡独立存模型、场景/道具按卡不同模型、Suno/Lyria 接入、镜头旁白按角色配音模型（仍走角色板）。

## Capabilities

### New Capabilities

- `asset-card-generation`：画布图片/音频素材卡生成时的模型选择与解析规则（补齐规格中已有、UI 未落地的部分）。

### Modified Capabilities

- `scene-prop-design`：素材页场景/道具设定图生成前可选择图像模型，并与画布出图手选一致。

## Impact

- 前端：`src/Inspector.tsx`（`AssetPanel` 传参与子组件）、`src/App.tsx`（`generateOne` / `generateAssetAudio` 默认解析，可选小函数）、`src/assetCardGeneration.ts`、`src/ModelSelect.tsx`（仅复用，预计无行为变更）。
- 验证：扩展 `verify-knowledge` 同类模式下的素材卡脚本（如 `verify-asset-card-ui.mjs` 或现有 asset-card 断言），覆盖下拉存在、默认回落、未接入音频拦截。
- 数据/API：无 schema 变更；仍走 `/api/seedream` 与现有 `generateVoice` + `modelKey`。
- Agent：不改 `submit_shots`；批量出图继续用全局 `modelPick.image`。