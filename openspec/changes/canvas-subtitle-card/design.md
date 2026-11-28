# Design

## Context

- 整集字幕：`App.tsx` → `buildShotCaptions` + `buildEpisodeSrt`，只读镜头 `dialogue`。
- 素材卡：`AssetKind` 无 `subtitle`；音频/图片生成见 `asset-card-generation`。
- 分镜 → 素材引用：见变更 `asset-shot-prompt-ref`（`sourceShotIds`、派生边）。

## Goals / Non-Goals

**Goals:**

- 新 `kind=subtitle` 节点 + `ProjectAsset` 存 `cues[]`。
- Inspector：cue 编辑器、引用分镜摘要、文本 `CapModelSelect` / `StageModelSelect`、导出 SRT、可选「从分镜填充/LLM 生成」。
- 复用 `captions.ts` 的 SRT 时间格式函数（或抽 `cuesToSrt(cues, baseMs=0)`）。

**Non-Goals:**

- 写回 `dialogue`；并入 `buildEpisodeSrt`；烧录读字幕卡；字幕 TTS。
- per-card 文本 modelKey 持久化（先用 `modelPick.text` / `stagePick`）。

## Decisions

1. **Cue 形状** 对齐 `CaptionCue` 子集：`{ id, text, startMs, endMs, speaker? }`，卡内时间为 **相对 00:00**（片段导出）；连线分镜仅用于文案与可选按时长均分，不写入成片绝对时间。
2. **填充路径**  
   - **规则**：`parseDialogue` + `buildShotCaptions` 同源逻辑，对单镜 `dialogue` 拆 cue（零 token）。  
   - **模型**：`/api/text` + JSON schema（cue 数组），system 约束字数/行数参考 `CAPTION_STYLE`。
3. **存储** `assets.extra`: `{ cues, sourceShotIds, promptSource: 'dialogue'|'video_prompt', promptNote? }`；`kind` 扩展为 `subtitle` 或 `extra.assetRole='subtitle'`（实现时与 DB 枚举对齐二选一，prefer 正式 `kind`）。
4. **导出** 客户端 `Blob` + 下载，文件名 `${project}-${cardTitle|id}.srt`。

## Risks / Trade-offs

- **[两套字幕源]** → 文案说明：整集导出仍用镜头 dialogue；字幕卡仅供独立稿。
- **[无连线分镜]** → 允许手编 cue；生成按钮提示先连线（`asset-shot-prompt-ref`）。

## Migration Plan

无强制迁移。旧项目无字幕卡。

## Open Questions

无。