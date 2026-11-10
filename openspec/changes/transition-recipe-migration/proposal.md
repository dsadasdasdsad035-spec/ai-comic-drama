# Proposal

## Why

转场提示词目前由两层产出：运行时按规则拼四段模板，以及 `cinematic-transition` 技能写 `generated.prompt`。两者的素材来源是 `transitionRecipes.json`——但实测对账上游 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)，**上游 15 张 transition 卡只导入了 1 张（`card-flock-tumble`）**，10 张 camera 卡一张未入；本地 49 条是手写的独立条目，只借用了命名风格。README 里写的「增量同步」从未真正发生。

更关键的是字段层面：上游卡里能直接变成提示词的 `适用 / 能量 / 意图 / 已知坑` 全被丢掉了，只剩一个 120 字 `intent` 和一个四字标签级的 `seedanceHints`（`["推镜穿门", "内外光差渐变"]`）。Agent 拿这种素材写不出有信息量的桥接提示词。

## What Changes

- **食谱 schema 扩字段**（全部可选，向后兼容）：`kind`（`concrete` / `technique`）、`whenToUse`、`energy`、`durationHint`（秒）、`principle`、`variants[]`、`pitfalls[]`。
- **导入上游 14 张缺失的转场卡**：只迁可迁移字段（选型条件、能量、时长、视觉原理、负向约束、提示词短句），**丢弃全部 Remotion 参数**（帧数、缓动曲线、像素坐标、damping/stiffness）。
- **重写 `seedanceHints`**：从四字标签改为可直接进提示词的完整句子。
- **技法卡保留多式结构**：`shot-transitions`、`transition-hidden-cut`、`transition-travel` 三张是多式技法卡，用 `kind: technique` + `variants[]` 建模，MUST NOT 压平成单条。
- **技能消费新字段**：`cinematic-transition` / `transition-planner` 的 SKILL.md 明确要求从 `principle` 提取视觉机制、从 `pitfalls` 提取负向约束、按 `energy` 决定运动质感措辞，并禁止抄 Remotion 参数。
- **检索覆盖新字段**：`searchTransitionRecipes` 纳入 `whenToUse` / `principle` / `pitfalls`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-agent`: 转场食谱索引的能力扩为「可迁移字段 + 多式技法卡」，并要求 Agent 按 `principle` / `pitfalls` / `energy` 写提示词、不复制上游实现参数。

## Impact

- **类型/模块**：`src/transitionRecipes.ts`（类型与检索）、`src/transitionRecipes.json`（内容）。
- **技能**：`skills/cinematic-transition/SKILL.md`、`skills/transition-planner/SKILL.md`。
- **工具描述**：`src/agent/stageTools.ts` 的 `read_transition_recipes` 说明。
- **文档**：`src/transitionRecipes.README.md` 的同步流程改写为「字段迁移规则」。
- **测试**：`verify-joins.mjs` 扩展字段与检索断言。
- **不做**：不改运行时拼装（`autoTransitionVideoPrompt`）、不动 `joins-v1` 契约、不引入 Remotion 依赖、不迁移非转场类（camera/space/character/vfx/ai_video 共 33 条）的内容。
