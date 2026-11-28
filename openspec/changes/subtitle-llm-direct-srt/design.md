# Design

## Context

见 `proposal.md`。现实现：`SubtitleAssetPanel` + `subtitleCard.ts`（规则填 cue、JSON LLM、`exportSubtitleCardSrt(cues)`），`ProjectAsset`/`extra.cues` 由 `server/db.mjs` 透传。文本能力与其它环节相同：`callText` + `modelPick.text` / `defaults.text`。

## Goals / Non-Goals

**Goals:**

- 一条主路径：连线分镜 → 选字段/模型 → **生成 SRT** → 预览 → **下载**。
- 持久化 `srtBody`（字符串），重开可再下。
- 生成前在 user 提示里注入 **分镜时间窗**（沿用 `subtitleLlmUserPrompt` 的镜号 + `seconds` 累计 ms），system 要求 **只输出 SRT**（序号 + `HH:MM:SS,mmm` 时间轴 + 文本）。
- 客户端 **校验** 模型输出（最少：能解析出 ≥1 条带时间与非空文本的字幕块）；失败不覆盖旧 `srtBody`。

**Non-Goals:**

- 整集字幕、烧录、发布包自动合并。
- 字幕卡 TTS。
- 服务端新路由（仍 `/api/text`）。
- 在 Inspector 恢复 cue 级编辑；若需改字，允许 **只读以外的整段 SRT 文本框手改**（可选，见 Open Questions）。

## Decisions

1. **存储字段 `srtBody`（extra / asset 顶层与现有 `cues` 同级）**  
   - 理由：单一交付物，与「不需要 cue」一致。  
   - 备选：仅存 blob URL —— 不利于 diff 与轻量预览，否决。

2. **模型输出形态：SRT 纯文本（`json: false`）**  
   - 理由：贴合用户表述；减少「JSON → 序列化」一步。  
   - 备选：仍要 JSON 再 `serializeSrt` —— 对用户不可见，否决为主路径。  
   - 缓解：校验 + 可选一次「修复格式」重试（同模型、短 prompt）可在 tasks 里标可选。

3. **校验层**  
   - 在 `subtitleCard.ts` 增加 `parseSrtBlocks` / `isValidSubtitleSrt`（轻量正则或按块切分，不引入新依赖）。  
   - 不通过则报错，不写库。

4. **UI 收缩**  
   - 移除 cue 列表、规则填充、生成 cue。  
   - 按钮：**生成 SRT**、**下载 SRT**；**只读或可选可编辑** 的 `textarea` 展示 `srtBody`（默认可编辑整段 SRT，不拆 cue——仍满足「无 cue」）。  
   - 保留：标题、引用字段、已引用镜号、`CapModelSelect` text、生成说明。

5. **迁移**  
   - `load` / `hydrate` 或 `writeProject` 清洗前：`if (cues?.length && !srtBody) srtBody = exportSubtitleCardSrt(cues)`，随后可删 `cues` 写回。  
   - 纯函数 + `verify-subtitle-card.mjs` 覆盖。

6. **与 `canvas-subtitle-card` 变更关系**  
   - apply 本变更后更新 `verify-subtitle-card.mjs` / UI 验收，去掉 cue 相关断言。  
   - 两变更未同时归档时，以本 delta 规格为准。

## Risks / Trade-offs

- **[Risk] 模型 SRT 格式脏（逗号/序号/时间轴）** → 校验 + 明确 system 模板；可选一次修复重试。  
- **[Risk] 时间轴与分镜 `seconds` 偏离** → user 提示写死每镜 `[start,end)` 建议区间，要求不得超出总时长。  
- **[Risk] 大段 SRT 占 SQLite** → 字幕片段体量可接受；超长可后续加截断提示。  
- **[Trade-off] 失去毫秒级 GUI 编辑** → 用户可改整段 SRT 文本；复杂校对应在外部字幕工具完成。

## Migration Plan

- 无服务端 schema 版本：字段级兼容。  
- 旧项目打开即懒迁移 `cues` → `srtBody`。  
- 回滚：恢复旧面板与 `cues` 字段（若已删 cue 数据，仅 `srtBody` 可反向粗解析，不保证完美）。

## Open Questions

- **SRT 预览是否允许用户手改正文再保存？** 建议 **允许**（整段 textarea，仍无 cue），默认写入规格若无异议；若只要只读，apply 时改 UI。