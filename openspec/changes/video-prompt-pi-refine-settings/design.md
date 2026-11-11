# Design

## Context

见 `proposal.md`。`seedance-llm-prompt-render` 已实现 bundle、`renderSeedancePrompt`、`submit_prompt_renders` 与面板按钮；运行时机械后缀已移除。设置页已有按技能编辑 role/task（`SettingsPage`）。工作台 `SkillChat` + `WorkbenchInspector` + `runStageAgent` 可复用。

## Goals / Non-Goals

**Goals:**

- `resolveVideoPromptRenderPrompt(projectSettings, skillId='seedance-prompt-render')` → `{ system, taskTemplate, templateDigest, source: builtin|override }` 供 `callText` 与 Pi 共用。
- 弹窗 `PromptRefineModal`：左侧对话、右侧/上方检查器；`buildPromptRefineAdapter(shot|transition)` 注入 bundle 快照、当前 `rendered`、指纹。
- Pi 技能 `seedance-prompt-refine`：`read_shots` + `read_characters` + `submit_prompt_renders`（单实体门禁）。
- 检查器 MUST 展示设置生效全文（role、task）、Pi system、草稿合成 user、工具名列表。

**Non-Goals:**

- 不把九段 SKILL 正文预灌进 Pi system（仍 `read_skill` 或检查器只读展示）。
- 不恢复运行时拼表演/图注/衔接段。
- 不把内置动作做成模型工具。
- 首期不把 `threadTranscript` 改为 Pi 原生多轮 message 数组（与工作台一致）。

## Decisions

### D1. 唯一 system 来源

**决定**：模板渲染的 LLM `system` = Pi 宿主引导（改稿）或 **仅技能 role+task 合并**（一键渲染可走 `callText`：`system = role`，`prompt = task 填充 + bundle JSON`）；**禁止** `promptRender.ts` 内独立 `RENDER_SYSTEM` 字符串长期存在。

**备选**：保留硬编码 + 设置可选覆盖 — 否决，与用户「设置即模板」冲突。

### D2. 单技能 `seedance-prompt-render`

**决定**：转场与单镜共用设置里同一条技能；bundle `kind` 区分；任务模板文案中说明转场约束（inputMode、首尾帧）。

**备选**：`seedance-prompt-render-transition` — 否决，双模板维护成本高。

### D3. refine 独立技能

**决定**：`seedance-prompt-refine` 专注多轮；task 强调在现有 `rendered` 上修订；写回仍 `submit_prompt_renders`。一键冷启动仍可用 render 技能或同一 render 路径。

**备选**：仅一个技能兼 render+refine — 可后续合并，首期分技能便于设置页区分的 task 文案。

### D4. 弹窗 UX

**决定**：Modal（用户明确要求），内复用 `SkillChat` 布局子集；检查器复用 `WorkbenchInspector` tabs，扩展「技能 task」「bundle 摘要」行。

**备选**：Inspector 内嵌 — 否决（用户要弹窗）。

### D5. templateVersion / stale

**决定**：`render_meta.templateVersion` = `PROMPT_RENDER_SKILL_ID@builtinVersion+overrideHash`（或短 hash）；设置改 task/role 后 overrideHash 变 → `templateStale`。

**备选**：仅内置 `seedance-2.5-cn-9` 常量 — 不足以反映用户改模板。

## Risks / Trade-offs

- [设置改坏模板导致渲染失败] → 保留 builtin 恢复默认；失败不覆盖上次成功 `rendered`。
- [弹窗 token 过大] → bundle 大时检查器折叠，模型侧 encourage `read_*` 而非整包 inline。
- [一键与 Pi 行为不一致] → 共享 `resolveVideoPromptRenderPrompt`。

## Migration Plan

1. 实现 resolver，切换 `renderSeedancePrompt` 使用设置。
2. 上线弹窗与 refine 技能；旧项目无 rendered 可引导先模板渲染。
3. 删除或 deprecated 未使用的 `RENDER_SYSTEM` / server 重复模板常量（对齐 SKILL 内置九段说明）。

## Open Questions

- refine 入口是否在无 `rendered` 时允许「从零渲」：建议 v1 允许，与一键渲染等价但经 Pi（用户可后续收紧）。
