# Design

## Context

- 自动拼装现状见 `proposal.md - Why`：`autoTransitionVideoPrompt` = 基础句 + 衔接块 + 尾句 + 声音块；`finalizeTransitionPromptText` 之后追加锚点/参考注记。
- 食谱数据已就绪（`transitionRecipes.json`，30 张转场卡含 `principle`/`seedanceHints`/`pitfalls`/`variants`）。
- 写入路径：Agent 走 `submit_joins` → `applyJoinsToShots` 写 `generated.recipeIds`；建议引擎走 `applyTransitionSuggestion`。
- **关键时序问题**：`finalizeTransitionPromptText` 在 `buildTransitionVideoPreview` 内部执行，而此时 `submitStyle` 已经算出（同函数内），可以直接用它决定是否追加参考注记。

## Goals / Non-Goals

**Goals:**

- 食谱内容真正进入发出去的正文。
- 正文与请求的附件集合一致。
- 无食谱时不改变现有行为（零回归）。

**Non-Goals:**

- 不加选卡 UI。
- 不改手改短路逻辑。
- 不把 `energy` / `durationHint` 写进正文（它们影响时长与措辞，属于写手职责，不属运行时模板）。
- 不做「按 taxonomy 自动匹配卡」——只认显式 `recipeIds`，避免静默改变老项目正文。

## Decisions

### 1. 食谱层插在 ① 与 ② 之间

**决策：** 拼装顺序变为：基础句 → **食谱层** → 衔接块 → 尾句 → 声音块 → 附件注记。

理由：食谱层描述的是「用什么手法」，衔接块描述的是「两镜怎么对齐」，前者是方法、后者是约束，方法在前更符合阅读顺序。

**备选：** 插在衔接块之后。否决：会出现「先说两镜景别，再说手法」，读者先建立约束再看到方法，行文倒置。

### 2. hints 与 principle 的取用规则

**决策：** 有 `seedanceHints` 用 hints（逐条成句），没有才用 `principle` 的整段。两者都取会让正文重复同一个意思。

**备选：** hints 与 principle 都写。否决：实测 `circle-match-iris` 的 principle 已覆盖 hints 的语义，合并会啰嗦。

### 3. 变体选择用 `variantId`，不回退猜测

**决策：** `generated.variantId` 显式指定；无指定时不猜，用卡级 hints 并给 warning。

**备选：** 按 `taxonomy` 或接缝特征自动选式。否决：选式依据是能量落差与语义，代码猜不准，猜错比不猜更糟。

### 4. 负向约束独立成段

**决策：** `pitfalls` 合并去重后生成固定开头「避免：」的一段，追加在最后（附件注记之前）。

**备选：** 混入正文各句。否决：会打断叙述流，且某些模型对「避免…」的句首更敏感。

### 5. 参考注记按 `submitStyle` 条件化

**决策：** `finalizeTransitionPromptText` 增加入参 `submitRefs: boolean`，为 false 时跳过参考图与参考视频注记，只保留结构锚点（锚点确实会提交）。

**备选：** 在注记里写「参考图本次不提交」。否决：那等于把内部互斥规则泄漏进提示词，对模型是噪音。

### 6. 用户自带正文含食谱时的重复

**决策：** 若 `g.prompt` 已经包含命中卡的某条 hint 原文（子串匹配），该条不再重复追加。

**备选：** 不去重。否决：Agent 写 prompt 时很可能已经用了 hints，直接追加会整段重复。

## Risks / Trade-offs

- **[Risk] 正文变长影响生成质量** → 食谱层只取该卡 hints（实测 1–3 条），且与用户正文去重。
- **[Risk] 老项目 recipeIds 指向已删卡** → 未知 id 静默忽略，正文与无卡时一致。
- **[Risk] pitfall 写得太具体（如「12 根叶片」）** → 迁移时已用禁用词校验排除实现参数。
- **[Risk] 互斥时正文少一段参考说明，模型不知道有参考图** → 确实不知道，因为本来就没送；清单与 warning 仍如实展示。

## Migration Plan

- 无数据迁移。`variantId` 可选。
- 回滚：去掉食谱层与 `submitRefs` 参数，正文恢复四层拼装。
