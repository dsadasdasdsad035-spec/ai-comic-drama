# Design

## Context

已实现 `/api/music`（APIMart Flow Music）、`generateMusic()`，以及在同一张 `kind=audio` 卡上按 `isMusicAudioModel()` 分支。字幕卡与 `asset-shot-prompt-ref` 已落地：`sourceShotIds`、`ref-shot-*` 边、`buildAssetAudioPrompt`。`AssetKind` 尚无 `music`。

## Goals / Non-Goals

**Goals:**

- `kind=music` 独立节点与 `ProjectAsset` 持久化。
- `generateAssetMusic`：合并 prompt → `sound_prompt`；歌词/时长独立字段；`modelPick.music` + `defaults.music`。
- `assetAcceptsShotPromptRef` 含 `music`；`onConnect` / 右键 / 删边与音频卡一致。
- 音频卡删除音乐分支；`CapModelSelect` 按卡种过滤目录（`features.music` vs TTS）。
- 出片 `collectAudioReferences` 识别 `music` 卡 URL。

**Non-Goals:**

- 自动迁移旧音频卡为音乐卡。
- 新音乐渠道接入、计费表修订。
- Agent 批量建音乐卡（可后续跟 `creative-asset-tools`）。

## Decisions

1. **卡种**：`AssetKind` 增加 `music`，对齐 `subtitle` 拆卡模式（方案 A）。
2. **默认引用字段**：新建音乐卡 `promptSource: 'dialogue'`，与音频/字幕默认一致。
3. **模型会话键**：新增 `ModelPick.music` 与设置 `defaults.music`；音乐卡 Inspector 仅用 `music` 能力槽，避免覆盖 TTS 的 `modelPick.audio`。
4. **合并函数**：复用 `buildAssetAudioPrompt` 输出作为 `sound_prompt`；`musicLyrics` 不参与 merge。
5. **生成门槛**：`merged` 与 `musicLyrics` 至少其一非空方可提交（与现混卡校验对齐）。
6. **UI**：`BoardMenu` 两项——「配音素材卡」「音乐素材卡」；音频 hint 改为 TTS/旁白文案，音乐 hint 为 BGM/歌曲。
7. **面板**：`MusicAssetPanel` 或在 `Inspector` 内 `kind===music` 分支，字段：prompt、歌词、时长、分镜引用块、模型下拉、生成按钮。

## Risks / Trade-offs

- **[未归档的 asset-card-generation 主规格]** → 本变更 delta 与历史 change 一并 archive 时合并语义。
- **[用户旧项目 audio 卡选了 flowmusic]** → 保留卡数据；生成时若仍为 audio+music 模型可提示「请新建音乐卡」或短期保留只读兼容（实现可选，默认提示迁移）。
- **[DB kind 枚举]** → 服务端保存 `assets` 时接受 `music`；旧客户端忽略未知 kind 时仅显示 generic——需同步发版。

## Migration Plan

- 新字段缺省：`musicLength` 30、`promptSource` dialogue、`sourceShotIds` []。
- 不批量改存量 `kind`。
- 部署：前端 + `npm run build:server` 同版发布。

## Open Questions

无（分镜引用范围已由用户确认：与音频卡共用 `asset-shot-prompt-ref`）。