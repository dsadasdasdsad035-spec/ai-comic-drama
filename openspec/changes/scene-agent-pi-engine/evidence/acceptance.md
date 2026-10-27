# 组 8 验收记录：真机结果

日期：2026-10-26
环境：macOS arm64 / Node 22.23.2 / Blender 5.2.2 LTS / Vite dev（127.0.0.1:5273）

## 依赖与体积

- `@earendil-works/pi-agent-core@1.4.0`、`@earendil-works/pi-ai@1.4.0`（均为精确版本）。
- 浏览器产物增量：`Agent` 最小入口 minified **164.7 KB**；完整适配层入口 198.2 KB。
- 构建后 `SceneAgentChat` 懒加载 chunk 为 239.51 KB（gzip 71.34 kB），包含 pi 运行时。

## 自动化验收

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `node verify-pi-engine.mjs` | 消息转换、事件合成、错误/取消/截断编码、schema、依赖边界 | 全部通过 |
| `node verify-pi-agent.mjs` | 工具顺序、content/details 分离、finish 终止、催促、取消、超时、修复上限、引擎选择四分支 | 全部通过 |
| `node verify-pi-alignment.mjs` | 7 个场景双引擎对比 + 事件分组 + 镜头隔离 | 全部通过，无差异白名单 |
| `node verify-agent-graph.mjs` | LangGraph 引擎全量回归 | 全部通过 |
| `node verify-settings-db.mjs` | 设置读写与归一化（含新增 `agentEngine`） | 全部通过 |
| `node verify-all.mjs pi` | 三个 pi 脚本被总入口自动发现 | 均通过（同批 6 个失败为既有脚本要求 5280 端口，与本次无关） |

## 真机结果（mock 模型 + 真实 Blender）

### pi 引擎完整链路

项目 `agent-duel-mock-1793027963…`，镜头 E01-S01，4 秒 16:9：

- 6 次模型调用，工具顺序 `get_shot_context → set_scene_code → run_render → capture_frames → review_frames → finish`
- 代码 162 行，hash `21b03761ff58…`，通过渲染试运行
- 关键帧 5 张（0/1/2/3/4s），视觉清单 7/7 通过
- MP4 4.0s、960x540，已保存并在聊天里给出视频卡
- 聊天头部显示「引擎：pi」「工具协议：原生 tool calls」

证据：`evidence/duel/agent-duel-pi.png`、`agent-duel-pi.mp4`、`agent-duel-pi-checklist.json`、`agent-duel-pi-frame-*.jpg`

### 同一镜头双引擎

项目 `agent-duel-same-shot`，同一镜头 E01-S01 先后跑两个引擎：

| 引擎 | 试运行 | 代码 hash | 帧 | 视频 |
|---|---|---|---|---|
| langgraph | 通过 | `21b03761ff58…` | 5 | 4.0s 960x540 |
| pi | 通过 | `21b03761ff58…` | 5 | 4.0s 960x540 |

第二次运行复用了第一次的聊天线程（历史消息与旧帧都在），说明切换引擎不丢线程记录。

### 取消

在 `run_render` 执行中点「取消」：

- 工具收到 abort signal，Blender 作业结束
- 聊天标记「已取消」，取消后不再出现新一轮模型调用或「运行完成」事件
- 镜头原有 `scene_code` 内容与 hash 未变，未产生新的调度视频

证据：`evidence/duel/agent-pi-cancel.png`

## 与既有行为的两点说明

1. **代码何时写入项目**：agent 侧没有保存工具，代码阶段只更新工作台草稿（`applyAgentDraft` 仅改本地状态）。写入项目发生在既有的「视频验收 → 采用」流程里（`acceptAgentVideo`），这是 `agent-video-acceptance` 变更已有的行为，本变更没有改动它。因此任务 8.4 的表述已按此修正。
2. **两个旧脚本已陈旧**：`verify-agent-3d-duel.mjs` 与 `verify-agent-chat-ui.mjs` 仍在找画布右击菜单的「编辑 3D 调度」，而该入口已被「3D 调度收在提示词工作台」的变更移除，脚本必然失败。本次没有修改这两个共享脚本（它们属于另一个变更、证据目录也指向那边），而是在 `.verify-pi-spike/` 下用同一份 duel 脚本改为提示词工作台入口后运行。后续应单独更新这两个脚本。

## 默认引擎与设置页（产品决定变更）

实现完成后，产品决定把默认引擎从 LangGraph 改为 **pi**：

- `DEFAULT_SCENE_AGENT_ENGINE = 'pi'`；能力表外的模型自动回退 LangGraph，并在聊天头部与结果里标明原因。
- 设置页「Agent 运行上限」新增「执行引擎」下拉，可显式切换 pi / LangGraph。
- 已存在的设置库如果显式存过 `agentEngine`，不会被默认值覆盖；本次把当前设置库的值同步设为 `pi`。
- 相应更新了 `specs/scene-agent-runtime/spec.md` 的默认引擎要求、`proposal.md` 的 BREAKING 标注、`design.md` 的选择规则。

设置页验收（`settings-engine.mjs`）：下拉存在、默认 pi、切 langgraph 后落库、刷新回读仍是 langgraph、恢复原值成功。

## 已知限制

- `/api/text` 无 token 级正文流，文本在轮次结束时整段落地。
- `agent.abort()` 不会自行终止循环，`streamFn` 必须感知 signal；已由取消用例覆盖。
- 取消后已发生的工具结果仍保留在审计轨迹（`session.events`），只是不再推给 UI。
