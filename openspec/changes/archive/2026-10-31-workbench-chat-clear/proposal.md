# Proposal

## Why

剧本、角色、素材、镜头表（以及同一聊天壳上的提示词）每个范围内只有一条活线程，关掉再开会恢复全部消息。下一轮模型会带上近 12 轮摘要，旧讨论会干扰新指令。用户需要显式清空当前对话，让大模型不再收到会话内容。

## What Changes

- 五个内容工作台聊天（剧本、角色、素材、镜头表、提示词）在头部提供「清空对话」：确认后删除当前线程的消息与持久化记录。
- 清空后界面回到该工作台空态；下一次发送 MUST NOT 把旧会话摘要写入 `【之前的对话】`。
- 清空前若本轮模型或内置动作仍在跑，MUST 先取消，再删线程，MUST NOT 把取消前的半截轨迹写回已清空的线程。
- 清空范围只含聊天会话：消息、只读技能、本轮附件、检查器状态。MUST NOT 改工作台草稿、项目数据、宿主技能或当前模型。
- 空线程时入口禁用；有内容时确认一次。清空不可恢复，不做会话列表或归档。
- 复用已有 `DELETE /api/chat-thread` 与 `clearChatThread`；补上界面，并打断 500ms 自动保存，避免旧消息被写回。

提示词与点名的四个工作台共用 `SkillChat` 和同一套 12 轮历史，一并覆盖。3D、发布、创意聊天不做。

明确不做：

- 不做多会话列表、归档或「新对话保留旧记录」。
- 不改线程键（仍按项目 / 项目+集）。
- 不改技能任务卡、读工具、附件清单规则。
- 不改 3D / 发布 / 创意聊天。
- 不清空左侧草稿或项目存储。

## Capabilities

### New Capabilities

- `workbench-chat-clear`: 内容工作台聊天的当前线程清空：入口与确认、取消在跑任务、会话状态与持久化删除、下一轮模型不再带旧会话、草稿与项目隔离。

### Modified Capabilities

（无。基座 `workbench-chat` 仍在未归档的 `skill-driven-workbench-chats` 里；本变更以独立能力先捕获线程清空，不改 `workbench-chat-context` 的附件契约。）

## Impact

- 聊天壳：`src/agent/SkillChat.tsx`、`src/chat-ui/WorkbenchHeader.tsx`；可能微调 `src/agent/threads.ts` 的清空时序。
- API：已有 `DELETE /api/chat-thread` / `deleteChatThread`，不新增端点。
- 五个工作台：`ScriptBoard`、`CharacterBoard`、`AssetBoard`、`ShotTable`、`PromptTable` 只要共用壳生效，一般不必各写一套逻辑。
- 测试：清空后 `threadTranscript` 为空、重开仍空、取消在跑任务、自动保存不回写、草稿未改、项目/集隔离、空态禁用。
- 依赖：实现改同一批 `SkillChat` 文件，与进行中的 `skill-driven-workbench-chats` 错开 apply。
