# Proposal

## Why

`scene-agent-full-host` 在 `skills/scene3d/SKILL.md` 中声明了 `run_bash` 等宿主工具，但技能白名单 `KNOWN_TOOL_IDS` 未同步登记，导致内置 `scene3d` 技能加载失败。3D 调度聊天用 `disabled={!sceneSkill}` 锁死输入框，用户表现为完全不能发消息且无明确错误。同期 3D 聊天从未接入「清空对话」，旧线程只能持久恢复，无法像其他内容工作台一样显式清会话。

## What Changes

- 在 `KNOWN_TOOL_IDS` 登记 full_host 对应的四个 agent 宿主工具名，恢复 `scene3d` 技能校验与加载。
- `SceneAgentChat`：技能加载失败时展示可读错误（toast/条带），不得静默；输入不应因技能暂不可用而无限期整框禁用（允许用户看到原因并重试）。
- 为 3D 调度聊天增加「清空对话」：确认 → 取消运行中 agent → `clearChatThread`（`surface: scene3d` + 镜头 id）→ 清空 UI 状态，防 500ms 自动保存写回。
- 验收脚本：内置 `scene3d` 技能装载用例；可选扩展 `verify-workbench-chat-clear` 或独立 3D 清空场景。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workbench-chat-clear`：将 3D 调度 agent 聊天纳入清空范围（按项目 + 镜头隔离）。
- `scene-agent-chat-ui`：技能不可用时的可观察错误与输入行为；3D 聊天清空入口与流程。

## Impact

- `src/skills/tools.ts`、`src/agent/SceneAgentChat.tsx`、`src/agent/ChatThreadShell` 或 3D 侧栏头部。
- 复用 `src/agent/threads.ts` 的 `clearChatThread` 与 `SkillChat` 清空模式（`clearGen`、abort、防写回）。
- 测试：`tests/skill-parser.ts` 或新装载用例；`verify-workbench-chat-clear.mjs` 或 `verify-scene3d-chat-clear.mjs`。
