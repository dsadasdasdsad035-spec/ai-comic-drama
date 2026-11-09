# Proposal

## Why

创意工作室已改为 Pi + `read_skill` 驱动，但用户无法核对「实际送给模型的 system / user / 工具集」，且模式 Tab 会覆盖手选宿主技能，system 里仍注入模式与会话元数据。需要在不回到预灌 SKILL 正文的前提下，让创意聊天与工作台 Pi 一样可审计，并在切换技能时只依赖会话历史续聊。

## What Changes

- 在创意头部增加「查看将发送」检查器，展示与下一轮 `run()` 将使用的 **system**、**合成 user**（`【之前的对话】` + 输入框草稿）、**工具列表**；不展示 SKILL 全文（由 `read_skill` 在运行时读取）。
- 抽取单一的 `buildCreativeTurnPayload(...)`（或等价函数），`run()` 与检查器 **必须共用**，避免预览与真发分叉。
- **解耦** 创意模式 Tab（策划 / 反推 / 复刻）与 `hostSkillId`：Tab 只影响空态、快捷动作、能力托盘上下文；宿主技能由下拉决定。可选：Tab 首次进入时仅 **推荐** 默认技能，用户手选后锁定直至用户改回「跟随模式」。
- 切换宿主技能或只读技能时 **不清空** 会话消息；下一轮 system 使用 **极简 Pi 引导**（`read_skill` 指令 + 当前宿主 id/版本），**不注入** `创意模式：…`、`会话：…` 等 extras；只读技能名单不再写入 system（仅在 UI 与工具绑定中体现）。
- 保持 `runStageAgent` + Pi 原生 tool calling，不改回 JSON action 或 `buildSkillPrompt` 任务卡。
- 发送路径不变：`userForModel` 仍为当前轮用户原文；历史仍经 `threadTranscript` 拼入 user 前缀（本变更不改为 Pi 多轮 message 数组，除非设计阶段验证后另开子任务）。

## Capabilities

### New Capabilities

- `creative-payload-inspect`: 创意会话「查看将发送」检查器的可见内容、与真发一致性、以及输入框草稿预览规则。

### Modified Capabilities

- `creative-chat`: 宿主技能手选与模式 Tab 解耦；切换技能后的 system 极简策略；会话历史保留策略。
- `chat-agent-runtime`: 澄清创意会话属于统一 Pi 运行时，并约束创意侧 history 拼接方式在检查器中的呈现。

## Impact

- 前端：`src/creative/CreativeStudio.tsx`、`CreativeHeader.tsx`，复用或轻量适配 `WorkbenchHeader` / `WorkbenchInspector`（`src/chat-ui/`、`src/agent/workbenchChat.ts`）。
- 运行时：`src/agent/pi/stageRunner.ts`（只读引用拼接规则）、`src/agent/threads.ts`（`threadTranscript`）。
- 技能：`buildPiAgentSystem` 或创意专用 system 构建；`src/creative/tools.ts` 工具绑定不变语义。
- 测试：新增 `verify-creative-payload-inspect.mjs`（或扩展现有创意验收脚本）断言检查器字段与 mock `run()` 一致。
- 无服务端 API 变更；无数据库变更。
