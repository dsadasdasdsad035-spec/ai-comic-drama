# Tasks

## 1. Schema 与检索

- [x] 1.1 `src/transitionRecipes.ts` 扩 `TransitionRecipe`：新增 `kind`（`concrete`/`technique`，默认 concrete）、`whenToUse`、`energy`（`low`/`mid`/`mid-high`/`high`/`max`）、`durationHint`、`principle`、`variants[]`、`pitfalls[]`；验证：`npx tsc --noEmit` 无新增错误
- [x] 1.2 `searchTransitionRecipes` 匹配范围加入 `whenToUse`/`principle`/`pitfalls`；验证：`node verify-transitions.mjs` 断言用 principle 关键词能命中
- [x] 1.3 `src/agent/stageTools.ts` 的 `read_transition_recipes` 描述补字段说明；验证：描述含 `principle` 与 `pitfalls`

## 2. 导入上游 14 张转场卡

- [x] 2.1 导入 11 张具体卡：`bottom-push-stack-wipe`、`card-flip-reveal`、`circle-match-iris`、`gradient-transition`、`line-carry-transition`、`mosaic-reframe`、`page-turn-transitions`、`print-texture-transitions`、`tear-streak-transitions`、`white-flash-logo-simplify-cut`、`wipe-transitions`；每张填 `whenToUse`/`energy`/`durationHint`/`principle`/`seedanceHints`/`pitfalls`；验证：JSON 可解析且 11 条 id 齐全
- [x] 2.2 建 3 张技法卡：`shot-transitions`（A 推进流白/B 甩镜急刹/C 穿窗纵深）、`transition-hidden-cut`（A 前景遮挡/B 对撞开屏/C 暖色漏光）、`transition-travel`（字腔穿越），`kind: technique` + `variants[]`；验证：每张至少 1 个 variant 且含 `when`/`principle`
- [x] 2.3 校验脚本断言禁用词：迁移卡正文不得含 `bezier(`、`damping`、`stiffness`、`px`、`f@30fps` 类实现参数；验证：`node verify-joins.mjs` 退出码 0

## 3. 存量 16 条 transition 卡补齐

- [x] 3.1 为 `card-flock-tumble`、`cross-dissolve-soft`、`wipe-light-band`、`morph-weather`、`match-cut-action`、`time-skip-fadeblack`、`doorway-reveal`、`stair-descend`、`smoke-wipe`、`lightning-flash`、`rain-intensify`、`sunset-dissolve`、`luma-fade`、`iris-open`、`split-screen-slide`、`page-curl` 补 `whenToUse`/`energy`/`principle`/`pitfalls`；验证：16 条均有 `whenToUse`
- [x] 3.2 重写这 16 条的 `seedanceHints` 为完整句子；验证：每条 hint 长度 ≥ 12 字且以句号/逗号分隔的完整描述

## 4. 技能与文档

- [x] 4.1 `skills/cinematic-transition/SKILL.md` 增加字段消费规则：`principle`→视觉机制、`pitfalls`→负向约束、`energy`→运动质感、`variants`→选型；并加禁令「不抄帧数/缓动/像素」；验证：SKILL.md 含这些关键词
- [x] 4.2 `skills/transition-planner/SKILL.md` 增加「读卡时按 whenToUse 判断适用性、按 energy 决定 modeHint 倾向」；验证：文件含 `whenToUse` 与 `energy`
- [x] 4.3 `src/transitionRecipes.README.md` 把「增量同步」改为「字段迁移规则」，写明六项映射与禁用参数；验证：README 含映射表与禁用清单
- [x] 4.4 `openspec validate transition-recipe-migration --strict` 通过；验证：命令退出码 0

## Workflow follow-up

- 完成后归档 `transition-recipe-migration`，合并 delta 至 `openspec/specs/shot-transition-agent/spec.md`。
- 非转场类上游卡（camera/space/character/vfx/ai_video 共 33 条）另开变更处理。
