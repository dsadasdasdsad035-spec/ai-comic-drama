# Proposal

## Why

字幕素材卡当前以 **cue 列表** 为中间态（规则填充、手编、LLM 出 JSON 再落表），步骤多，与用户「连线分镜 → 大模型 → 直接拿 SRT 文件」的主诉求不一致。导出才是交付物，应把交互收敛到 **一次文本生成 → 下载 SRT**。

## What Changes

- **BREAKING**：字幕卡 **不再** 维护可编辑 cue 表；移除「从分镜规则填充 cue」「手加一行」「用模型生成 cue」。
- 主操作改为 **「生成 SRT」**：选定文本模型后，根据连线分镜与引用字段调用现有文本能力，产出 **标准 SRT 正文**（UTF-8，导出时含 BOM）。
- 字幕卡持久化 **SRT 正文**（如 `srtBody`），用于重开项目后预览与再次下载；**不再** 要求持久化 `cues[]`。
- 保留：不占镜号、分镜连线、`dialogue` / `video_prompt` 字段选择、会话级文本模型手选、不写回镜头、不提供 TTS、不并入整集字幕导出。
- **迁移**：已有仅含 `cues` 的旧卡可在打开时用既有序列化逻辑 **一次性** 转为 `srtBody`（仅当尚无 `srtBody`），不在 UI 暴露 cue。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `canvas-subtitle-card`：交付从「cue 列表 + 导出」改为「LLM 直出 SRT + 下载」；移除 cue 相关需求。

## Impact

- 前端：`SubtitleAssetPanel.tsx`、`subtitleCard.ts`（prompt/校验/迁移）、`data.ts` / `ProjectAsset` 字段、`Inspector.tsx`、`server/db.mjs` 资产清洗。
- 验证：更新或扩展 `verify-subtitle-card.mjs`（SRT 校验、迁移、无 cue UI 断言）。
- 与已完成的 `canvas-subtitle-card` 变更叠加：**归档顺序** 应先合并本变更再归档，或在本变更 apply 后撤销旧验收里对 cue 表的断言。
- 文本生成仍走 `/api/text`（`callText`），不产生新服务端路由。