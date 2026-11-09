# Design

## Context

见 proposal。当前 `TransitionEffectType` 仅三型；`xfadeName` 产出 `fade`/`wipe*`/`slide*`。转场面板无聊天；画布选中边时展示 `TransitionPanel`。`shot-transition-continuity` 已实现 `transitionContinuityBlock`。

## Goals / Non-Goals

**Goals:**

- 约 15 个登记预设 + 类型扩展字段（`presetId`）。
- 转场面板「智能建议」：一次 LLM 调用或 Agent 工具，输出结构化 JSON，用户预览后应用。
- 内置 `transition-recipes.json`：首期 20～30 条，字段 `{ id, category, title, intent, tags, xfadeMap? }`，`id` 对齐 video-shotcraft 命名风格（可选外链说明），不要求仓库 submodule。

**Non-Goals:**

- Remotion 渲染、Workbench 轨道编辑。
- 自动触发出片。
- 152 张卡片全量镜像（仅 Transitions + 少量 Camera 作 prompt 词汇）。

## Decisions

1. **数据模型**  
   `TransitionEffect` 增加可选 `presetId?: string`。解析顺序：`presetId` → 查表得 xfade 名；否则走现有 `type`+`dir` 逻辑。`normalizeEffect` 负责校验与回退。

2. **预设表**（示例，实现前用 `ffmpeg -filters` 核对）  
   | presetId | 标签 | xfade |
   |----------|------|-------|
   | dissolve | 叠化 | fade |
   | fadeblack | 黑场 | fadeblack |
   | fadewhite | 白场 | fadewhite |
   | wipe-left/right/up/down | 擦除 | wipe* |
   | slide-left/... | 推移 | slide* |
   | radial | 径向 | radial |
   | circleopen / circleclose | 圆形 | circleopen / circleclose |
   | distance | 距离溶解 | distance |
   | squeezeh / squeezev | 挤压 | squeezeh / squeezev |

   不在 ffmpeg 列表中的条目不得进入首期表。

3. **UI**  
   效果区：`type` 下拉改为「预设网格」或二级（分类：经典 / 节奏 / 几何）；时长滑块不变。摘要 `effectLabel` 读预设中文名。

4. **Agent 建议**  
   - **V1**：`POST /api/transition/suggest`（或 Agent tool `suggest_transition`）输入 `{ sourceShot, targetShot, currentTransitionOut }` + 食谱索引 top-k 片段（按 category=transition 过滤）。  
   - 输出 schema：`{ mode, effect?: { presetId, seconds }, generated?: { prompt, soundPrompt, recipeIds?: string[] }, rationale: string }`。  
   - 面板按钮「智能建议」→ 展示 rationale + diff 预览 →「应用」。  
   - 系统 prompt 引用 `shot-transition-continuity` 规则：大跨度→generated；同场固定→短 dissolve/black；食谱 id 只写入 `generated.prompt` 末尾参考行或 meta，不进 ffmpeg。

5. **与 continuity 分层**  
   - Agent 写 `generated.prompt`（创意一句）。  
   - `autoTransitionVideoPrompt` 仍拼 `transitionContinuityBlock` + morph 尾句，除非 `videoPromptOverride` 全量接管。

6. **食谱来源**  
   维护脚本可选：从已 clone 的 video-shotcraft `references/shots/transitions/*.md` 提取 title/frontmatter → 再生 json；仓库默认提交精简手写 json，避免 GPL/体积问题。

## Risks / Trade-offs

- [xfade 名版本差异] → 启动时或 verify 脚本探测本机 ffmpeg 支持的 transition 列表，构建时过滤预设表。  
- [Agent 幻觉 presetId] → 服务端校验，非法 id 丢弃并回退 dissolve。  
- [变更面大] → 任务拆为：预设与导出先行，Agent 接口第二批但在同一 change 内。

## Migration Plan

旧 `transitionOut.effect` 无 `presetId` 行为不变。归档后无 DB 迁移。

## Open Questions

- 是否在画布全局聊天增加 `transition` surface（本期否，仅转场面板按钮）。
