# Proposal

## Why

3D agent 同时暴露 6 个 `*_scene_draft` 工具与 full_host 的 shell/写文件，模型路径重复、聊天卡片臃肿，且与「在 job 沙箱里用 shell 写脚本」的工作方式不一致。产品选择 **默认 full_host**，在 job 内完成编写与试跑，经单一窄门 `adopt_scene_from_job` 将代码纳入会话并走既有 `run_render` 门禁，不再向模型提供 scene-draft 分片工具。

## What Changes

- **默认** `agentHostMode` 为 `full_host`；`restricted` 保留（无 shell，仅 `set_scene_code` 等）。
- 从 agent 工具集、SKILL、UI、`KNOWN_TOOL_IDS` **移除** `begin/append/read/patch/commit/discard_scene_draft`；下线 scene-draft 相关验收为主路径。
- **新增** `adopt_scene_from_job(path)`：仅读当前 agent job 内相对路径 → 静态准入 → 设为 `session.code`；不写项目文件。
- 更新 `skills/scene3d`（v3）：工作流为 `get_shot_context` → job 内 `write_file`/`run_bash` → `adopt_scene_from_job` → `run_render` → … → `finish`。
- 删除或改造 `verify-agent-draft.mjs`；补充 adopt + 默认 full_host 验收。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-agent-runtime`：工具集、默认权限档、adopt 进门禁；不再要求向模型暴露 scene-draft 工具。
- `scene-agent-chat-ui`：无 draft 工具卡片；展示 adopt；默认 full_host 风险提示。

## Impact

- `src/agent/sceneAgentTools.ts`、`SceneAgentChat.tsx`、`pi/compact.ts`、`skills/scene3d/SKILL.md`、`src/skills/tools.ts`
- `src/agent/agentHostMode.ts`、`api.ts`、`SettingsPage`、`vite.config` 默认值
- `server/agentHost.mjs`（adopt 读路径经已有 read API）
- OpenSpec 主规格与归档后技能契约
