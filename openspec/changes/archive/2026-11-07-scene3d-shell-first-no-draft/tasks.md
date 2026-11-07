# Tasks

## 1. 默认 full_host 与设置

- [x] 1.1 `agentHostMode` 默认改为 `full_host`（api、vite 归一化、设置页默认与文案）；验证：新装设置缺省为 full_host

## 2. adopt 工具与移除 draft

- [x] 2.1 实现 `adopt_scene_from_job`（读 job 文件、准入、applyCode、事件）；注册 full_host；restricted 不注册
- [x] 2.2 从 `createSceneAgentTools`、SKILL v3、`KNOWN_TOOL_IDS` 移除六个 scene-draft 工具；新增 adopt；`set_scene_code` full_host 下简化为 applyCode（restricted 可保留内部分片）
- [x] 2.3 `SceneAgentChat` 移除 Draft* UI；增加 adopt 工具卡片（若需）；`pi/compact.ts` 清理 DRAFT 折叠

## 3. 技能与验收

- [x] 3.1 更新 `skills/scene3d/SKILL.md` 工作流与 tools 列表
- [x] 3.2 调整 `verify-pi-agent.mjs`（无 draft、有 adopt）；新增或替换 `verify-scene3d-adopt.mjs`；处理 `verify-agent-draft.mjs`
- [x] 3.3 `npm run build`；`openspec validate scene3d-shell-first-no-draft --strict`
