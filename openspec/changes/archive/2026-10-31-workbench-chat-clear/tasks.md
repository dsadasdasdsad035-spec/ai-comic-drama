# Tasks

## 1. 头部入口与清空时序

- [x] 1.1 在 `WorkbenchHeader` 增加「清空对话」：无消息时禁用，有消息时 `confirm` 文案写明只清空聊天、不清草稿、不可恢复；验证：空线程按钮 `disabled`，取消确认后消息条数不变。
- [x] 1.2 在 `SkillChat` 实现清空：递增 `clearGen` → 中止模型与内置动作 → `await clearChatThread` 成功后再清空消息/只读技能/附件/检查器，并同步 `messagesRef = []`；`clearGen` 之后忽略 `patchAssistant` 与内置动作的 `setMessages`；验证：清空后界面空态，`GET /api/chat-thread` 无消息。
- [x] 1.3 DELETE 失败时 toast、保留现有消息，允许重试；验证：mock DELETE 非 2xx 时消息仍在，界面可再次点清空。
- [x] 1.4 新增 `verify-workbench-chat-clear.mjs`，至少覆盖剧本与镜头表两个线程键：空态禁用、确认取消、确认后 DELETE、五个工作台头部都能看到入口；验证：脚本退出码 0。

## 2. 模型历史、隔离与运行中清空

- [x] 2.1 先写入若干轮再清空，下一次发送的请求体不含旧用户/助手文本、工具摘要或内置动作回执（无 `【之前的对话】` 旧轮次）；验证：拦截 `/api/text` 断言。
- [x] 2.2 清空后关闭并重开同一工作台同一范围，仍是空态；验证：`loadChatThread` 为空，界面无旧气泡。
- [x] 2.3 隔离：清空项目 A 剧本不影响角色/素材线程；清空第 1 集镜头表不影响第 2 集；提示词聊天同样可清空且不串到镜头表；验证：上述四组线程 GET 断言。
- [x] 2.4 镜头表有未保存手改时清空聊天，表格草稿仍在；挂着附件和只读技能时清空后两者都消失，宿主技能与模型标签仍在；验证：表格行仍在，附件栏为空。
- [x] 2.5 模型生成中与「拆镜」运行中确认清空：运行停止，半截轨迹不写回线程，拆镜取消不落半份草稿；验证：等待原请求结束后 GET 线程仍空，镜头表保持清空前版本。

## 3. 回归

- [x] 3.1 跑 `verify-workbench-chats.mjs`、`verify-script-chat.mjs`、`verify-workbench-builtin-actions.mjs`；验证：全部退出码 0。
- [x] 3.2 确认 3D / 发布 / 创意聊天头部没有「清空对话」，现有会话恢复行为不变；验证：对应 verify 脚本或页面断言通过。

## Workflow follow-up

- 实现改同一批 `SkillChat` 文件，apply 时与未完成的 `skill-driven-workbench-chats` 错开。
- 评审通过后归档本变更，把 `workbench-chat-clear` 同步进主规格。
- 本变更不自动实现；实现从 `/opsx-apply` 开始。
