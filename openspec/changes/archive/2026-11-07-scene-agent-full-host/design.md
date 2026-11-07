# Design

## 决策

### 1. 权限档 C1（非 C2）

- `restricted`：仅现有 12 工具（默认）。
- `full_host`：12 + `run_bash` / `read_file` / `write_file` / `list_dir`。
- **入库与调度指纹**：不论档位，可采纳代码仍须 `run_render` 成功 + `finish`；bash 产出仅为探索，不写入 `project.json`、不更新 `schedule_video` / `sceneCodeMeta.fingerprint`。

### 2. 执行在服务端

- 浏览器 `SceneAgentChat` 通过 `fetch` 调用 `/api/agent/*`；与 `/api/blender/render` 同队列/取消语义。
- Job 目录：`<repo>/.agent-jobs/<uuid>/`，`run_bash` 默认 `cwd` 为此目录；`read_file`/`write_file` 路径 MUST resolve 在 job 目录内（禁止 `..` 逃逸）。
- 输出截断：stdout+stderr 各 ≤64KB 进模型；完整日志在 `details` 供 UI。

### 3. `run_bash` 形状

```json
{ "command": "blender --version", "cwd": ".", "timeout_ms": 30000 }
```

- 首期允许 shell 字符串（由服务端 `spawn` with `shell: true` 在 job cwd），记录审计日志（项目名、shotId、command 摘要）。
- 超时、取消 → 非零 exit + 可读错误；`AbortSignal` 链到 pi 取消。

### 4. pi 集成

- `createSceneAgentTools(deps, session, req, { mode })` 按 `settings.agentHostMode` 追加工具。
- `beforeToolCall` 仍拒绝未注册工具（不做全动态透传）。
- `skills/scene3d`：`tools:` frontmatter 拆成 `tools_restricted` / 文档说明 full_host 附加工具；运行时以注册表为准。

### 5. 设置

- `AppSettings.agentHostMode: 'restricted' | 'full_host'`，默认 `restricted`。
- 设置页「3D Agent」区：权限档 + 警告文案（本机命令、仅信任环境）。

### 6. 安全边界（full_host 仍禁止）

- 跨镜头写、改 `project.json`、任意 HTTP、读写 job 目录外路径。
- 网络：首期 shell 不注入代理；模型若 `curl` 仍受 OS 限制，spec 写「不提供专用网络工具」。

## 风险缓解

| 风险 | 缓解 |
|------|------|
| 命令破坏主机 | 默认 restricted；full_host 需显式开启 |
| CI 不稳定 | 验收 mock shell API，不测真 bash |
| 模型乱用 bash 跳过 render | SKILL + `finish` 门禁 + nudge 保留 |

## 非目标

- 放宽 `sceneCodeSanitize` 入库规则。
- LangGraph / 第二引擎回归。
