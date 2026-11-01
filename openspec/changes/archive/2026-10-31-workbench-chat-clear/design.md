# Design

## Context

见 `proposal.md` 的 Why。实现约束：

- 五个内容工作台共用 `SkillChat`。线程键在 adapter：剧本/角色/素材为 project，镜头表/提示词为 project + episode。
- 界面轨迹完整持久化；发给模型的是 `threadTranscript(messages)`（最近 12 轮文本与工具摘要），再被 `runStageAgent` 截到约 6000 字，塞进当前 user 消息的 `【之前的对话】`。
- `DELETE /api/chat-thread` 与 `clearChatThread()` 已存在，没有任何工作台聊天入口调用。
- `SkillChat` 在消息变化后 500ms 自动 `saveChatThread`；卸载时若 `messagesRef` 非空也会保存。进行中的 `runStageAgent` / 内置动作结束后仍会 `patchAssistant` 或 `setMessages`。
- 切项目/切集已经会换线程；缺的是同一键上的显式清空。

## Goals / Non-Goals

**Goals:**

- 在共用聊天壳上提供一次实现、五处生效的清空。
- 清空成功后，内存、持久化和下一轮 `threadTranscript` 三者都为空。
- 进行中的模型轮次和内置动作不能在清空后把半截轨迹写回。
- 工作台草稿、项目、宿主技能、环节模型保持不动。

**Non-Goals:**

- 不在此设计会话列表、归档或新线程键。
- 不改 `threadTranscript` 窗口或技能任务卡。
- 不给 3D / 发布 / 创意聊天加入口（它们不走这条 `SkillChat` 路径，或已有自己的会话模型）。
- 不新增 API 或表结构。

## Decisions

### 1. 清空做在 `SkillChat`，不按工作台分叉

`WorkbenchHeader` 增加「清空对话」；`SkillChat` 持有确认、取消在跑任务、清状态和 `clearChatThread`。五个 adapter 不必新增字段。

替代：每个 Board 自己删线程。否决：线程生命周期已经集中在聊天壳，分叉会漏掉自动保存和运行中回写。

### 2. 先删持久化，再清界面

确认后顺序：

1. 递增 `clearGen`，中止模型 `AbortController` 和内置动作 controller。
2. `await clearChatThread(threadKey)`。失败则 toast，保留现有消息（生成可能已停），用户可重试。
3. 成功后再 `setMessages([])`，并清只读技能、附件、检查器、`actionError`；同步把 `messagesRef.current = []`，避免卸载保存把旧数组写回。
4. 之后任何 `patchAssistant` / 内置动作 `setMessages` 若 `clearGen` 已变，直接忽略。

替代：先清界面再 DELETE。否决：DELETE 失败时界面已空、重开却恢复旧消息，违反「关闭后重开仍为空」。

500ms 自动保存在 `messages.length === 0` 时本来就不会调度；`clearTimeout` 会取消清空前那一次。真正的竞态是运行结束回写，靠 `clearGen` 挡住。

### 3. 破坏性删除，不用新会话 id

同一线程键上 DELETE 行。不做归档表，也不把 `shot_id` 改成时间戳来「新开一条」。用户要的是当前范围忘掉旧讨论，不是历史列表。

替代：创意工作室那种会话列表。否决：范围外，且工作台聊天的定位仍是「这块板子的改稿助手」。

### 4. 确认用本机 `confirm`

文案说明：只清空聊天，不清草稿，不可恢复。与画布「清空画布」一致，不引入新对话框组件。

空线程（`messages.length === 0`）禁用按钮，避免无意义确认。

### 5. 提示词一并覆盖

提示词与镜头表同壳、同 12 轮历史。入口在 `SkillChat`，提示词工作台自动获得，不必单独改 `PromptTable`。3D / 发布 / 创意不加按钮。

## Risks / Trade-offs

- **运行结束回写已删线程** → `clearGen` 丢弃该轮后续 `setMessages` / `patchAssistant`；卸载保存读同步清空后的 `messagesRef`。
- **DELETE 失败但生成已取消** → 保留消息并 toast；用户可再点清空。不以「界面先空」掩盖持久化失败。
- **内置动作已部分写入草稿** → 现有动作契约是取消不落半份；清空只 abort signal，不另写合并逻辑。若某动作在 abort 前已经 `applyDraft`，那是既有动作原子性问题，本变更不扩大修复。
- **与未归档的 `skill-driven-workbench-chats` 改同一批文件** → apply 错开；本变更只加头部入口和清空时序，不改技能装载。

## Migration Plan

无需数据迁移。旧线程保持原样，直到用户清空。回滚：去掉按钮并停止调用 DELETE，已删线程无法从本变更恢复。

## Open Questions

（无。提示词纳入范围已记在 proposal；归档 vs 删除已定为删除。）
