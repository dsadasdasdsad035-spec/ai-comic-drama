# Proposal

## Why

画布将 TTS 与 Flow Music 挤在同一张「音频素材卡」里，只能靠换模型区分，与字幕卡已独立的产品形态不一致，也让分镜引用、模型选择与 Inspector 文案混乱。用户需要独立的**音乐素材卡**做 BGM/歌曲生成，**音频素材卡**专注配音与旁白文案 TTS；音乐卡须与音频卡同样支持分镜文案引用（`asset-shot-prompt-ref`）。

## What Changes

- 新增画布 **音乐素材卡**（`kind=music`）：风格/情绪 prompt、`musicLyrics`、`musicLength`，走已接入的 `/api/music`（如 Flow Music）。
- **音频素材卡**收窄为 **TTS 专用**：移除音乐模型分支与音乐字段；模型下拉只展示非音乐类音频模型。
- 画布菜单拆为「新建配音素材卡」与「新建音乐素材卡」；去掉「语音/音乐」混写 hint。
- 音乐卡 **共用** 分镜引用：`sourceShotIds`、`promptSource`（默认 `dialogue`）、`buildAssetAudioPrompt` → `sound_prompt`。
- 会话级 **`modelPick.music`**（与 `audio` 分列）；设置页 `defaults.music` 回落；音乐 Inspector 提供音乐模型下拉。
- 生成结果 **可连出片镜** 作单条音频参考（与音频卡一致）。
- **不包含**：存量 `kind=audio` 卡自动改 kind；镜头 Inspector 旁白 TTS（`narratorVoice`）；每卡永久 modelKey；Suno 等新音乐渠道（仅规范已接入 Flow Music 路径）。

## Capabilities

### New Capabilities

- `canvas-music-asset-card`：音乐素材卡生命周期、生成契约、模型选择、分镜引用、出片连线。

### Modified Capabilities

- `asset-card-generation`：音频卡仅 TTS；出片音频参考含音乐卡；删除「同卡语音/音乐靠模型切换」语义。
- `asset-shot-prompt-ref`：接受 `kind=music` 的分镜连线与生成合并（与音频/字幕并列）。

## Impact

- 前端：`AssetKind`、`data.ts`、`BoardMenu`、`App.tsx`（`onAddMusicAsset`、`generateAssetMusic`）、`Inspector`/`MusicAssetPanel`、`assetShotPromptRef.assetAcceptsShotPromptRef`、`mediaPick`、`ModelSelect` / `modelPick` 类型。
- 后端：`assets.kind` 允许 `music`；`POST /api/music` 已有；持久化 `extra` 含歌词/时长/引用字段。
- 验证：扩展 `verify-asset-shot-prompt-ref.mjs`、`verify-apimart-music.mjs`；可选 `verify-music-asset-card.mjs`。
- 规格冲突消解：推翻 `asset-card-image-audio` / `canvas-asset-model-pick` 中「音频卡无旁白音乐开关、靠模型两用」的意图，以拆卡替代。