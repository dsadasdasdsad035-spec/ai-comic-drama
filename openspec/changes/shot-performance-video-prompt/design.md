# Design

## Context

- 表演数据：`ShotData.performance`、`dialogueDelivery`，经 `shotSync` 与镜头表/Inspector 双向同步。
- 出片唯一拼装：`buildShotVideoRequest`（`src/videoPrompt.ts`）→ 正文 = `video_prompt` / 回退 + `motionNote` + 原生音频句 + 参考图/视频图注；**尚无表演段**。
- `performanceSummary()` 已用于 UI 摘要，偏短；配音用 `deliveryForSpeaker`。
- `reference_video` 仅来自 `collectVideoReferences`（素材连线），与表演无耦合（见主 spec `shot-video-prompt`）。

## Goals / Non-Goals

**Goals:**

- 纯函数 `performanceVideoPromptBlock(performance, dialogue, dialogueDelivery)` → 稳定中文段落（或空字符串）。
- 在 `buildShotVideoRequest` 中于 `motionNote` 之后、`refHint` 之前插入该段。
- `fingerprintOf` 增加 performance + dialogue_delivery 序列化。
- `VideoPromptPanel` 摘要增加表演计数/「无表演」。

**Non-Goals:**

- 不改 `reference_video`、3D `scheduleVideo`、表情参考图逻辑（表情仍独立开关）。
- 不在此 change 重写提示词技能或 `video_prompt` 字段生成规则。
- 不做「表演驱动自动生成参考视频」。

## Decisions

1. **段落格式**  
   固定前缀 `\n\n【表演方向】` + 按 cast 顺序或 performance 数组顺序的短句；说话角色标注「说话」；逐行 `dialogue_delivery` 仅在对应台词行存在时附加语速/音量（可选一行汇总）。  
   *备选：复用 `performanceSummary`  alone* — 信息不足（缺 speaks、delivery），故新函数。

2. **与已有 `video_prompt` 的关系**  
   不尝试从正文反查去重；表演段 **始终追加**（有数据时）。技能生成的 `video_prompt` 可能已含表情描述，允许短量重复，避免 NLP 去重复杂度和漏拼。  
   *备选：仅当 `video_prompt` 为空时追加* — 拒绝，因用户常只有 `prompt` 回退。

3. **兼容**  
   空 `performance` → 不追加段，指纹仍可比；回归用例限定无 performance fixture。

4. **手改**  
   指纹纳入表演；与现有 override 行为一致，不自动覆盖手改。

## Risks / Trade-offs

- **[Risk] 正文变长、与技能 video_prompt 重复** → 段落保持紧凑（每角色一行）；后续可用手改或技能调整。
- **[Risk] 有 performance 的旧镜头出片 prompt 变化** → 属预期行为；spec 已声明；`videoMeta` 仍记录实际发送文本。

## Migration Plan

- 纯前端/拼装层变更，无 DB 迁移。
- 部署后：已有手改快照可能在首次打开时出现旧快照警告（若表演曾变）— 用户可「重新拼装」。

## Open Questions

（无）
