## 1. 服务端

- [x] 1.1 实现 `.agent-jobs/` 与 `POST /api/agent/shell|read|write|list`：沙箱路径、超时、取消、日志截断
- [x] 1.2 `vite.config` 路由与单 job 并发限制（可与 blender 队列协调）

## 2. Agent 工具与 pi

- [x] 2.1 `sceneAgentTools` 按 `agentHostMode` 注册 `run_bash` / `read_file` / `write_file` / `list_dir`
- [x] 2.2 `SceneAgentChat` deps 调用新 API；保持 `run_render` / `finish` 门禁与 nudge
- [x] 2.3 更新 `skills/scene3d/SKILL.md`（full_host 工作流、仍须 run_render/finish）

## 3. 设置与类型

- [x] 3.1 `AppSettings.agentHostMode`、设置页 UI 与持久化
- [x] 3.2 README 安全说明一节

## 4. 验收

- [x] 4.1 扩展 `verify-pi-agent.mjs`（mock shell）；新增 `verify-agent-shell.mjs`
- [x] 4.2 `npm run build`；`openspec validate scene-agent-full-host --strict`
