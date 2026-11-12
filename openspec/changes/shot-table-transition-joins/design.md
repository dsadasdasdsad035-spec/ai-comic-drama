# Design

> 宿主变更（2026-11-11）：`canvas-only-shots-workbench` 下线镜头表，接缝的展示与编辑面改为画布顺序边 + 转场面板；本文中的「镜头表接缝行」一律按画布接缝理解，数据契约不变。


## Context

- 转场持久化已在源镜 `transition_out`（见 `shotSync`、`TransitionPanel`、`transitionGen`）。
- 镜头表 `ShotTable` 仅编辑 shot 行；聊天绑定 `shotlist` + `shots-v1`。
- 规则建议 `suggestTransition` + 8 条 `transitionRecipes.json`；OpenSpec 已有 `shot-transition-agent` / continuity / video-prompt。
- 用户确认：接缝行 **A 全显示**、推荐路线 **1 缝行 UI + 2 transition-planner + 3 Shotcraft 索引扩展**。

## Goals / Non-Goals

**Goals:**

- 镜头表插入「接缝行」组件，单点读写 `transitionOut`。
- 新增 `transition-planner` 技能、`joins-v1`、`submit_joins` 工具链。
- 扩展食谱 JSON 与 taxonomy 映射表（六类 → mode/recipe 启发）。
- 接缝行与 `TransitionPanel` 字段复用（或共享 `normalizeTransitionOut` 更新函数）。

**Non-Goals:**

- Remotion / shotcraft demo 运行时依赖。
- 在 `shotlist` 单次调用中输出全部 joins（保持两阶段）。
- 自动对全片批量调用 Seedance 生成转场视频。
- 镜头表新增真实 shot 类型行或导出时间线结构变更。

## Decisions

### 1. 单一真相：`transitionOut` on source shot

接缝行 UI 的 `joinId` = `(sourceShotId, targetShotId)`；所有字段 merge 进 `source.transitionOut`，`to` 必须指向 target 的 `shotId`。

**备选**：独立 `episode.joins[]` 数组 → 拒绝，避免画布/导出/表三份合并。

### 2. 硬切表示

默认无 `transitionOut` 或 `relation=cut` 显示「硬切」折叠行。用户升级为转场时：写 `relation=transition` + `defaultTransition(to)` 或保留 effect 默认叠化。

### 3. joins-v1 形状（Agent）

```json
{
  "joins": [{
    "after_no": "S01",
    "to_no": "S02",
    "relation": "transition",
    "mode": "generated",
    "taxonomy": "character",
    "recipe_ids": ["match-cut-action"],
    "generated": {
      "prompt": "...",
      "sound_prompt": "...",
      "target_seconds": 1.5
    }
  }]
}
```

`applyDraft` 按 `after_no` 找镜，写 `transitionOut`；`to_no` 校验与播放序下一镜一致，不一致 warn 仍以 `to_no` 解析 shotId。

### 4. transition-planner 技能

- `tools`: `read_shots`, `read_transition_recipes`（top-k / 按 taxonomy 过滤）, `submit_joins`
- 内置动作：「规划本集镜间转场」（镜头表聊天 header 或空态）
- System prompt：六类 taxonomy 决策树 + Shotcraft 卡片意图转 Seedance 正文（无代码块）
- 可先调用 `suggestTransition` 规则作 cold start，再由 LLM 润色 prompt

### 5. 食谱扩展

- 增量脚本：扫描 clone 的 `references/shots/transition/*.md` + 精选 `camera/*.md`，写入 `transitionRecipes.json`
- 新字段：`taxonomy`, `modeHint` (`effect`|`generated`|`either`), `seedanceHints`（字符串数组）
- 目标 40+；仓库默认提交精简 json，脚本可选

### 6. UI 复用

接缝展开后：

- 效果区：复用 `transitionPresets` 选择器（轻量）
- 生成区：`prompt` / `soundPrompt` textarea + 链到「在画布编辑」或内嵌只读 `OutgoingVideoPromptPanel` 预览（二期可只做字段 + 跳转画布）

首期：字段编辑 + stale 提示；完整出片预览仍鼓励画布 `TransitionPanel`。

### 7. 播放序 vs 画布

接缝列表按集内镜头数组顺序 `(shots[i], shots[i+1])` 生成；`writeTransition` 与表编辑共用 `onPatch(sourceId, { transitionOut })`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 表高度膨胀（每镜 +1 行） | 硬切默认折叠 |
| Agent 全片 generated 成本 | 技能要求默认 effect，仅 hero 缝 generated |
| `to_no` 与序错乱 | 提交时校验相邻；提供「与序对齐」修复按钮（tasks 可选） |
| 双端编辑冲突 | 同一字段、保存级合并；`handEdited` 含 `transition_out` |

## Migration Plan

- 旧项目：无 `transitionOut` → 接缝显示硬切，展开后编辑即创建。
- 已有 `transitionOut`：表按 `to` 匹配下一镜 shotId，不匹配则警告行。
- 无 DB 迁移。

## Open Questions

- 接缝行是否内嵌「生成视频」按钮（或仅跳转画布）——首期建议 **仅跳转画布**，避免重复底栏逻辑。
- `transition-planner` 是否独立聊天 surface 或挂在镜头表同一 chat——首期 **同 surface，第二内置动作**。
