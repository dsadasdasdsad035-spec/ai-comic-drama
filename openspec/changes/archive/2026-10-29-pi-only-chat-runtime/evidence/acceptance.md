# 验收记录

日期：2026-10-29

## 1. 真实模型能力探测

见 `model-probe.md`。结论：ark-plan 通道 8 个模型在单工具与深层嵌套 schema 下均稳定通过；
标准方舟 Key 已 401；APIMart 单工具通过但限流严重，按产品决定不纳入能力表。

## 2. 契约收紧的真实效果

同一提示词、只改 `shots-v1` 的 `required`：

| 模型 | 收紧前 | 收紧后 |
|---|---|---|
| kimi-k3 | 只回 `{no:"S01"}` 且通过校验 | 两镜均含全部必填字段 |
| 豆包 lite / deepseek-flash / glm-5.3 | 通过 | 通过 |

收紧后 7 个 ark-plan 模型全部两镜均含 `no/scene_no/scene_slug/seconds/size/move/desc`。

## 3. 单元与纯逻辑验收

| 脚本 | 结果 |
|---|---|
| `node verify-tool-contracts.mjs` | 全部通过（14 项） |
| `node verify-native-tool-protocol.mjs` | 通过 |
| `node verify-pi-engine.mjs` | 通过 |
| `node verify-pi-agent.mjs` | 通过（43 项，含迁入的「试运行失败后修复」「镜头隔离」） |
| `node verify-skills-unit.mjs` | 11 个测试文件全部通过 |
| `node verify-character-extract-contract.mjs` / `verify-creative-reverse-contract.mjs` / `verify-publish-contract.mjs` | 全部通过 |

## 4. 浏览器验收（mock 模型，原生工具调用）

| 脚本 | 结果 |
|---|---|
| `verify-agent-chat-ui.mjs` | 39 项通过 / 0 失败 |
| `verify-agent-chat-failure.mjs` | 全部通过（失败 / 取消 / 超时） |
| `verify-agent-draft.mjs` | 19 项通过 |
| `verify-agent-video-acceptance-ui.mjs` | 22 项通过 / 0 失败 |
| `verify-workbench-chats.mjs` | 全部通过（四个内容工作台） |
| `verify-workbench-chat-ui.mjs` | 全部通过 |
| `verify-prompt-3d-workbench.mjs` | 全部通过 |

## 5. 真机验收（真实模型 + 真实后端）

截图：`real-workbench-shots.png`、`real-publish-chat.png`；明细：`real-chat-acceptance.json`。

- **工作台改稿（分镜助手）**：真实 MiniMax-M3 通过原生工具调用完成 3 轮——
  读本集与镜头表、`submit_shots` 写入 4 镜草稿（新增 3 / 更新 1）、给出镜表摘要。
  镜头表实际渲染 8 行，草稿未保存到项目（符合 `submit_*` 只产草稿的语义）。
- **发布助手**：真实模型基于当前项目状态回答「发布前还缺什么」（1269 字），
  列出成片、平台、文案、封面、账号、预检六类缺项，未改动任何配置。
- 两个入口都显示「工具协议：原生 tool calls」，聊天面板无 `JSON action` 字样。

## 6. 修复的真实缺陷

浏览器验收暴露了两处**实现缺陷**（不是测试问题），已修复：

1. **流错误被吞**：pi 的 `streamFn` 按契约把渠道失败编码进消息而不是抛出，
   两个运行器原先只检查 `controller.signal.aborted`，导致真实失败被报成
   「agent 未完成 finish」。现在两个运行器都读最后一条助手消息的 `stopReason` 与
   `errorMessage`，错误原因能正确显示。
2. **工具执行绕过 schema 校验**：直接调用 `execute` 的路径没有校验参数。
   适配层现在在 `execute` 内再用 zod 校验一次，与模型路径同一套拒绝语义。

## 7. 3D 调度迁移前后

`verify-agent-chat-ui.mjs` 走完整链路：6 次模型调用、12 个工具声明、
渲染试运行 → 抓 5 帧 → 视觉验收 → `finish` → MP4 生成与保存。
迁移前后断言项一致，全部通过。
