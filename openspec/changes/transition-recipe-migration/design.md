# Design

## Context

- 现状对账：上游 15 张 transition 卡只导入 1 张，10 张 camera 卡零导入；本地 49 条是手写条目（见 `proposal.md - Why`）。
- 现有 schema（`src/transitionRecipes.ts`）只有 `id / category / title / intent / tags / taxonomy / modeHint / seedanceHints`。
- 上游卡结构：frontmatter（`一句话 / 适用 / 时长 / 能量 / 标签`）+ 正文（`## 意图` / `## 动效核心` / `## 参数表` / `## 已知坑` / `## 参考实现`）。
- 消费方只有两处：`read_transition_recipes` 工具（Agent）与 `transitionSuggest` 规则建议。

## Goals / Non-Goals

**Goals:**

- 让食谱成为「可直接喂给提示词写手」的素材，而不是标签索引。
- 保住多式技法卡的选型结构。
- 字段全部可选，旧卡零改动仍可用。

**Non-Goals:**

- 不迁 Remotion 参数（帧数、缓动、像素、弹簧）。
- 不改运行时 `autoTransitionVideoPrompt` 的拼装。
- 不改 `joins-v1` 契约。
- 不迁非 transition 类的 33 条上游卡。

## Decisions

### 1. 字段集只收「能进提示词」的六项

**决策：** 新增 `whenToUse` / `energy` / `durationHint` / `principle` / `pitfalls` / `variants`，全部可选。

映射关系：

| 上游位置 | 本地字段 | 理由 |
|---|---|---|
| `适用` | `whenToUse` | 选型依据，Agent 判断该不该用 |
| `能量` | `energy` | 决定运动质感与建议时长 |
| `时长`（秒部分） | `durationHint` | 直接对应 `generated.targetSeconds` |
| `## 意图` 核心段 | `principle` | 提示词的视觉机制来源 |
| `## 已知坑` | `pitfalls[]` | 转负向约束 |
| `## 参数表` | ❌ 不迁 | Remotion 专用 |

**备选：** 全字段照搬。否决：参数表会对 Agent 产生误导，让它写出「12 根 160px 叶片」这类对 Seedance 无意义的描述。

### 2. 技法卡用 `kind` + `variants`，不扁平化

**决策：** `kind: 'technique'` 的卡必须带 `variants[]`（`id / label / when / principle`）；`kind: 'concrete'` 为默认。

上游三张技法卡对应关系：

- `shot-transitions` → A 推进流白 / B 甩镜急刹 / C 穿窗纵深
- `transition-hidden-cut` → A 前景遮挡隐形切 / B 对撞开屏 / C 暖色漏光
- `transition-travel` → A 字腔穿越（该卡实际只有一式，但仍标 technique 以保留「技法卡不占能量位」语义）

**备选：** 每条变体拆成独立卡。否决：选型发生在同一张卡内部（按能量落差选式），拆开后 Agent 失去「择一」的语境。

### 3. `energy` 取值按上游实际分布

**决策：** `'low' | 'mid' | 'mid-high' | 'high' | 'max'`，技法卡不设 `energy`（上游写「n/a 技法卡」）。

**备选：** 三档 `low/mid/high`。否决：上游区分了「中高」和「极高」，而「极高」是「全片能量顶点」这种有明确用法的语义，合并会丢信息。

### 4. `seedanceHints` 重写标准

**决策：** 每条必须是完整句子，包含「做什么动作 → 画面怎么变」的可视描述。检验标准：能直接作为桥接正文的一句，不需要再扩写。

反例（当前）：`["推镜穿门"]`
正例：`["摄影机沿门框方向持续推进，穿过门洞进入下一空间"]`

### 5. 现有 16 条 transition 卡的处理

**决策：** 保留全部 16 条（本地 ID 与上游不重叠，是独立资产），但按新标准补齐 `whenToUse` / `energy` / `principle` / `pitfalls`，并把 `seedanceHints` 从标签重写为句子。**不删除**任何现有条目。

**备选：** 用上游卡替换本地卡。否决：本地卡（如 `morph-weather`、`match-cut-action`）是围绕本项目业务（两镜成片衔接）设计的，语义比上游通用卡更贴。

### 6. 检索扩到新字段

**决策：** `searchTransitionRecipes` 的匹配范围加入 `whenToUse` / `principle` / `pitfalls`，`taxonomy` 过滤不变。

## Risks / Trade-offs

- **[Risk] 内容量大、手写易错** → 迁移时逐卡对照上游原文，`pitfalls` 原文摘录不改写；校验脚本断言禁用词（`bezier`、`damping`、`stiffness`、`px`、`f` 帧数）。
- **[Risk] `energy` 语义漂移** → 取值枚举固定，并在 README 写明每档的用法（`max` = 全片顶点，一片一次）。
- **[Risk] 字段膨胀让 JSON 难维护** → 全部可选，旧条目不动；新条目按需补。
- **[Risk] 技能提示词写不好用新字段** → SKILL.md 给出明确的「从哪个字段取什么」映射，并加一条禁令（不抄实现参数）。

## Migration Plan

- 无数据迁移，JSON 读入时缺字段即为 `undefined`。
- 回滚：删除新增字段即可，消费方已按可选处理。
