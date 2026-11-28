# Proposal

## Why

整集字幕导出只消费镜头上的 `dialogue`，无法在画布上单独维护「一镜或多镜」的字幕稿、也不能导出片段 SRT。用户需要一种不占镜号、可连线分镜取文案、可选文本模型改写分行的**字幕素材卡**；TTS 仍由音频卡负责，字幕 cue **不写回**镜头字段。

## What Changes

- 画布新增 **字幕素材卡**（`kind=subtitle`）：不占镜号、不计入集镜数/时长。
- 卡内维护 **cue 列表**（文本 + 起止时间，毫秒或 SRT 兼容字段），支持手编；可选从连线分镜的 `dialogue` 或 `video_prompt` 经规则拆条或经文本模型生成。
- Inspector 提供 **文本模型** 手选（`text` / `textPro`，会话级 `modelPick`，与环节默认一致）。
- 提供 **导出 SRT 片段**（本卡 cues 序列化，UTF-8 BOM）；不要求并入现有「导出本集字幕」。
- 支持 **分镜 → 字幕卡** 引用（见配套变更 `asset-shot-prompt-ref`）：用于文案来源与（可选）相对时间窗。
- **不包含**：字幕 cue 写回 `shots[].dialogue`、字幕卡 TTS、字幕卡并入烧录/整集 SRT 自动合并、per-card 永久 modelKey。

## Capabilities

### New Capabilities

- `canvas-subtitle-card`：画布字幕素材卡、cue 持久化、文本生成、SRT 片段导出。

### Modified Capabilities

- `asset-canvas-publishing`：新建入口包含字幕卡（若该规格覆盖画布素材类型枚举）。

## Impact

- 前端：`AssetKind`、`data.ts`、`App.tsx`（新建/持久化）、`Inspector.tsx`（字幕面板）、`captions.ts`（复用 SRT 序列化或抽共享函数）、`BoardMenu` 可选入口。
- 数据：`ProjectAsset.extra` 存 `cues`、`sourceShotIds`、`promptSource` 等；`assets.kind` 或 extra 区分 subtitle。
- 后端：仅存取与迁移；文本生成走现有 `/api/text`。
- 验证：`verify-subtitle-card*.mjs`（纯函数 cue/SRT + 可选 UI 断言）。
- 依赖：`asset-shot-prompt-ref` 实现分镜连线语义；`canvas-asset-model-pick` 与音频/图片模型选择无冲突。