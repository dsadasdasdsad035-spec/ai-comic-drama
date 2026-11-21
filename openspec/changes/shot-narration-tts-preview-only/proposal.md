# Proposal

## Why

解说向分镜常含 `旁白：` 行，但画布缺少 dedicated 的旁白 TTS 入口；表格导入又把旁白挤进画面描述而非台词字段，导致无法合成。产品已与用户确认：**旁白配音仅在 Inspector 试听与下载 mp3**，不进连播与导出成片（与镜头 TTS 退场 / R2 一致），因此需要一条窄而明确的旁白 TTS 能力，而非恢复整镜「生成配音」。

## What Changes

- **项目旁白声线**：当前项目 MUST 可配置旁白配音模型键与音色（无角色卡）；未配置时生成操作 MUST 失败并提示。
- **导入落库**：分镜导入时旁白行 MUST 写入镜头 `dialogue`，MUST NOT 仅追加到 `desc`；旁白不进 `cast`。
- **画布 Inspector**：在叙事/音画 Tab 提供 **「生成旁白」**（仅合成旁白说话人行）、试听、下载与 stale 提示；固定说明不进连播/导出。
- **合成逻辑**：复用既有 TTS 渠道与 `generateVoice` 多行能力；只抽取旁白类说话人；`voiceMeta` 标记旁白范围；fingerprint 只 hash 旁白行。
- **播放/导出**：连播与时间线 **MUST NOT** 因旁白 `voiceUrl` 播放或提交音轨（保持 R2）。
- **可选 Agent**：`generate_narration` 工具与按钮同契约。
- **不做**：批量本集旁白（可后续）、连播叠轨、从 `desc` 自动回溯提取历史旁白、角色对白 TTS 回画布入口。

## Capabilities

### New Capabilities

- `shot-narration-tts`：项目旁白声线、画布旁白 TTS 生成、Inspector 试听/下载、与连播/导出隔离的契约。

### Modified Capabilities

- `workbench-text-intake`：落库时旁白进入 `dialogue` 字段，与既有「台词列分离」规格对齐实现。

## Impact

- 前端：`src/intake/rows.ts`、`Inspector.tsx`、`App.tsx`（抽出 `generateNarrationOne`）、`projectTypes` / 项目元数据、`voiceCatalog.ts` 旁白解析、可选 `ShotNode` 角标。
- 设置/项目：旁白声线 UI（设置页子区或项目面板，与 README 角色配音分流）。
- Agent：`builtinPlatformTools.ts` 可选 `generate_narration`。
- 文档：README「表演方向、配音」增旁白试听说明；明确连播不用旁白 mp3。
- 验收：扩 `verify-shot-inspector` 或新增 `verify-narration-tts.mjs`；`verify-preview-captions` / `verify-export` 断言连播仍不播 `voiceUrl`。
- 依赖：与进行中 `canvas-prod-modes-no-voice` 方向兼容（不恢复全台词 TTS）。

## 用户已确认

- 播放策略 **选项 2**：仅 Inspector 试听 / 下载 mp3，不进连播与导出。