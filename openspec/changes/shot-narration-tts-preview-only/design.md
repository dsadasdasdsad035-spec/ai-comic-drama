# Design

## Context

见 `proposal.md`。实现上已有 `generateVoice`（多行、表演映射）与 `App.generateVoiceOne`（未挂 UI）；`intake/normalize` 的 `NARRATOR` 正则与 `splitDialogueCell` 已区分旁白，但 `intake/rows.ts` 把旁白写入 `desc`。连播 `buildPlaylist` 已固定 `audio` 为 native/none，与 R2 一致。旁白 TTS 需在不大改播放/导出的前提下补数据路径与 Inspector 入口。

## Goals / Non-Goals

**Goals:**

- 旁白行稳定落在 `dialogue`，画布可一键 TTS、试听、下载。
- 项目级旁白 `modelKey` + `voiceId`，合成与 stale 仅针对旁白行。
- 复用 `voiceUrl` / `voiceMeta`，增加 `scope: 'narration'`（或等价字段）。

**Non-Goals:**

- 连播/导出混旁白轨；角色全场 TTS；批量本集；从 `desc` 迁移历史旁白；时间线配音轨编辑。

## Decisions

### 1. 旁白声线存项目元数据

**选择**：在 `project.json` 项目级增加 `narratorVoice: { modelKey, voiceId }`（命名以实现为准），设置页提供「项目旁白声线」配置（可挂在音色/流水线子面板，并写当前项目）。

**备选**：虚拟角色「旁白」——复用角色 UI 但污染 cast 检索；**否决**。

**备选**：仅用 `defaults.audio` + 手选音色——无法多项目不同解说腔；**否决**。

### 2. 导入：`narrators` 并入 `dialogue`

**选择**：`rows.ts` 在构建 row 时把 `cell.narrators` 追加到 `dialogue` 数组（与 `lines` 顺序按单元格解析顺序）；保留把纯音效写入 `desc` 的逻辑。

**备选**：只改展示、不改导入——仍无法生成；**否决**。

### 3. 合成函数

**选择**：从 `generateVoiceOne` 抽出 `buildNarrationPayload(dialogue, narratorVoice, delivery)` + `generateNarrationOne(nodeId)`；说话人过滤共享 `NARRATOR`（导出为 `src/narration.ts` 或 `intake/normalize` re-export）。

指纹：`voiceFingerprintNarration(narrationLines, deliveries)` 只 hash 旁白行。

`voiceMeta.scope = 'narration'`，`voiceMeta.voice` 记旁白音色 id。

### 4. Inspector UI

**选择**：台词 textarea 下方增加旁白区：检测 `parseDialogue` 中旁白行数 → 按钮「生成旁白」、`<audio controls>`、链式下载；固定 `gen-note` 文案。

**备选**：独立 Tab——与 R2 去声音 Tab 冲突；**否决**。

### 5. 播放与导出

**选择**：**无代码改动**于 `Preview.buildPlaylist` / 导出（已不读 TTS）；验收加回归断言。若时间线仍展示 `voiceUrl`，角标/tooltip 标「仅试听」。

### 6. Agent（P1 可选）

`generate_narration`：`no` + 可选 `episode`，与按钮同路径写回 `audio_ref` 可省略（旁白不用 native）；仍可写 `voice_meta` 对齐 project shot。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 旧镜 `voiceUrl` 为整镜配音，试听语义混淆 | `scope` 缺失时 Inspector 显示「历史配音，建议重生成旁白」 |
| 多旁白行多引擎混行 | 与 `generateVoiceOne` 相同：单请求多行同 `modelKey`；旁白固定项目模型 |
| 用户误以为会进导出 | 文案 + README；验收覆盖 export payload |
| `canvas-prod-modes-no-voice` 并行改 Inspector | 本变更只加旁白块，不恢复「生成配音」 |

## Migration Plan

- 无 schema 迁移；新字段可选，缺省即不能生成直至配置旁白声线。
- 导入行为变更仅影响**新导入/重新导入**镜头；已存 `desc` 内旁白不自动回迁（文档说明可手补或重导）。

## Open Questions

- 旁白配置 UI 放在设置「音色」旁还是项目侧栏——实现时跟 `settings-hub-ia-v3` 现有分区二选一即可。