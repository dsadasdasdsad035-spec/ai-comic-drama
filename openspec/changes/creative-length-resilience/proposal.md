# Proposal

## Why

创意会话（以及其余工作台聊天）在一集 20–40 镜的真实产出里会稳定撞上三种长度失败：输入历史爆掉上下文窗口、单次输出撞 `finish_reason: length`、工具参数被截断成半截 JSON。当前实现把三者都当成终止条件：历史全量重放且从不压缩，撞长度上限直接 `fail()`，`submit_*` 只接受一次性完整契约。结果是用户看到红色报错、已生成的内容无法续写，只能新建会话重来。

## What Changes

- **输出长度上限改为续写**：模型调用返回 `length` 且没有工具调用时，同一轮内自动追加一条「从断点继续、不要重复」的推动消息并重新请求，保留已流出的正文；续写次数与总时长受限。达到上限仍失败时才报错，且错误必须说明已保留部分。
- **工具参数被截断不再伪装成 JSON 错误**：`length` 与工具调用同时出现时不执行半截参数，改为按可执行指令重新请求（拆批或分批写入），并向界面发出可见的「已截断续写」提示。
- **写入工具支持分批**：`submit_*` 接受可选的 `cursor` / `limit`，返回 `nextCursor` 与剩余条数；按业务键幂等合并，分批写回与一次写回结果一致。单次 payload 超过上限时返回结构化「请拆批」错误，而不是契约校验失败。
- **历史改为预算策略**：最近若干轮工具结果保持原文；更早的工具结果替换为一行指针 stub（指明用哪个读工具重取），原文不被改写；指针也不够时按阈值升级为摘要。`context-overflow` 不再是终点：先按激进策略压缩后重试一次，仍失败才提示新建会话。
- **系统提示与历史能力对齐**：凡声明「已读过的内容可不再重复读取」的地方，必须在 stub 生效时改为「请用读工具重新取」，不允许承诺历史并不支持的能力。
- **环节输出预算可配**：高产出环节（创意、分镜）可显式配置 `maxTokens`，错误信息据此说明撞的是哪一档上限。

## Capabilities

### New Capabilities

- `agent-chunked-write`: 原生工具的分批写入契约——可选游标、单次条数上限、幂等合并、超限时的可执行拆批回执。

### Modified Capabilities

- `chat-agent-runtime`: 新增「输出长度上限必须续写」要求，并规定续写事件、次数上限与失败文案；原有「运行上限与取消」要求补充续写也受同一总时长约束。
- `creative-thread-context`: 把「历史工具结果不做长度裁剪」「历史不按轮次或总量丢弃」替换为预算策略——最近轮次保真、更早工具结果指针化、必要时摘要化；`context-overflow` 先压缩重试再报错。
- `shots-workbench`: 允许分多批写回 `shots-v1`，并明确分批写回与单次写回在画布结果与提示词展开上必须等价。

## Impact

- 运行时：`src/agent/pi/streamFn.ts`（`length` 分支）、`src/agent/pi/stageRunner.ts`（`finishTurn` / `prepareNextTurn` / `transformContext`）、`src/agent/pi/engine.ts`（续写与现有 `pendingNudge` 对齐）、`src/agent/pi/threadMemory.ts`、`src/agent/pi/compact.ts`。
- 写入工具：`src/agent/stageTools.ts`（`submit` 工具与契约校验）、`src/skills/contracts*`（游标字段与分页回执）、`src/platform/projectDraft.ts`（幂等合并）。
- 服务端与渠道：`server/app.ts` 的 `context-overflow` 分支增加「压缩后重试」所需的错误分类透传；`src/api.ts` 的流事件需要携带续写提示。
- 环节配置：`src/skills/stages.ts` 的 `maxTokens` 从占位字段变为可配置项，设置页与运行解析共用。
- 验收脚本：`verify-creative-context-overflow.mjs` 的「只提示新建会话」断言需要随新行为更新；新增续写与分批写入的验收脚本。
