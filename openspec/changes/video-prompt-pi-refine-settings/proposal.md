# Proposal

## Why

分镜出片与镜间转场出片应共用**设置页**里对 `seedance-prompt-render` 技能配置的「角色与约束 / 任务模板」，作为唯一的九段渲染说明；用户还需在弹窗中用 **Pi 多轮聊天**改稿，并像工作台一样**审计发给模型的完整上下文**。当前「模板渲染」仍走客户端硬编码 `RENDER_SYSTEM`，与设置页技能覆盖脱节，且缺少改稿聊天与检查器。

## What Changes

- 统一渲染 system：**一键模板渲染**、**Pi 改稿弹窗**、（可选）服务端 `/api/text` 路径 MUST 通过设置解析后的技能 `role`+`task`（`seedance-prompt-render`），禁止独立维护第二套九段 system 副本（`RENDER_SYSTEM` / `buildPromptRenderSystem` 仅作迁移期 fallback 或删除）。
- **单技能双场景**：同一技能与设置模板同时服务 `PromptRenderBundle.kind: shot` 与 `transition`；不设第二条转场专用模板技能。
- **出片提示词改稿弹窗**：分镜 Inspector、转场面板提供入口；内嵌精简 `SkillChat`（Pi）+ `WorkbenchInspector` 展示 Pi 引导、设置生效的 role/task、bundle 说明、合成 user、工具列表；线程按镜或接缝隔离。
- 新增 **`seedance-prompt-refine`** 技能（或扩展 render 技能 task）：多轮 refine，工具 `submit_prompt_renders` 写回 `video_prompt_rendered` / 转场 `renderedPrompt`；默认写模板层，不替代手改 `override` 语义。
- **模板版本 / stale**：`templateVersion` 或等价 hash MUST 反映设置覆盖内容变化（技能内置 revision + 用户 override hash），设置改模板后标 stale 直至重渲。
- 更新既有规格中与「机械拼装回退」「恢复机械拼装」矛盾的表述（实现已改为语义层 + 模板渲染）。

## Capabilities

### New Capabilities

- `seedance-prompt-render`：设置驱动的 bundle→九段渲染契约；单镜与转场共用；禁止旁路硬编码 system。
- `video-prompt-refine-chat`：出片面板 Pi 改稿弹窗、聊天记录、上下文检查器、写回与指纹。

### Modified Capabilities

- `shot-video-prompt`：面板入口、正文来源优先级、改稿弹窗与检查器、去除机械拼装相关场景。
- `shot-transition-video-prompt`：转场模板渲染与改稿弹窗、与单镜共用技能模板。
- `chat-agent-runtime`：出片改稿线程键与项目隔离。

## Impact

- `src/promptRender.ts`、`server/promptRender.mjs`：统一 `resolvePromptRenderSkillSystem(settings)`。
- `src/App.tsx`、`Inspector.tsx`、`TransitionPanel.tsx`、`OutgoingVideoPromptPanel.tsx`：弹窗与 adapter。
- `skills/seedance-prompt-render`、`skills/seedance-prompt-refine`（新）、`src/agent/`（SkillChat 复用、threads）。
- `src/settings/`：无需新字段，复用技能覆盖存储。
- 测试：`verify-prompt-render.mjs`、新 `verify-video-prompt-refine.mjs`、扩展 UI 验收。
