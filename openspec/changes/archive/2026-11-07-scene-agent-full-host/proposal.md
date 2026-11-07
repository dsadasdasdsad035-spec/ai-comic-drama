# Proposal

## Why

3D 调度聊天已用 pi 跑原生 tool_calls，但工具面仍限于 12 个受控工具，模型无法用本机 Blender、脚本或文件做探索式调试，复杂场景质量受限。需要在 **保留调度真相链** 的前提下，提供可选的 **full_host** 权限档，让 agent 通过服务端执行 shell/文件类工具，同时 pi 循环与渲染门禁不变。

## What Changes

- 设置页新增 **3D Agent 权限档**：`restricted`（现状）与 `full_host`（扩展工具）。
- **full_host** 在 pi 中注册扩展工具：`run_bash`、`read_file`、`write_file`、`list_dir`（首期）；命令在 **服务端 job 沙箱** 执行，浏览器不直接 exec。
- 新增 `POST /api/agent/shell`（及配套 read/write/list）作业 API：超时、取消、stdout/stderr 截断、cwd 限制在当前 agent job 目录。
- 更新 **`skills/scene3d`** 角色与流程：允许探索性 bash/文件工具；**写入项目/工作台可采纳代码** 仍须 `commit_scene_draft` / `set_scene_code` → `run_render` →（按需）`capture_frames` / `review_frames` → `finish`。
- **BREAKING（行为，非 API）**：默认仍为 `restricted`；用户显式开启 `full_host` 后工具集与 SKILL 文案变化。mock 验收默认不启用真 shell。

## Capabilities

### New Capabilities

（无独立新 capability；宿主工具 API 归在 scene-agent-runtime 下描述。）

### Modified Capabilities

- `scene-agent-runtime`：权限档、扩展工具、服务端 shell、full_host 下越权边界与审计。
- `scene-blocking-3d`：明确 shell/临时文件 **不** 单独更新调度指纹或 `schedule_video`。

## Impact

- `server/`：agent shell job runner + Vite 路由。
- `src/agent/sceneAgentTools.ts`、`pi/engine.ts`、`SceneAgentChat.tsx`：按设置注册工具。
- `src/settings/`、`skills/scene3d/SKILL.md`。
- `verify-pi-agent.mjs` 及新 `verify-agent-shell.mjs`（mock）。
- 主规格 `scene-agent-runtime`、`scene-blocking-3d` 在归档时同步。

## Out of Scope

- 动态透传任意未知工具名（无 schema 的模型幻觉工具）。
- 放宽入库 `sceneCode` 的静态 ABI（禁止 subprocess 等）——探索可在 bash 中做，入库仍走 sanitizer。
- C2：用 bash 直接产出调度视频并跳过 `run_render` / `finish`。
- 其他工作台聊天（镜头表、剧本等）的 full_host。
